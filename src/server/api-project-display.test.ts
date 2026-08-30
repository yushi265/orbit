import { beforeEach, describe, expect, it } from "vitest";
import { bootstrap, startBackgroundRun, updateProject } from "./api";
import { getOrbitStore, resetOrbitStores } from "./store";
import { defaultProjectIssueDisplaySettings } from "../shared/contracts/project-display";

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("Project display preferences HTTP contract", () => {
  beforeEach(() => resetOrbitStores());

  it("[代表値] BootstrapのProject IDへdisplayPreferencesを保存できる", async () => {
    const initial = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const projectId = (await body<{ projects: Array<{ id: string }> }>(initial)).projects[0].id;
    const response = await updateProject(
      mutationForProject(projectId, {
        idempotencyKey: "api-display-1",
        displayPreferences: { ...defaultProjectIssueDisplaySettings(), showCompleted: false },
      }),
      projectId,
    );

    expect(response.status).toBe(200);
    const responseBody = await body<{
      projectDisplayPreference: { settings: { showCompleted: boolean } };
    }>(response);
    expect(responseBody.projectDisplayPreference.settings.showCompleted).toBe(false);
    const reloaded = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    expect(
      (
        await body<{ projectDisplayPreferences: Array<{ projectId: string; settings: unknown }> }>(
          reloaded,
        )
      ).projectDisplayPreferences,
    ).toEqual([
      expect.objectContaining({
        projectId,
        settings: responseBody.projectDisplayPreference.settings,
      }),
    ]);

    const replay = await updateProject(
      mutationForProject(projectId, {
        idempotencyKey: "api-display-1",
        displayPreferences: { ...defaultProjectIssueDisplaySettings(), showCompleted: false },
      }),
      projectId,
    );
    expect(await body(replay)).toEqual(responseBody);
  });

  it("[契約] 不正入力は400、同じKeyの異なるRequestは409になる", async () => {
    const initial = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const projectId = (await body<{ projects: Array<{ id: string }> }>(initial)).projects[0].id;
    const crossOriginMutation = new Request(`http://orbit.local/api/v1/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "api-display-cross-origin",
        displayPreferences: defaultProjectIssueDisplaySettings(),
      }),
    });
    expect((await updateProject(crossOriginMutation, projectId)).status).toBe(400);
    const validAtBoundary = await updateProject(
      mutationForProject(projectId, {
        idempotencyKey: "api-display-boundary",
        displayPreferences: {
          ...defaultProjectIssueDisplaySettings(),
          filterText: "あ".repeat(255),
        },
      }),
      projectId,
    );
    expect(validAtBoundary.status).toBe(200);
    const invalid = await updateProject(
      mutationForProject(projectId, {
        idempotencyKey: "api-display-invalid",
        displayPreferences: {
          ...defaultProjectIssueDisplaySettings(),
          filterText: "あ".repeat(256),
        },
      }),
      projectId,
    );
    expect(invalid.status).toBe(400);

    const beforeStrict = getOrbitStore("dev-owner").toSnapshot();
    for (const value of [
      { idempotencyKey: "api-display-missing-settings", displayPreferences: {} },
      {
        idempotencyKey: "api-display-unknown-settings",
        displayPreferences: { ...defaultProjectIssueDisplaySettings(), unknown: true },
      },
      { idempotencyKey: "api-display-null-settings", displayPreferences: null },
      { idempotencyKey: "api-display-array-settings", displayPreferences: [] },
    ]) {
      const strictInvalid = await updateProject(mutationForProject(projectId, value), projectId);
      expect(strictInvalid.status).toBe(400);
    }
    expect(getOrbitStore("dev-owner").toSnapshot().projectDisplayPreferences).toEqual(
      beforeStrict.projectDisplayPreferences,
    );

    const first = await updateProject(
      mutationForProject(projectId, {
        idempotencyKey: "api-display-conflict",
        displayPreferences: defaultProjectIssueDisplaySettings(),
      }),
      projectId,
    );
    expect(first.status).toBe(200);
    const conflict = await updateProject(
      mutationForProject(projectId, {
        idempotencyKey: "api-display-conflict",
        displayPreferences: { ...defaultProjectIssueDisplaySettings(), mode: "board" },
      }),
      projectId,
    );
    expect(conflict.status).toBe(409);

    const missingProject = await updateProject(
      mutationForProject("missing-project", {
        idempotencyKey: "api-display-missing-project",
        displayPreferences: defaultProjectIssueDisplaySettings(),
      }),
      "missing-project",
    );
    expect(missingProject.status).toBe(404);

    const store = getOrbitStore("dev-owner");
    const project = store.projects.get(projectId)!;
    project.deletedAt = 1_700_000_000_001;
    const deletedProject = await updateProject(
      mutationForProject(projectId, {
        idempotencyKey: "api-display-deleted-project",
        displayPreferences: defaultProjectIssueDisplaySettings(),
      }),
      projectId,
    );
    expect(deletedProject.status).toBe(404);
    project.deletedAt = null;
    const before = store.toSnapshot();
    const lockResponse = await startBackgroundRun(
      new Request("http://orbit.local/api/v1/background-runs", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ kind: "maintenance", idempotencyKey: "api-display-lock" }),
      }),
    );
    expect(lockResponse.status).toBe(202);
    const locked = await updateProject(
      mutationForProject(projectId, {
        idempotencyKey: "api-display-locked",
        displayPreferences: { ...defaultProjectIssueDisplaySettings(), mode: "board" },
      }),
      projectId,
    );
    expect(locked.status).toBe(423);
    expect(store.toSnapshot().projectDisplayPreferences).toEqual(before.projectDisplayPreferences);
  });
});

function mutationForProject(projectId: string, value: unknown): Request {
  return new Request(`http://orbit.local/api/v1/projects/${projectId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify(value),
  });
}
