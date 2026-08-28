import { beforeEach, describe, expect, it } from "vitest";
import { bootstrap, createIssue, getIssue, updateCycleSettings, updateIssue } from "./api";
import { getOrbitStore, resetOrbitStores } from "./store";

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function mutation(url: string, method: string, value: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify(value),
  });
}

describe("Cycle auto-add HTTP service", () => {
  beforeEach(() => resetOrbitStores());

  it("[状態遷移] 設定を保存し、status変更のAPI結果とIssue Detail ActivityへAutomationを返す", async () => {
    const settings = await updateCycleSettings(
      mutation("http://orbit.local/api/v1/cycle-settings", "PATCH", {
        idempotencyKey: "api-auto-add-settings",
        durationWeeks: 2,
        startWeekday: 1,
        autoAddToCurrentCycle: true,
      }),
    );
    expect(settings.status).toBe(200);
    expect(
      (await body<{ cycleSettings: { autoAddToCurrentCycle: boolean } }>(settings)).cycleSettings,
    ).toMatchObject({ autoAddToCurrentCycle: true });
    const reloadedSettings = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    expect(
      (await body<{ cycleSettings: { autoAddToCurrentCycle: boolean } }>(reloadedSettings))
        .cycleSettings.autoAddToCurrentCycle,
    ).toBe(true);

    const initial = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const initialBody = await body<{
      cycles: Array<{ id: string; status: string }>;
      workflowStates: Array<{ id: string; category: string }>;
    }>(initial);
    const active = initialBody.cycles.find((cycle) => cycle.status === "active")!;
    const unstarted = initialBody.workflowStates.find((state) => state.category === "unstarted")!;
    const started = initialBody.workflowStates.find((state) => state.category === "started")!;
    const created = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "api-auto-add-issue-create",
        title: "API自動追加対象",
        statusId: unstarted.id,
      }),
    );
    const issue = (await body<{ issue: { id: string; version: number } }>(created)).issue;
    const updateRequest = () =>
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "api-auto-add-issue-update",
        version: issue.version,
        patch: { statusId: started.id },
      });
    const updated = await updateIssue(updateRequest(), issue.id);
    const replay = await updateIssue(updateRequest(), issue.id);

    expect(
      (await body<{ issue: { cycleId: string; version: number } }>(updated)).issue,
    ).toMatchObject({
      cycleId: active.id,
      version: 2,
    });
    expect(
      (await body<{ issue: { cycleId: string; version: number } }>(replay)).issue,
    ).toMatchObject({
      cycleId: active.id,
      version: 2,
    });
    const detail = await getIssue(
      new Request(`http://orbit.local/api/v1/issues/${issue.id}`),
      issue.id,
    );
    expect(
      (await body<{ activity: Array<{ action: string; actorType: string }> }>(detail)).activity,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "cycle.auto_assigned", actorType: "system:automation" }),
      ]),
    );
    expect(
      getOrbitStore("dev-owner").outbox.filter(
        (event) => event.type === "issue.cycle.auto_assigned",
      ),
    ).toHaveLength(1);
  });

  it("[異常系] 設定のboolean不正とIssueのlock中を既存ErrorEnvelopeで返す", async () => {
    const invalid = await updateCycleSettings(
      mutation("http://orbit.local/api/v1/cycle-settings", "PATCH", {
        idempotencyKey: "api-auto-add-invalid-setting",
        durationWeeks: 2,
        startWeekday: 1,
        autoAddToCurrentCycle: "true",
      }),
    );
    expect(invalid.status).toBe(400);

    const created = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "api-auto-add-lock-issue",
        title: "API lock対象",
      }),
    );
    const issue = (await body<{ issue: { id: string; version: number } }>(created)).issue;
    const store = getOrbitStore("dev-owner");
    store.startRun("dev-owner", { kind: "maintenance", idempotencyKey: "api-auto-add-lock-run" });
    const locked = await updateIssue(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "api-auto-add-lock-update",
        version: issue.version,
        patch: { statusId: store.ownedWorkflowStates("dev-owner")[2].id },
      }),
      issue.id,
    );
    expect(locked.status).toBe(423);
  });
});
