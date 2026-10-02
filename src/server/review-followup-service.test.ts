import { describe, expect, it } from "vitest";
import { runSummarySchema } from "../shared/contracts";
import { defaultProjectIssueDisplaySettings } from "../shared/contracts/project-display";
import { OrbitStore } from "./store";

const DAY = 24 * 60 * 60 * 1000;

function completeMaintenance(store: OrbitStore, userId: string, key: string) {
  const run = store.startRun(userId, { kind: "maintenance", idempotencyKey: key });
  for (let attempt = 0; attempt < 100 && run.status === "running"; attempt += 1) {
    store.continueRun(userId, run.run_id, {
      expected_cursor: run.progress.cursor,
      idempotencyKey: `${key}-${attempt}`,
    });
  }
  expect(run.status).toBe("succeeded");
  return run;
}

describe("Review follow-up service contracts", () => {
  it.each(["succeeded", "rejected"] as const)(
    "[境界値] requested_atが同msでも後から作った%s RunをlastRunへ投影しSnapshot順を保持する",
    (status) => {
      const now = Date.UTC(2026, 9, 2);
      const store = new OrbitStore(() => now);
      store.ensureOwner("owner", "owner@example.com");
      const first =
        status === "succeeded"
          ? completeMaintenance(store, "owner", "same-ms-first")
          : store.startRun("owner", { kind: "maintenance", idempotencyKey: "same-ms-first" });
      if (status === "succeeded") completeMaintenance(store, "owner", "same-ms-second");
      else
        expect(() =>
          store.startRun("owner", { kind: "maintenance", idempotencyKey: "same-ms-second" }),
        ).toThrowError(expect.objectContaining({ status: 423 }));
      const second = [...store.runs.values()].find(
        (run) => run.idempotencyKey === "same-ms-second",
      )!;
      expect(second.requested_at).toBe(first.requested_at);
      expect(store.bootstrap("owner").background.lastRun).toMatchObject({
        run_id: second.run_id,
        status,
      });

      const restored = OrbitStore.fromSnapshot(store.toSnapshot(), () => now, "owner");
      expect(restored.bootstrap("owner").background.lastRun).toMatchObject({
        run_id: second.run_id,
        status,
      });
      expect([...restored.runs.keys()]).toEqual([first.run_id, second.run_id]);
    },
  );

  it.each([-1, 0, 1])("[境界値/Owner分離] Receipt expiresAtから%imsの削除条件", (offset) => {
    let now = Date.UTC(2026, 9, 2);
    const store = new OrbitStore(() => now);
    for (const userId of ["owner", "other"]) {
      store.ensureOwner(userId, `${userId}@example.com`);
      store.createIssue(userId, { title: "Reserved", idempotencyKey: "boundary" });
    }
    const expiresAt = store.receipts.get("owner:boundary")!.expiresAt;
    now = expiresAt + offset;

    completeMaintenance(store, "owner", `expiry-${offset}`);

    expect(store.receipts.has("owner:boundary")).toBe(offset <= 0);
    expect(store.receipts.has("other:boundary")).toBe(true);
  });

  it("[状態遷移] BootstrapはRun未実行時lastRunをnullで返す", () => {
    const store = new OrbitStore();
    store.ensureOwner("owner", "owner@example.com");
    expect(store.bootstrap("owner").background).toEqual({ run: null, lastRun: null });
  });

  it("[状態遷移] 成功したRunをlastRunで返しcurrentはnullのまま維持する", () => {
    const store = new OrbitStore(() => Date.UTC(2026, 9, 2));
    store.ensureOwner("owner", "owner@example.com");
    const run = completeMaintenance(store, "owner", "completed-run");

    expect(store.bootstrap("owner").background.lastRun).toMatchObject({
      run_id: run.run_id,
      status: "succeeded",
      progress: { percent: 100 },
    });
    expect(store.currentRun("owner")).toBeNull();
    expect(store.bootstrap("owner").background.run).toBeNull();
    const restored = OrbitStore.fromSnapshot(
      store.toSnapshot(),
      () => Date.UTC(2026, 9, 2),
      "owner",
    );
    expect(restored.bootstrap("owner").background.lastRun).toEqual(
      store.bootstrap("owner").background.lastRun,
    );
  });

  it("[アクセス境界] lastRunは本人の最新requested_atだけを公開し他Ownerと内部値を除外する", () => {
    let now = Date.UTC(2026, 9, 2);
    const store = new OrbitStore(() => now);
    store.ensureOwner("owner", "owner@example.com");
    const older = completeMaintenance(store, "owner", "older");
    now += 1;
    const latest = completeMaintenance(store, "owner", "latest");
    older.finished_at = now + DAY;
    now += 1;
    store.ensureOwner("other", "other@example.com");
    const other = store.startRun("other", { kind: "maintenance", idempotencyKey: "foreign" });

    const background = store.bootstrap("owner").background;
    expect(background.lastRun).toMatchObject({ run_id: latest.run_id, status: "succeeded" });
    expect(background.lastRun?.run_id).not.toBe(other.run_id);
    expect(runSummarySchema.safeParse(background.lastRun).success).toBe(true);
    for (const privateKey of [
      "user_id",
      "idempotencyKey",
      "requestHash",
      "leaseExpiresAt",
      "stepIndex",
      "stepStatuses",
      "stepCursors",
    ])
      expect(background.lastRun).not.toHaveProperty(privateKey);
    expect(background.run).toBeNull();
  });

  it("[状態遷移] 古いpausedをcurrentに保持し最新の成功結果をlastRunへ投影する", () => {
    let now = Date.UTC(2026, 9, 2);
    const store = new OrbitStore(() => now);
    store.ensureOwner("owner", "owner@example.com");
    const paused = store.startRun("owner", { kind: "maintenance", idempotencyKey: "pause-first" });
    now += 30_001;
    expect(store.currentRun("owner")?.status).toBe("paused");
    const succeeded = completeMaintenance(store, "owner", "succeed-second");

    const background = store.bootstrap("owner").background;
    expect(background.run).toMatchObject({ run_id: paused.run_id, status: "paused" });
    expect(background.lastRun).toMatchObject({ run_id: succeeded.run_id, status: "succeeded" });
  });

  it.each([
    "updated_asc",
    "created_asc",
    "title_desc",
    "status_desc",
    "priority_asc",
    "due_desc",
  ] as const)("[レイヤー内結合] ProjectのSort %sとnext7をSnapshot保存・復元する", (order) => {
    const now = Date.UTC(2026, 9, 2);
    const store = new OrbitStore(() => now);
    store.ensureOwner("owner", "owner@example.com");
    const project = store.createProject("owner", {
      idempotencyKey: "project-for-sort",
      name: "Sort preferences",
    });
    const settings = {
      ...defaultProjectIssueDisplaySettings(),
      order,
      dueFilter: "next7" as const,
    };
    store.updateProjectDisplayPreferences("owner", project.id, {
      idempotencyKey: `sort-${order}`,
      displayPreferences: settings,
    });

    const restored = OrbitStore.fromSnapshot(store.toSnapshot(), () => now, "owner");
    expect(restored.getProjectDisplayPreferences("owner", project.id).settings).toEqual(settings);
  });

  it.each(["pending", "running", "paused", "succeeded", "failed", "rejected"] as const)(
    "[同値分割] lastRunは%sを含む全公開Run状態を返しcurrent対象は維持する",
    (status) => {
      const store = new OrbitStore(() => Date.UTC(2026, 9, 2));
      store.ensureOwner("owner", "owner@example.com");
      const run = completeMaintenance(store, "owner", "all-statuses");
      run.status = status;

      const background = store.bootstrap("owner").background;
      expect(background.lastRun).toMatchObject({ run_id: run.run_id, status });
      const currentId = ["pending", "running", "paused", "failed"].includes(status)
        ? run.run_id
        : null;
      expect(background.run?.run_id ?? null).toBe(currentId);
      expect(store.currentRun("owner")?.run_id ?? null).toBe(currentId);
    },
  );

  it("[状態遷移] 30日のReceipt期限を過ぎたらPurgeし同じKeyを新しいMutationに使える", () => {
    let now = Date.UTC(2026, 9, 2);
    const store = new OrbitStore(() => now);
    store.ensureOwner("owner", "owner@example.com");
    const initial = store.createIssue("owner", { title: "Initial", idempotencyKey: "expired" });
    now += 31 * DAY;

    completeMaintenance(store, "owner", "purge-expired");

    expect(store.receipts.has("owner:expired")).toBe(false);
    const recreated = store.createIssue("owner", {
      title: "New operation",
      idempotencyKey: "expired",
    });
    expect(recreated.id).not.toBe(initial.id);
    expect(recreated.number).toBe(2);
  });
});
