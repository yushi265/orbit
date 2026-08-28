import { beforeEach, describe, expect, it } from "vitest";
import {
  bootstrap,
  createWorkflowState,
  currentBackgroundRun,
  continueBackgroundRun,
  deleteWorkflowState,
  listWorkflowStates,
  startBackgroundRun,
  updatePreferences,
  updateWorkflowState,
} from "./api";
import { getOrbitStore, resetOrbitStores } from "./store";

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

type PublicRunResponse = {
  run_id: string;
  status: string;
  progress: { cursor: string | null };
  [key: string]: unknown;
};

function mutation(url: string, method: string, value: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify(value),
  });
}

describe("Phase 1 foundation HTTP service", () => {
  beforeEach(() => resetOrbitStores());

  it("[代表値] Preferences APIはtimezone / locale / theme / color / estimateを保存する", async () => {
    const response = await updatePreferences(
      mutation("http://orbit.local/api/v1/preferences", "PATCH", {
        idempotencyKey: "api-foundation-preferences",
        timezone: "UTC",
        locale: "en",
        theme: "dark",
        colorTheme: "forest",
        estimateEnabled: false,
      }),
    );

    expect(response.status).toBe(200);
    const responseBody = await body<{ preferences: Record<string, unknown> }>(response);
    expect(responseBody).toMatchObject({
      preferences: {
        timezone: "UTC",
        locale: "en",
        theme: "dark",
        colorTheme: "forest",
        estimateEnabled: false,
      },
    });
    const reloaded = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    expect(
      (await body<{ preferences: Record<string, unknown> }>(reloaded)).preferences,
    ).toMatchObject({
      timezone: "UTC",
      locale: "en",
      theme: "dark",
      colorTheme: "forest",
      estimateEnabled: false,
    });
    const replay = await updatePreferences(
      mutation("http://orbit.local/api/v1/preferences", "PATCH", {
        idempotencyKey: "api-foundation-preferences",
        timezone: "UTC",
        locale: "en",
        theme: "dark",
        colorTheme: "forest",
        estimateEnabled: false,
      }),
    );
    expect(await body(replay)).toEqual(responseBody);
    const partial = await updatePreferences(
      mutation("http://orbit.local/api/v1/preferences", "PATCH", {
        idempotencyKey: "api-foundation-partial",
        timezone: "Asia/Tokyo",
      }),
    );
    expect(partial.status).toBe(200);
    expect(await body<{ preferences: Record<string, unknown> }>(partial)).toMatchObject({
      preferences: {
        timezone: "Asia/Tokyo",
        locale: "en",
        theme: "dark",
        colorTheme: "forest",
        estimateEnabled: false,
      },
    });
  });

  it("[契約] Preferences APIはunknown keyと不正timezoneを400にする", async () => {
    const unknown = await updatePreferences(
      mutation("http://orbit.local/api/v1/preferences", "PATCH", {
        idempotencyKey: "api-foundation-unknown",
        unsupported: true,
      }),
    );
    expect(unknown.status).toBe(400);
    const invalidTimezone = await updatePreferences(
      mutation("http://orbit.local/api/v1/preferences", "PATCH", {
        idempotencyKey: "api-foundation-invalid-timezone",
        timezone: "Mars/Orbit",
      }),
    );
    expect(invalidTimezone.status).toBe(400);
    expect(
      await body<{ error: { code: string; fieldErrors: Record<string, string[]> } }>(
        invalidTimezone,
      ),
    ).toMatchObject({
      error: { code: "VALIDATION_ERROR", fieldErrors: { timezone: expect.any(Array) } },
    });
    const emptyTimezone = await updatePreferences(
      mutation("http://orbit.local/api/v1/preferences", "PATCH", {
        idempotencyKey: "api-foundation-empty-timezone",
        timezone: "",
      }),
    );
    expect(emptyTimezone.status).toBe(400);
  });

  it("[契約] Preferences / Workflow DELETEはidempotency keyなしを400にする", async () => {
    const preferences = await updatePreferences(
      mutation("http://orbit.local/api/v1/preferences", "PATCH", { theme: "dark" }),
    );
    expect(preferences.status).toBe(400);
    const workflow = await deleteWorkflowState(
      new Request("http://orbit.local/api/v1/workflow-states/state", {
        method: "DELETE",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      }),
      "state",
    );
    expect(workflow.status).toBe(400);
  });

  it("[状態遷移] Workflow APIは追加・更新・一覧・削除をOwner scopedに行う", async () => {
    const created = await createWorkflowState(
      mutation("http://orbit.local/api/v1/workflow-states", "POST", {
        idempotencyKey: "api-workflow-create",
        name: "Review",
        category: "started",
        color: "#123456",
      }),
    );
    expect(created.status).toBe(200);
    const createdState = (await body<{ workflowState: { id: string } }>(created)).workflowState;

    const updated = await updateWorkflowState(
      mutation("http://orbit.local/api/v1/workflow-states/id", "PATCH", {
        idempotencyKey: "api-workflow-update",
        name: "Review now",
        position: 0,
        isDefault: true,
      }),
      createdState.id,
    );
    expect(updated.status).toBe(200);
    const updatedBody = await body<{
      workflowState: { name: string; position: number; isDefault: boolean };
    }>(updated);
    expect(updatedBody.workflowState).toMatchObject({
      name: "Review now",
      position: 0,
      isDefault: true,
    });
    const replay = await updateWorkflowState(
      mutation("http://orbit.local/api/v1/workflow-states/id", "PATCH", {
        idempotencyKey: "api-workflow-update",
        name: "Review now",
        position: 0,
        isDefault: true,
      }),
      createdState.id,
    );
    expect(await body(replay)).toEqual(updatedBody);
    const reused = await updateWorkflowState(
      mutation("http://orbit.local/api/v1/workflow-states/id", "PATCH", {
        idempotencyKey: "api-workflow-update",
        name: "Different",
      }),
      createdState.id,
    );
    expect(reused.status).toBe(409);

    const listed = await listWorkflowStates(
      new Request("http://orbit.local/api/v1/workflow-states"),
    );
    expect(listed.status).toBe(200);
    expect(
      (await body<{ workflowStates: Array<{ id: string }> }>(listed)).workflowStates.some(
        (state) => state.id === createdState.id,
      ),
    ).toBe(true);
    const listedStates = (
      await body<{
        workflowStates: Array<{ id: string; position: number; isDefault: boolean }>;
      }>(await listWorkflowStates(new Request("http://orbit.local/api/v1/workflow-states")))
    ).workflowStates;
    expect(listedStates.find((state) => state.id === createdState.id)).toMatchObject({
      position: 0,
      isDefault: true,
    });
    expect(listedStates.filter((state) => state.isDefault)).toHaveLength(1);
    expect(listedStates.map((state) => state.position)).toEqual(
      Array.from({ length: listedStates.length }, (_, index) => index),
    );

    const createReplay = await createWorkflowState(
      mutation("http://orbit.local/api/v1/workflow-states", "POST", {
        idempotencyKey: "api-workflow-create",
        name: "Review",
        category: "started",
        color: "#123456",
      }),
    );
    expect(await body(createReplay)).toEqual({
      workflowState: expect.objectContaining({ id: createdState.id }),
    });

    const deletable = await createWorkflowState(
      mutation("http://orbit.local/api/v1/workflow-states", "POST", {
        idempotencyKey: "api-workflow-deletable",
        name: "Temporary",
        category: "backlog",
        color: "#654321",
      }),
    );
    const deletableState = (await body<{ workflowState: { id: string } }>(deletable)).workflowState;
    const deleted = await deleteWorkflowState(
      new Request("http://orbit.local/api/v1/workflow-states/id", {
        method: "DELETE",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "api-workflow-delete",
        },
      }),
      deletableState.id,
    );
    expect(deleted.status).toBe(200);
    const deleteReplay = await deleteWorkflowState(
      new Request("http://orbit.local/api/v1/workflow-states/id", {
        method: "DELETE",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "api-workflow-delete",
        },
      }),
      deletableState.id,
    );
    expect(await body(deleteReplay)).toEqual({ ok: true });
    const afterDelete = await listWorkflowStates(
      new Request("http://orbit.local/api/v1/workflow-states"),
    );
    expect(
      (await body<{ workflowStates: Array<{ id: string }> }>(afterDelete)).workflowStates.some(
        (state) => state.id === deletableState.id,
      ),
    ).toBe(false);
  });

  it("[異常系] APIは既定WorkflowとIssue参照中Workflowの削除を副作用なしで拒否する", async () => {
    const initial = await listWorkflowStates(
      new Request("http://orbit.local/api/v1/workflow-states"),
    );
    const states = (
      await body<{ workflowStates: Array<{ id: string; isDefault: boolean }> }>(initial)
    ).workflowStates;
    const defaultState = states.find((state) => state.isDefault)!;
    const store = getOrbitStore("dev-owner");
    const referenced = store.createWorkflowState("dev-owner", {
      idempotencyKey: "api-referenced-state",
      name: "Referenced",
      category: "started",
      color: "#334455",
    });
    store.createIssue("dev-owner", {
      idempotencyKey: "api-referenced-issue",
      title: "API referenced state",
      statusId: referenced.id,
    });
    const before = store.toSnapshot();

    const defaultDelete = await deleteWorkflowState(
      new Request("http://orbit.local/api/v1/workflow-states/default", {
        method: "DELETE",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "api-delete-default",
        },
      }),
      defaultState.id,
    );
    const referencedDelete = await deleteWorkflowState(
      new Request("http://orbit.local/api/v1/workflow-states/referenced", {
        method: "DELETE",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "api-delete-referenced",
        },
      }),
      referenced.id,
    );

    expect(defaultDelete.status).toBe(400);
    expect(referencedDelete.status).toBe(400);
    expect(store.toSnapshot()).toEqual(before);
  });

  it("[状態遷移] current APIはRunのrunningからsucceededまで公開情報だけを返す", async () => {
    const initial = await currentBackgroundRun(
      new Request("http://orbit.local/api/v1/background-runs/current"),
    );
    expect(await body(initial)).toEqual({ run: null });

    const started = await startBackgroundRun(
      mutation("http://orbit.local/api/v1/background-runs", "POST", {
        kind: "maintenance",
        idempotencyKey: "api-current-run",
      }),
    );
    const startedBody = await body<{ run: PublicRunResponse }>(started);
    expect(started.status).toBe(202);
    expect(startedBody.run).not.toHaveProperty("user_id");
    expect(startedBody.run).not.toHaveProperty("requestHash");
    expect(startedBody.run).not.toHaveProperty("leaseExpiresAt");

    let current: PublicRunResponse = startedBody.run;
    for (let step = 0; step < 3; step += 1) {
      const continued = await continueBackgroundRun(
        mutation("http://orbit.local/api/v1/background-runs/current/continue", "POST", {
          idempotencyKey: `api-current-continue-${step}`,
          expected_cursor: current.progress.cursor,
        }),
        current.run_id,
      );
      expect(continued.status).toBe(200);
      current = (await body<{ run: PublicRunResponse }>(continued)).run;
    }
    expect(current.status).toBe("succeeded");
    const terminal = await currentBackgroundRun(
      new Request("http://orbit.local/api/v1/background-runs/current"),
    );
    expect(await body(terminal)).toEqual({ run: null });
  });

  it("[状態遷移] APIのcycle_transitionは期限到来Cycleを完了し、次Cycleを予定日時のまま開始する", async () => {
    const initial = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    expect(initial.status).toBe(200);
    const store = getOrbitStore("dev-owner");
    const active = store.listCycles("dev-owner").find((cycle) => cycle.status === "active")!;
    const upcoming = store
      .listCycles("dev-owner")
      .filter((cycle) => cycle.status === "upcoming")
      .sort((left, right) => left.number - right.number)[0];
    const now = Date.now();
    active.endsAt = now - 2;
    upcoming.startsAt = now - 1;
    upcoming.endsAt = now + 7 * 24 * 60 * 60 * 1000;

    const started = await startBackgroundRun(
      mutation("http://orbit.local/api/v1/background-runs", "POST", {
        kind: "maintenance",
        idempotencyKey: "api-cycle-transition-run",
      }),
    );
    const run = (
      await body<{ run: { run_id: string; progress: { cursor: string | null } } }>(started)
    ).run;
    const continued = await continueBackgroundRun(
      mutation("http://orbit.local/api/v1/background-runs/continue", "POST", {
        idempotencyKey: "api-cycle-transition-step",
        expected_cursor: run.progress.cursor,
      }),
      run.run_id,
    );

    expect(continued.status).toBe(200);
    expect(store.cycles.get(active.id)?.status).toBe("completed");
    expect(store.cycles.get(upcoming.id)).toMatchObject({
      status: "active",
      startsAt: now - 1,
      endsAt: now + 7 * 24 * 60 * 60 * 1000,
    });
  });

  it("[デシジョンテーブル] Background Run中のPreferences / Workflow APIは423で副作用なし", async () => {
    const started = await startBackgroundRun(
      mutation("http://orbit.local/api/v1/background-runs", "POST", {
        kind: "maintenance",
        idempotencyKey: "api-foundation-run",
      }),
    );
    expect(started.status).toBe(202);
    const store = getOrbitStore("dev-owner");
    const before = store.toSnapshot();

    const preferences = await updatePreferences(
      mutation("http://orbit.local/api/v1/preferences", "PATCH", {
        idempotencyKey: "api-locked-preferences",
        theme: "dark",
      }),
    );
    expect(preferences.status).toBe(423);
    const workflow = await createWorkflowState(
      mutation("http://orbit.local/api/v1/workflow-states", "POST", {
        idempotencyKey: "api-locked-workflow",
        name: "Blocked",
        category: "started",
        color: "#112233",
      }),
    );
    expect(workflow.status).toBe(423);
    expect(store.toSnapshot().preferences).toEqual(before.preferences);
    expect(store.toSnapshot().workflowStates).toEqual(before.workflowStates);
  });
});
