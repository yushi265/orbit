import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrap } from "./api";
import type { BootstrapPayload } from "./model";
import { getOrbitStore, OrbitStore, resetOrbitStores } from "./store";

function setup() {
  const store = new OrbitStore(() => 1_700_000_000_000);
  store.ensureOwner("owner", "owner@example.com");
  return store;
}

function createIssues(store: OrbitStore, count: number, userId = "owner") {
  return Array.from({ length: count }, (_, index) =>
    store.createIssue(userId, {
      idempotencyKey: `${userId}-issue-${index}`,
      title: `Issue ${index + 1}`,
    }),
  );
}

describe("Bootstrap Issue completeness", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetOrbitStores();
  });

  it("[境界値] 100件ちょうどのActive Issueを順序を保って返す", () => {
    const store = setup();
    const issues = createIssues(store, 100);

    expect(store.bootstrap("owner").issues.map((issue) => issue.id)).toEqual(
      issues.map((issue) => issue.id),
    );
  });

  it("[境界値] 101件のActive Issueを100件で打ち切らず返す", () => {
    const store = setup();
    const issues = createIssues(store, 101);

    expect(store.bootstrap("owner").issues.map((issue) => issue.id)).toEqual(
      issues.map((issue) => issue.id),
    );
  });

  it("[境界値] 501件のActive IssueもBootstrapへ全件返し、公開一覧の制限は維持する", () => {
    const store = setup();
    const issues = createIssues(store, 501);

    expect(store.bootstrap("owner").issues.map((issue) => issue.id)).toEqual(
      issues.map((issue) => issue.id),
    );
    expect(store.listIssues("owner")).toHaveLength(100);
    expect(store.listIssues("owner", { limit: 501 })).toHaveLength(500);
  });

  it("[デシジョンテーブル] 全件取得でもarchive・trash・他Ownerを除外する", () => {
    const store = setup();
    const issues = createIssues(store, 103);
    store.archiveIssue("owner", issues[0].id, "archive-first");
    store.trashIssue("owner", issues[1].id, "trash-second");
    store.ensureOwner("other", "other@example.com");
    createIssues(store, 3, "other");

    expect(store.bootstrap("owner").issues.map((issue) => issue.id)).toEqual(
      issues.slice(2).map((issue) => issue.id),
    );
    expect(store.bootstrap("other").issues).toHaveLength(3);
    expect(store.listIssues("owner", {}, "archived").map((issue) => issue.id)).toEqual([
      issues[0].id,
    ]);
    expect(store.listIssues("owner", {}, "trash").map((issue) => issue.id)).toEqual([issues[1].id]);
  });

  it("[レイヤー内結合] API Bootstrapに全501件とProject・Cycleの割当が届く", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("ORBIT_STORAGE", "memory");
    vi.stubEnv("DEV_OWNER_USER_ID", "bootstrap-owner");
    const store = getOrbitStore("bootstrap-owner");
    const projects = ["Project A", "Project B"].map((name, index) =>
      store.createProject("bootstrap-owner", { idempotencyKey: `project-${index}`, name }),
    );
    const cycles = store.bootstrap("bootstrap-owner").cycles;
    const issues = Array.from({ length: 501 }, (_, index) =>
      store.createIssue("bootstrap-owner", {
        idempotencyKey: `api-issue-${index}`,
        title: `API Issue ${index + 1}`,
        projectId: index < 167 ? projects[0].id : index < 334 ? projects[1].id : null,
        cycleId: index < 251 ? cycles[0].id : cycles[1].id,
      }),
    );

    const response = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as BootstrapPayload;
    expect(payload.issues.map((issue) => issue.id)).toEqual(issues.map((issue) => issue.id));
    expect(payload.projects.map((project) => project.id)).toEqual(
      projects.map((project) => project.id),
    );
    expect(payload.issues.filter((issue) => issue.projectId === projects[0].id)).toHaveLength(167);
    expect(payload.issues.filter((issue) => issue.projectId === projects[1].id)).toHaveLength(167);
    expect(payload.issues.filter((issue) => issue.projectId === null)).toHaveLength(167);
    expect(payload.issues.filter((issue) => issue.cycleId === cycles[0].id)).toHaveLength(251);
    expect(payload.issues.filter((issue) => issue.cycleId === cycles[1].id)).toHaveLength(250);
  });

  it("[状態遷移] Snapshotを再読込してもBootstrapの501件が欠落しない", () => {
    const store = setup();
    const issues = createIssues(store, 501);
    const restored = OrbitStore.fromSnapshot(
      JSON.parse(JSON.stringify(store.toSnapshot())),
      () => 1_700_000_000_001,
      "owner",
    );

    expect(restored.bootstrap("owner").issues.map((issue) => issue.id)).toEqual(
      issues.map((issue) => issue.id),
    );
    expect(restored.listIssues("owner")).toHaveLength(100);
  });
});
