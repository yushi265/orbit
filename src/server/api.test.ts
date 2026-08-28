import { beforeEach, describe, expect, it } from "vitest";
import {
  bootstrap,
  closeCycle,
  continueBackgroundRun,
  createIssue,
  createIssueNote,
  createIssueRelation,
  createProject,
  createView,
  deleteIssueNote,
  deleteIssueRelation,
  deleteView,
  getIssue,
  listViews,
  startBackgroundRun,
  startCycle,
  updateCycleMetadata,
  updateCycleSettings,
  updateIssueNote,
  updateIssue,
  updatePreferences,
  reorderIssue,
  updateProject,
  updateView,
} from "./api";
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

describe("HTTP service boundary", () => {
  beforeEach(() => resetOrbitStores());

  it("[代表値] dev ownerのbootstrapとIssue createがJSON契約を返す", async () => {
    const initial = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    expect(initial.status).toBe(200);
    const initialBody = await body<{ me: { id: string } }>(initial);
    expect(initialBody.me.id).toBe("dev-owner");

    const response = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "http-create-01",
        title: "HTTP経由のIssue",
      }),
    );
    expect(response.status).toBe(201);
    expect((await body<{ issue: { identifier: string } }>(response)).issue.identifier).toMatch(
      /^TASK-\d+$/,
    );
    const multiline = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "http-create-multiline",
        title: "改行を保持するIssue",
        descriptionJson: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "1行目" }] },
            { type: "paragraph", content: [{ type: "text", text: "2行目" }] },
          ],
        },
      }),
    );
    expect((await body<{ issue: { description: string } }>(multiline)).issue.description).toBe(
      "1行目\n2行目",
    );
  });

  it("[状態遷移] CycleSettings APIを保存し、Bootstrapで再取得できる", async () => {
    const response = await updateCycleSettings(
      mutation("http://orbit.local/api/v1/cycle-settings", "PATCH", {
        idempotencyKey: "api-cycle-settings-1",
        durationWeeks: 4,
        startWeekday: 5,
      }),
    );

    expect(response.status).toBe(200);
    const responseBody = await body<{
      cycleSettings: { durationWeeks: number; startWeekday: number };
    }>(response);
    expect(responseBody).toMatchObject({
      cycleSettings: { durationWeeks: 4, startWeekday: 5 },
    });
    const reloaded = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    expect(
      await body<{ cycleSettings: { durationWeeks: number; startWeekday: number } }>(reloaded),
    ).toMatchObject({
      cycleSettings: { durationWeeks: 4, startWeekday: 5 },
    });

    const replay = await updateCycleSettings(
      mutation("http://orbit.local/api/v1/cycle-settings", "PATCH", {
        idempotencyKey: "api-cycle-settings-1",
        durationWeeks: 4,
        startWeekday: 5,
      }),
    );
    expect(await body(replay)).toEqual(responseBody);
    const conflict = await updateCycleSettings(
      mutation("http://orbit.local/api/v1/cycle-settings", "PATCH", {
        idempotencyKey: "api-cycle-settings-1",
        durationWeeks: 3,
        startWeekday: 5,
      }),
    );
    expect(conflict.status).toBe(409);

    const invalidDuration = await updateCycleSettings(
      mutation("http://orbit.local/api/v1/cycle-settings", "PATCH", {
        idempotencyKey: "api-cycle-settings-invalid-duration",
        durationWeeks: 9,
        startWeekday: 5,
      }),
    );
    expect(invalidDuration.status).toBe(400);
    const invalidWeekday = await updateCycleSettings(
      mutation("http://orbit.local/api/v1/cycle-settings", "PATCH", {
        idempotencyKey: "api-cycle-settings-invalid-weekday",
        durationWeeks: 4,
        startWeekday: 7,
      }),
    );
    expect(invalidWeekday.status).toBe(400);

    getOrbitStore("dev-owner").startRun("dev-owner", {
      kind: "maintenance",
      idempotencyKey: "api-cycle-settings-lock-run",
    });
    const locked = await updateCycleSettings(
      mutation("http://orbit.local/api/v1/cycle-settings", "PATCH", {
        idempotencyKey: "api-cycle-settings-locked",
        durationWeeks: 2,
        startWeekday: 1,
      }),
    );
    expect(locked.status).toBe(423);
  });

  it("[状態遷移/セキュリティ境界] Issue APIでProjectを割り当て・解除する", async () => {
    const initial = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const projectId = (await body<{ projects: Array<{ id: string }> }>(initial)).projects[0].id;
    const created = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "http-project-assignment-create",
        title: "API Project assignment",
        projectId,
      }),
    );
    expect(created.status).toBe(201);
    const issue = (
      await body<{ issue: { id: string; version: number; projectId: string } }>(created)
    ).issue;
    expect(issue.projectId).toBe(projectId);

    const cleared = await updateIssue(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "http-project-assignment-clear",
        version: issue.version,
        patch: { projectId: null },
      }),
      issue.id,
    );
    expect(cleared.status).toBe(200);
    expect(
      (await body<{ issue: { projectId: string | null } }>(cleared)).issue.projectId,
    ).toBeNull();

    const invalid = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "http-project-assignment-invalid",
        title: "Invalid Project assignment",
        projectId: "missing-project",
      }),
    );
    expect(invalid.status).toBe(404);
    expect((await body<{ error: { code: string } }>(invalid)).error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("[状態遷移] Issue APIでPriorityを作成・更新できる", async () => {
    const created = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "http-priority-create",
        title: "Priority API対象",
        priority: "high",
      }),
    );
    const issue = (
      await body<{ issue: { id: string; version: number; priority: string } }>(created)
    ).issue;
    expect(created.status).toBe(201);
    expect(issue).toMatchObject({ version: 1, priority: "high" });
    const updated = await updateIssue(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "http-priority-update",
        version: issue.version,
        patch: { priority: "urgent" },
      }),
      issue.id,
    );
    expect(updated.status).toBe(200);
    expect(
      (await body<{ issue: { version: number; priority: string } }>(updated)).issue,
    ).toMatchObject({ version: 2, priority: "urgent" });
  });

  it("[状態遷移/セキュリティ境界] Issue APIでOwnerのStatusを更新できる", async () => {
    const initial = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const completedState = (
      await body<{ workflowStates: Array<{ id: string; category: string }> }>(initial)
    ).workflowStates.find((state) => state.category === "completed");
    expect(completedState).toBeDefined();
    const created = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "http-status-create",
        title: "Status API対象",
      }),
    );
    const issue = (await body<{ issue: { id: string; version: number } }>(created)).issue;
    const updated = await updateIssue(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "http-status-update",
        version: issue.version,
        patch: { statusId: completedState!.id },
      }),
      issue.id,
    );
    expect(updated.status).toBe(200);
    expect(
      (await body<{ issue: { statusId: string; version: number } }>(updated)).issue,
    ).toMatchObject({ statusId: completedState!.id, version: 2 });

    const invalid = await updateIssue(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "http-status-invalid",
        version: 2,
        patch: { statusId: "missing-status" },
      }),
      issue.id,
    );
    expect(invalid.status).toBe(404);
  });

  it("[状態遷移/境界値] Preferences APIでThemeを保存し、再取得できる", async () => {
    const updated = await updatePreferences(
      mutation("http://orbit.local/api/v1/preferences", "PATCH", {
        idempotencyKey: "preferences-theme-dark",
        theme: "dark",
      }),
    );
    expect(updated.status).toBe(200);
    expect((await body<{ preferences: { theme: string } }>(updated)).preferences.theme).toBe(
      "dark",
    );
    const reloaded = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    expect((await body<{ preferences: { theme: string } }>(reloaded)).preferences.theme).toBe(
      "dark",
    );
    const invalid = await updatePreferences(
      mutation("http://orbit.local/api/v1/preferences", "PATCH", {
        idempotencyKey: "preferences-theme-invalid",
        theme: "sepia",
      }),
    );
    expect(invalid.status).toBe(400);
  });

  it("[代表値] Reorder APIでListのmanual orderを保存し、PreferencesのcolorThemeを再取得できる", async () => {
    const first = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "api-reorder-create-1",
        title: "一番目",
      }),
    );
    const second = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "api-reorder-create-2",
        title: "二番目",
      }),
    );
    const firstIssue = (await body<{ issue: { id: string } }>(first)).issue;
    const secondIssue = (await body<{ issue: { id: string; version: number } }>(second)).issue;
    const reordered = await reorderIssue(
      mutation("http://orbit.local/api/v1/issues/reorder", "POST", {
        idempotencyKey: "api-reorder-1",
        issueId: secondIssue.id,
        version: secondIssue.version,
        beforeIssueId: firstIssue.id,
      }),
    );
    expect(reordered.status).toBe(200);
    const reorderedIssue = (await body<{ issue: { id: string; version: number } }>(reordered))
      .issue;
    expect(reorderedIssue.version).toBeGreaterThan(secondIssue.version);
    const reloaded = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const reloadedIssues = (await body<{ issues: Array<{ id: string }> }>(reloaded)).issues;
    expect(reloadedIssues.findIndex((item) => item.id === secondIssue.id)).toBeLessThan(
      reloadedIssues.findIndex((item) => item.id === firstIssue.id),
    );

    const moveToEndPayload = {
      idempotencyKey: "api-reorder-end",
      issueId: reorderedIssue.id,
      version: reorderedIssue.version,
      beforeIssueId: null,
    };
    const movedToEnd = await reorderIssue(
      mutation("http://orbit.local/api/v1/issues/reorder", "POST", moveToEndPayload),
    );
    expect(movedToEnd.status).toBe(200);
    const replayedToEnd = await reorderIssue(
      mutation("http://orbit.local/api/v1/issues/reorder", "POST", moveToEndPayload),
    );
    expect(replayedToEnd.status).toBe(200);
    expect(await body(replayedToEnd)).toEqual(await body(movedToEnd));
    const reusedKey = await reorderIssue(
      mutation("http://orbit.local/api/v1/issues/reorder", "POST", {
        ...moveToEndPayload,
        beforeIssueId: firstIssue.id,
      }),
    );
    expect(reusedKey.status).toBe(409);
    const endReload = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const endIssues = (await body<{ issues: Array<{ id: string }> }>(endReload)).issues;
    expect(endIssues.findIndex((item) => item.id === firstIssue.id)).toBeLessThan(
      endIssues.findIndex((item) => item.id === secondIssue.id),
    );

    for (const [index, colorTheme] of ["coral", "ocean", "violet", "forest", "amber"].entries()) {
      const theme = await updatePreferences(
        mutation("http://orbit.local/api/v1/preferences", "PATCH", {
          idempotencyKey: `preferences-color-theme-${index}`,
          colorTheme,
        }),
      );
      expect(theme.status).toBe(200);
      expect(
        (await body<{ preferences: { colorTheme: string } }>(theme)).preferences.colorTheme,
      ).toBe(colorTheme);
    }
    const reloadedPreferences = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    expect(
      (await body<{ preferences: { colorTheme: string } }>(reloadedPreferences)).preferences
        .colorTheme,
    ).toBe("amber");
    const invalidTheme = await updatePreferences(
      mutation("http://orbit.local/api/v1/preferences", "PATCH", {
        idempotencyKey: "preferences-color-theme-invalid",
        colorTheme: "sepia",
      }),
    );
    expect(invalidTheme.status).toBe(400);
  });

  it("[デシジョンテーブル] Reorder APIのversion / target / lock境界をErrorEnvelopeへ変換する", async () => {
    const first = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "reorder-boundary-create-a",
        title: "一番目",
      }),
    );
    const second = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "reorder-boundary-create-b",
        title: "二番目",
      }),
    );
    const firstIssue = (await body<{ issue: { id: string } }>(first)).issue;
    const secondIssue = (await body<{ issue: { id: string; version: number } }>(second)).issue;
    const stale = await reorderIssue(
      mutation("http://orbit.local/api/v1/issues/reorder", "POST", {
        idempotencyKey: "api-reorder-stale",
        issueId: secondIssue.id,
        version: 0,
        beforeIssueId: firstIssue.id,
      }),
    );
    expect(stale.status).toBe(409);

    const missing = await reorderIssue(
      mutation("http://orbit.local/api/v1/issues/reorder", "POST", {
        idempotencyKey: "api-reorder-missing",
        issueId: secondIssue.id,
        version: secondIssue.version,
        beforeIssueId: "missing-issue",
      }),
    );
    expect(missing.status).toBe(404);

    const emptyTheme = await updatePreferences(
      mutation("http://orbit.local/api/v1/preferences", "PATCH", {
        idempotencyKey: "preferences-color-theme-empty",
        colorTheme: "",
      }),
    );
    expect(emptyTheme.status).toBe(400);

    const ownerStore = getOrbitStore("dev-owner");
    ownerStore.ensureOwner("foreign-owner", "foreign-owner@example.com");
    const foreignIssue = ownerStore.createIssue("foreign-owner", {
      idempotencyKey: "foreign-reorder-issue",
      title: "外部Issue",
    });
    const archived = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "archived-reorder-issue",
        title: "アーカイブIssue",
      }),
    );
    const archivedIssue = (await body<{ issue: { id: string } }>(archived)).issue;
    ownerStore.archiveIssue("dev-owner", archivedIssue.id, "archive-reorder-issue");
    const beforeDestination = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const beforeDestinationOrder = (
      await body<{ issues: Array<{ id: string }> }>(beforeDestination)
    ).issues.map((issue) => issue.id);
    const beforeInvalidReorder = structuredClone(ownerStore.toSnapshot());
    for (const [index, beforeIssueId] of [foreignIssue.id, archivedIssue.id].entries()) {
      const invalidDestination = await reorderIssue(
        mutation("http://orbit.local/api/v1/issues/reorder", "POST", {
          idempotencyKey: `reorder-before-boundary-${index}`,
          issueId: secondIssue.id,
          version: secondIssue.version,
          beforeIssueId,
        }),
      );
      expect(invalidDestination.status).toBe(404);
      expect((await body<{ error: { code: string } }>(invalidDestination)).error.code).toBe(
        "RESOURCE_NOT_FOUND",
      );
    }
    const afterDestination = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    expect(
      (await body<{ issues: Array<{ id: string }> }>(afterDestination)).issues.map(
        (issue) => issue.id,
      ),
    ).toEqual(beforeDestinationOrder);
    for (const [index, issueId] of [
      "missing-target",
      foreignIssue.id,
      archivedIssue.id,
    ].entries()) {
      const missingTarget = await reorderIssue(
        mutation("http://orbit.local/api/v1/issues/reorder", "POST", {
          idempotencyKey: `reorder-target-boundary-${index}`,
          issueId,
          version: 1,
          beforeIssueId: firstIssue.id,
        }),
      );
      expect(missingTarget.status).toBe(404);
      expect((await body<{ error: { code: string } }>(missingTarget)).error.code).toBe(
        "RESOURCE_NOT_FOUND",
      );
    }
    expect(ownerStore.toSnapshot()).toEqual(beforeInvalidReorder);

    const beforeLock = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const beforeLockOrder = (await body<{ issues: Array<{ id: string }> }>(beforeLock)).issues.map(
      (issue) => issue.id,
    );

    await startBackgroundRun(
      mutation("http://orbit.local/api/v1/background-runs", "POST", {
        kind: "maintenance",
        idempotencyKey: "api-reorder-lock-run",
      }),
    );
    const locked = await reorderIssue(
      mutation("http://orbit.local/api/v1/issues/reorder", "POST", {
        idempotencyKey: "api-reorder-locked",
        issueId: secondIssue.id,
        version: secondIssue.version,
        beforeIssueId: firstIssue.id,
      }),
    );
    expect(locked.status).toBe(423);
    const afterLock = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    expect(
      (await body<{ issues: Array<{ id: string }> }>(afterLock)).issues.map((issue) => issue.id),
    ).toEqual(beforeLockOrder);
  });

  it("[異常系] Preferences Store障害は500 ErrorEnvelopeへ変換し、保存を確定しない", async () => {
    const store = getOrbitStore("dev-owner");
    const original = store.updatePreferences;
    store.updatePreferences = (() => {
      throw new Error("forced preferences failure");
    }) as typeof store.updatePreferences;

    try {
      const response = await updatePreferences(
        mutation("http://orbit.local/api/v1/preferences", "PATCH", {
          idempotencyKey: "preferences-forced-failure",
          colorTheme: "ocean",
        }),
      );
      expect(response.status).toBe(500);
      expect((await body<{ error: { code: string } }>(response)).error.code).toBe("INTERNAL_ERROR");
    } finally {
      store.updatePreferences = original;
    }
    expect(store.preferences.get("dev-owner")?.colorTheme).toBe("coral");
  });

  it("[契約] Issue version不一致は409 ErrorEnvelopeを返す", async () => {
    const created = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "http-create-02",
        title: "競合対象",
      }),
    );
    const issue = (await body<{ issue: { id: string } }>(created)).issue;
    const response = await updateIssue(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "http-update-01",
        version: 999,
        patch: { title: "古い更新" },
      }),
      issue.id,
    );
    expect(response.status).toBe(409);
    expect(
      (await body<{ error: { code: string; requestId: string } }>(response)).error,
    ).toMatchObject({ code: "ISSUE_VERSION_CONFLICT" });
    const updated = await updateIssue(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "http-update-02",
        version: 1,
        patch: {
          descriptionJson: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "更新1" }] },
              { type: "paragraph", content: [{ type: "text", text: "更新2" }] },
            ],
          },
        },
      }),
      issue.id,
    );
    expect(updated.status).toBe(200);
    const detail = await getIssue(new Request("http://orbit.local/api/v1/issues/detail"), issue.id);
    expect(detail.status).toBe(200);
    expect((await body<{ issue: { description: string } }>(detail)).issue.description).toBe(
      "更新1\n更新2",
    );
  });

  it("[セキュリティ境界] Mutationは同一Originヘッダーなしで拒否する", async () => {
    const response = await createIssue(
      new Request("http://orbit.local/api/v1/issues", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "blocked-01", title: "拒否" }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await body<{ error: { code: string } }>(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("[状態遷移] Background RunをAPIで起動し、同じrunをchunk継続できる", async () => {
    const started = await startBackgroundRun(
      mutation("http://orbit.local/api/v1/background-runs", "POST", {
        kind: "maintenance",
        idempotencyKey: "http-run-001",
      }),
    );
    expect(started.status).toBe(202);
    const run = (
      await body<{ run: { run_id: string; progress: { cursor: string | null } } }>(started)
    ).run;
    const continued = await continueBackgroundRun(
      mutation("http://orbit.local/api/v1/background-runs", "POST", {
        idempotencyKey: "http-continue-01",
        expected_cursor: run.progress.cursor,
      }),
      run.run_id,
    );
    expect(continued.status).toBe(200);
    expect(
      (await body<{ run: { progress: { step_index: number } } }>(continued)).run.progress
        .step_index,
    ).toBe(1);
  });

  it("[代表値] Issue detail APIがNote / Relation / Activityを返す", async () => {
    const first = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "detail-api-01",
        title: "Detail API対象",
      }),
    );
    const second = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "detail-api-02",
        title: "Detail API関連",
      }),
    );
    const firstId = (await body<{ issue: { id: string } }>(first)).issue.id;
    const secondId = (await body<{ issue: { id: string } }>(second)).issue.id;
    const note = await createIssueNote(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "detail-api-note",
        body: "APIメモ",
      }),
      firstId,
    );
    const noteId = (await body<{ note: { id: string } }>(note)).note.id;
    await updateIssueNote(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "detail-api-note-edit",
        body: "編集済み",
      }),
      firstId,
      noteId,
    );
    const relation = await createIssueRelation(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "detail-api-rel",
        targetIssueId: secondId,
        type: "related",
      }),
      firstId,
    );
    const relationId = (await body<{ relation: { id: string } }>(relation)).relation.id;
    const detail = await getIssue(new Request("http://orbit.local/api/v1/issues/detail"), firstId);
    const detailBody = await body<{
      notes: Array<{ body: string }>;
      relations: Array<{ target: { id: string } }>;
      activity: Array<{ action: string }>;
    }>(detail);
    expect(detail.status).toBe(200);
    expect(detailBody.notes[0].body).toBe("編集済み");
    expect(detailBody.relations[0].target.id).toBe(secondId);
    expect(detailBody.activity.some((event) => event.action === "note.updated")).toBe(true);
    await deleteIssueRelation(
      new Request("http://orbit.local/api/v1/issues", {
        method: "DELETE",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "detail-api-rel-delete",
        },
      }),
      firstId,
      relationId,
    );
    await deleteIssueNote(
      new Request("http://orbit.local/api/v1/issues", {
        method: "DELETE",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "detail-api-note-delete",
        },
      }),
      firstId,
      noteId,
    );
    const missingDeleteKey = await deleteIssueNote(
      new Request("http://orbit.local/api/v1/issues", {
        method: "DELETE",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      }),
      firstId,
      noteId,
    );
    expect(missingDeleteKey.status).toBe(400);
  });

  it("[代表値] Cycle metadata APIは再表示可能なCycleを返す", async () => {
    const initial = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const cycleId = (await body<{ cycles: Array<{ id: string }> }>(initial)).cycles[0].id;
    const input = {
      idempotencyKey: "cycle-api-meta-1",
      nameOverride: "集中Cycle",
      description: "今週の集中テーマ",
    };
    const updated = await updateCycleMetadata(
      mutation("http://orbit.local/api/v1/cycles", "PATCH", input),
      cycleId,
    );
    expect(updated.status).toBe(200);
    const updatedBody = await body<{ cycle: { nameOverride: string; description: string } }>(
      updated,
    );
    expect(updatedBody.cycle).toMatchObject({
      nameOverride: "集中Cycle",
      description: "今週の集中テーマ",
    });
    const replay = await updateCycleMetadata(
      mutation("http://orbit.local/api/v1/cycles", "PATCH", input),
      cycleId,
    );
    expect(replay.status).toBe(200);
    expect((await body<{ cycle: { nameOverride: string } }>(replay)).cycle.nameOverride).toBe(
      "集中Cycle",
    );
    const conflict = await updateCycleMetadata(
      mutation("http://orbit.local/api/v1/cycles", "PATCH", {
        ...input,
        nameOverride: "別Cycle",
      }),
      cycleId,
    );
    expect(conflict.status).toBe(409);
    expect((await body<{ error: { code: string } }>(conflict)).error.code).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );
    const invalid = await updateCycleMetadata(
      mutation("http://orbit.local/api/v1/cycles", "PATCH", {
        idempotencyKey: "cycle-api-meta-invalid",
        nameOverride: "",
      }),
      cycleId,
    );
    expect(invalid.status).toBe(400);
    expect(
      (await body<{ error: { code: string; fieldErrors: Record<string, string[]> } }>(invalid))
        .error,
    ).toMatchObject({ code: "VALIDATION_ERROR", fieldErrors: { nameOverride: expect.any(Array) } });
    const missing = await updateCycleMetadata(
      mutation("http://orbit.local/api/v1/cycles", "PATCH", {
        idempotencyKey: "cycle-api-meta-missing",
        description: "対象なし",
      }),
      "missing-cycle",
    );
    expect(missing.status).toBe(404);
    expect((await body<{ error: { code: string } }>(missing)).error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
    await startBackgroundRun(
      mutation("http://orbit.local/api/v1/background-runs", "POST", {
        kind: "maintenance",
        idempotencyKey: "cycle-api-meta-lock",
      }),
    );
    const locked = await updateCycleMetadata(
      mutation("http://orbit.local/api/v1/cycles", "PATCH", {
        idempotencyKey: "cycle-api-meta-locked",
        description: "ロック中",
      }),
      cycleId,
    );
    expect(locked.status).toBe(423);
    expect((await body<{ error: { code: string } }>(locked)).error.code).toBe(
      "OPERATION_IN_PROGRESS",
    );
  });

  it("[状態遷移] Cycle close APIの同一Idempotency-Key再送は同じ結果に収束する", async () => {
    const initial = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const cycleId = (await body<{ cycles: Array<{ id: string }> }>(initial)).cycles[0].id;
    const closeRequest = () =>
      new Request("http://orbit.local/api/v1/cycles", {
        method: "POST",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "cycle-close-api-1",
        },
      });
    const first = await closeCycle(closeRequest(), cycleId);
    const replay = await closeCycle(closeRequest(), cycleId);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect((await body<{ cycle: { status: string } }>(replay)).cycle.status).toBe("completed");
    const after = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const afterBody = await body<{
      cycles: Array<{ id: string }>;
      issues: Array<{ title: string; cycleId: string | null }>;
    }>(after);
    expect(afterBody.cycles).toHaveLength(4);
    expect(
      afterBody.issues.find((issue) => issue.title === "Mobileの一覧を磨く")?.cycleId,
    ).not.toBe(cycleId);
  });

  it("[状態遷移] Upcoming Cycleをstart APIで開始し、再送をNo-opにする", async () => {
    const initial = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const cycleId = (await body<{ cycles: Array<{ id: string }> }>(initial)).cycles[0].id;
    await closeCycle(
      new Request("http://orbit.local/api/v1/cycles", {
        method: "POST",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "cycle-start-prepare-close",
        },
      }),
      cycleId,
    );
    const afterClose = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const upcomingId = (
      await body<{ cycles: Array<{ id: string; status: string }> }>(afterClose)
    ).cycles.find((cycle) => cycle.status === "upcoming")!.id;
    const request = () =>
      mutation("http://orbit.local/api/v1/cycles/start", "POST", {
        idempotencyKey: "cycle-start-api-1",
      });
    const first = await startCycle(request(), upcomingId);
    const replay = await startCycle(request(), upcomingId);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect((await body<{ cycle: { status: string } }>(replay)).cycle.status).toBe("active");
    const missingKey = await startCycle(
      new Request("http://orbit.local/api/v1/cycles/start", {
        method: "POST",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "header-only-cycle-start",
        },
      }),
      upcomingId,
    );
    expect(missingKey.status).toBe(400);
  });

  it("[状態遷移] IssueのCycle追加・解除は既存version CASとlockを通る", async () => {
    const initial = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const cycleId = (await body<{ cycles: Array<{ id: string }> }>(initial)).cycles[0].id;
    const created = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "cycle-assignment-api-issue",
        title: "Cycle割当対象",
      }),
    );
    const issue = (await body<{ issue: { id: string; version: number } }>(created)).issue;
    const assigned = await updateIssue(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "cycle-assignment-api-add",
        version: issue.version,
        patch: { cycleId },
      }),
      issue.id,
    );
    expect(assigned.status).toBe(200);
    const assignedIssue = (await body<{ issue: { version: number; cycleId: string } }>(assigned))
      .issue;
    expect(assignedIssue).toMatchObject({ version: 2, cycleId });
    const stale = await updateIssue(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "cycle-assignment-api-stale",
        version: 1,
        patch: { cycleId: null },
      }),
      issue.id,
    );
    expect(stale.status).toBe(409);
    expect((await body<{ error: { code: string } }>(stale)).error.code).toBe(
      "ISSUE_VERSION_CONFLICT",
    );
    const removed = await updateIssue(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "cycle-assignment-api-remove",
        version: assignedIssue.version,
        patch: { cycleId: null },
      }),
      issue.id,
    );
    expect(removed.status).toBe(200);
    expect(
      (await body<{ issue: { version: number; cycleId: string | null } }>(removed)).issue,
    ).toMatchObject({
      version: 3,
      cycleId: null,
    });
    await startBackgroundRun(
      mutation("http://orbit.local/api/v1/background-runs", "POST", {
        kind: "maintenance",
        idempotencyKey: "cycle-assignment-api-lock",
      }),
    );
    const locked = await updateIssue(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "cycle-assignment-api-locked",
        version: 3,
        patch: { cycleId: null },
      }),
      issue.id,
    );
    expect(locked.status).toBe(423);
    expect((await body<{ error: { code: string } }>(locked)).error.code).toBe(
      "OPERATION_IN_PROGRESS",
    );
  });

  it("[異常系] Detail APIは不存在 / validation / lockをErrorEnvelopeへ変換する", async () => {
    const created = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "detail-error-issue",
        title: "Detail error対象",
      }),
    );
    const issueId = (await body<{ issue: { id: string } }>(created)).issue.id;
    const missing = await getIssue(
      new Request("http://orbit.local/api/v1/issues/missing"),
      "missing",
    );
    expect(missing.status).toBe(404);

    const invalidNote = await createIssueNote(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "detail-error-note",
        body: "",
      }),
      issueId,
    );
    expect(invalidNote.status).toBe(400);
    expect(
      (await body<{ error: { fieldErrors: Record<string, string[]> } }>(invalidNote)).error
        .fieldErrors.body,
    ).toBeDefined();
    const selfRelation = await createIssueRelation(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "detail-error-self-relation",
        targetIssueId: issueId,
        type: "related",
      }),
      issueId,
    );
    expect(selfRelation.status).toBe(400);
    const missingTarget = await createIssueRelation(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "detail-error-missing-target",
        targetIssueId: "missing-target",
        type: "related",
      }),
      issueId,
    );
    expect(missingTarget.status).toBe(404);
    const missingNoteUpdate = await updateIssueNote(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "detail-error-missing-note",
        body: "更新対象なし",
      }),
      issueId,
      "missing-note",
    );
    expect(missingNoteUpdate.status).toBe(404);
    const missingRelationDelete = await deleteIssueRelation(
      new Request("http://orbit.local/api/v1/issues", {
        method: "DELETE",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "detail-error-missing-relation",
        },
      }),
      issueId,
      "missing-relation",
    );
    expect(missingRelationDelete.status).toBe(404);

    const started = await startBackgroundRun(
      mutation("http://orbit.local/api/v1/background-runs", "POST", {
        kind: "maintenance",
        idempotencyKey: "detail-error-run",
      }),
    );
    expect(started.status).toBe(202);
    const lockedNote = await createIssueNote(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "detail-error-locked-note",
        body: "ロック中",
      }),
      issueId,
    );
    expect(lockedNote.status).toBe(423);
    expect((await body<{ error: { code: string } }>(lockedNote)).error.code).toBe(
      "OPERATION_IN_PROGRESS",
    );
  });

  it("[冪等性] Note / Relation APIの再送は再利用し、内容違いは409にする", async () => {
    const first = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "detail-replay-api-issue-1",
        title: "Replay対象",
      }),
    );
    const second = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "detail-replay-api-issue-2",
        title: "Replay関連先",
      }),
    );
    const firstId = (await body<{ issue: { id: string } }>(first)).issue.id;
    const secondId = (await body<{ issue: { id: string } }>(second)).issue.id;
    const noteInput = { idempotencyKey: "detail-replay-api-note", body: "同じメモ" };
    const note = await createIssueNote(
      mutation("http://orbit.local/api/v1/issues", "POST", noteInput),
      firstId,
    );
    const replayedNote = await createIssueNote(
      mutation("http://orbit.local/api/v1/issues", "POST", noteInput),
      firstId,
    );
    const noteBody = await body<{ note: { id: string } }>(note);
    const replayedNoteBody = await body<{ note: { id: string } }>(replayedNote);
    expect(note.status).toBe(201);
    expect(replayedNoteBody.note.id).toBe(noteBody.note.id);
    const noteConflict = await createIssueNote(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        ...noteInput,
        body: "異なるメモ",
      }),
      firstId,
    );
    expect(noteConflict.status).toBe(409);

    const noteId = noteBody.note.id;
    const updateInput = { idempotencyKey: "detail-replay-api-note-update", body: "更新メモ" };
    const updated = await updateIssueNote(
      mutation("http://orbit.local/api/v1/issues", "PATCH", updateInput),
      firstId,
      noteId,
    );
    const replayedUpdate = await updateIssueNote(
      mutation("http://orbit.local/api/v1/issues", "PATCH", updateInput),
      firstId,
      noteId,
    );
    expect(updated.status).toBe(200);
    expect((await body<{ note: { body: string } }>(replayedUpdate)).note.body).toBe("更新メモ");
    const updateConflict = await updateIssueNote(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        ...updateInput,
        body: "別の更新",
      }),
      firstId,
      noteId,
    );
    expect(updateConflict.status).toBe(409);

    const relationInput = {
      idempotencyKey: "detail-replay-api-relation",
      targetIssueId: secondId,
      type: "related",
    } as const;
    const relation = await createIssueRelation(
      mutation("http://orbit.local/api/v1/issues", "POST", relationInput),
      firstId,
    );
    const replayedRelation = await createIssueRelation(
      mutation("http://orbit.local/api/v1/issues", "POST", relationInput),
      firstId,
    );
    const relationBody = await body<{ relation: { id: string } }>(relation);
    const replayedRelationBody = await body<{ relation: { id: string } }>(replayedRelation);
    expect(relation.status).toBe(201);
    expect(replayedRelationBody.relation.id).toBe(relationBody.relation.id);
    const relationConflict = await createIssueRelation(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        ...relationInput,
        type: "blocking",
      }),
      firstId,
    );
    expect(relationConflict.status).toBe(409);

    const relationId = relationBody.relation.id;
    const deleteNoteRequest = () =>
      new Request("http://orbit.local/api/v1/issues", {
        method: "DELETE",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "detail-replay-api-note-delete",
        },
      });
    const deleteRelationRequest = () =>
      new Request("http://orbit.local/api/v1/issues", {
        method: "DELETE",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "detail-replay-api-relation-delete",
        },
      });
    expect((await deleteIssueNote(deleteNoteRequest(), firstId, noteId)).status).toBe(200);
    expect((await deleteIssueNote(deleteNoteRequest(), firstId, noteId)).status).toBe(200);
    expect((await deleteIssueRelation(deleteRelationRequest(), firstId, relationId)).status).toBe(
      200,
    );
    expect((await deleteIssueRelation(deleteRelationRequest(), firstId, relationId)).status).toBe(
      200,
    );
  });

  it("[代表値] Project detail metadataとSaved View CRUD APIを通す", async () => {
    const bootstrapResponse = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const projectStatusId = (
      await body<{ projectStatuses: Array<{ id: string }> }>(bootstrapResponse)
    ).projectStatuses[1].id;
    const invalidProjectCreateKey = await createProject(
      mutation("http://orbit.local/api/v1/projects", "POST", {
        idempotencyKey: 123,
        name: "型違反Project",
      }),
    );
    expect(invalidProjectCreateKey.status).toBe(400);
    const invalidProjectCreateUnknown = await createProject(
      mutation("http://orbit.local/api/v1/projects", "POST", {
        idempotencyKey: "project-api-create-unknown",
        name: "未知キーProject",
        secret: true,
      }),
    );
    expect(invalidProjectCreateUnknown.status).toBe(400);
    const missingProjectCreateKey = await createProject(
      mutation("http://orbit.local/api/v1/projects", "POST", {
        name: "キーなしProject",
      }),
    );
    expect(missingProjectCreateKey.status).toBe(400);
    const projectResponse = await createProject(
      mutation("http://orbit.local/api/v1/projects", "POST", {
        idempotencyKey: "project-api-1",
        name: "API Project",
      }),
    );
    const projectId = (await body<{ project: { id: string } }>(projectResponse)).project.id;
    const updatedProject = await updateProject(
      mutation("http://orbit.local/api/v1/projects", "PATCH", {
        idempotencyKey: "project-api-update-1",
        patch: { name: "API Project Updated", description: "説明" },
      }),
      projectId,
    );
    expect(updatedProject.status).toBe(200);
    expect(
      (await body<{ project: { description: string } }>(updatedProject)).project.description,
    ).toBe("説明");
    const flatProjectUpdateInput = {
      idempotencyKey: "project-api-flat-update",
      name: "API Project Flat",
      description: "Flat payload",
      statusId: projectStatusId,
      targetAt: 1_700_100_000_000,
    };
    const flatProjectUpdate = await updateProject(
      mutation("http://orbit.local/api/v1/projects", "PATCH", flatProjectUpdateInput),
      projectId,
    );
    expect(flatProjectUpdate.status).toBe(200);
    expect(
      (
        await body<{
          project: { name: string; description: string; statusId: string; targetAt: number };
        }>(flatProjectUpdate)
      ).project,
    ).toMatchObject({
      name: "API Project Flat",
      description: "Flat payload",
      statusId: projectStatusId,
      targetAt: 1_700_100_000_000,
    });
    const replayedFlatProject = await updateProject(
      mutation("http://orbit.local/api/v1/projects", "PATCH", flatProjectUpdateInput),
      projectId,
    );
    expect(
      (await body<{ project: { name: string; statusId: string } }>(replayedFlatProject)).project,
    ).toMatchObject({ name: "API Project Flat", statusId: projectStatusId });
    const projectConflict = await updateProject(
      mutation("http://orbit.local/api/v1/projects", "PATCH", {
        idempotencyKey: "project-api-update-1",
        patch: { name: "別Project" },
      }),
      projectId,
    );
    expect(projectConflict.status).toBe(409);
    expect((await body<{ error: { code: string } }>(projectConflict)).error.code).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );
    const invalidProject = await updateProject(
      mutation("http://orbit.local/api/v1/projects", "PATCH", {
        idempotencyKey: "project-api-invalid",
        patch: { name: "" },
      }),
      projectId,
    );
    expect(invalidProject.status).toBe(400);
    expect(
      (
        await body<{ error: { code: string; fieldErrors: Record<string, string[]> } }>(
          invalidProject,
        )
      ).error,
    ).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: { name: expect.arrayContaining([expect.any(String)]) },
    });
    const retriedProject = await updateProject(
      mutation("http://orbit.local/api/v1/projects", "PATCH", {
        idempotencyKey: "project-api-retry-after-invalid",
        patch: { name: "API Project Retry" },
      }),
      projectId,
    );
    expect((await body<{ project: { name: string } }>(retriedProject)).project.name).toBe(
      "API Project Retry",
    );
    const invalidProjectEnvelope = await updateProject(
      mutation("http://orbit.local/api/v1/projects", "PATCH", {
        idempotencyKey: "project-api-envelope-unknown",
        patch: { name: "Should reject" },
        secret: true,
      }),
      projectId,
    );
    expect(invalidProjectEnvelope.status).toBe(400);
    const invalidProjectKey = await updateProject(
      mutation("http://orbit.local/api/v1/projects", "PATCH", {
        idempotencyKey: 123,
        patch: { name: "型違反" },
      }),
      projectId,
    );
    expect(invalidProjectKey.status).toBe(400);
    const invalidProjectNullKey = await updateProject(
      mutation("http://orbit.local/api/v1/projects", "PATCH", {
        idempotencyKey: null,
        patch: { name: "nullキー" },
      }),
      projectId,
    );
    expect(invalidProjectNullKey.status).toBe(400);
    const invalidNestedProjectKey = await updateProject(
      mutation("http://orbit.local/api/v1/projects", "PATCH", {
        idempotencyKey: "project-api-nested-key",
        patch: { idempotencyKey: "nested", name: "予約キー" },
      }),
      projectId,
    );
    expect(invalidNestedProjectKey.status).toBe(400);
    const missingProject = await updateProject(
      mutation("http://orbit.local/api/v1/projects", "PATCH", {
        idempotencyKey: "project-api-missing",
        patch: { name: "Missing" },
      }),
      "missing-project",
    );
    expect(missingProject.status).toBe(404);
    expect((await body<{ error: { code: string } }>(missingProject)).error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );

    const query = {
      mode: "list" as const,
      filter: {},
      showEmptyGroups: false,
      order: "manual" as const,
      layout: { priority: true },
      limit: 100,
    };
    const viewResponse = await createView(
      mutation("http://orbit.local/api/v1/views", "POST", {
        idempotencyKey: "view-api-1",
        name: "API View",
        query,
      }),
    );
    expect(viewResponse.status).toBe(201);
    const viewId = (await body<{ view: { id: string } }>(viewResponse)).view.id;
    const invalidView = await createView(
      mutation("http://orbit.local/api/v1/views", "POST", {
        idempotencyKey: "view-api-invalid",
        name: "",
        query,
      }),
    );
    expect(invalidView.status).toBe(400);
    expect(
      (await body<{ error: { code: string; fieldErrors: Record<string, string[]> } }>(invalidView))
        .error,
    ).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: { name: expect.arrayContaining([expect.any(String)]) },
    });
    const invalidViewKey = await createView(
      mutation("http://orbit.local/api/v1/views", "POST", {
        idempotencyKey: 123,
        name: "型違反View",
        query,
      }),
    );
    expect(invalidViewKey.status).toBe(400);
    const invalidViewNullKey = await createView(
      mutation("http://orbit.local/api/v1/views", "POST", {
        idempotencyKey: null,
        name: "nullキーView",
        query,
      }),
    );
    expect(invalidViewNullKey.status).toBe(400);
    const missingViewCreateKey = await createView(
      mutation("http://orbit.local/api/v1/views", "POST", { name: "キーなしView", query }),
    );
    expect(missingViewCreateKey.status).toBe(400);
    const missingView = await updateView(
      mutation("http://orbit.local/api/v1/views", "PATCH", {
        idempotencyKey: "view-api-missing",
        name: "Missing",
      }),
      "missing-view",
    );
    expect(missingView.status).toBe(404);
    expect((await body<{ error: { code: string } }>(missingView)).error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
    const viewUpdateInput = {
      idempotencyKey: "view-api-update-1",
      name: "API View Updated",
      query: { ...query, mode: "board" as const, order: "priority" as const },
      layout: { status: true },
    };
    const updatedView = await updateView(
      mutation("http://orbit.local/api/v1/views", "PATCH", {
        ...viewUpdateInput,
      }),
      viewId,
    );
    expect(updatedView.status).toBe(200);
    expect(
      (
        await body<{
          view: {
            name: string;
            query: { mode: string; order: string; layout: Record<string, boolean> };
            layout: Record<string, boolean>;
          };
        }>(updatedView)
      ).view,
    ).toMatchObject({
      name: "API View Updated",
      query: { mode: "board", order: "priority", layout: { status: true } },
      layout: { status: true },
    });
    const replayedView = await updateView(
      mutation("http://orbit.local/api/v1/views", "PATCH", viewUpdateInput),
      viewId,
    );
    expect(replayedView.status).toBe(200);
    expect(
      (await body<{ view: { name: string; query: { mode: string; order: string } } }>(replayedView))
        .view,
    ).toMatchObject({ name: "API View Updated", query: { mode: "board", order: "priority" } });
    const viewConflict = await updateView(
      mutation("http://orbit.local/api/v1/views", "PATCH", {
        ...viewUpdateInput,
        name: "別View",
      }),
      viewId,
    );
    expect(viewConflict.status).toBe(409);
    expect((await body<{ error: { code: string } }>(viewConflict)).error.code).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );
    const invalidViewUpdateKey = await updateView(
      mutation("http://orbit.local/api/v1/views", "PATCH", {
        idempotencyKey: 123,
        name: "型違反更新",
      }),
      viewId,
    );
    expect(invalidViewUpdateKey.status).toBe(400);
    const invalidViewUpdateNullKey = await updateView(
      mutation("http://orbit.local/api/v1/views", "PATCH", {
        idempotencyKey: null,
        name: "nullキー更新",
      }),
      viewId,
    );
    expect(invalidViewUpdateNullKey.status).toBe(400);
    const deleteViewRequest = () =>
      new Request("http://orbit.local/api/v1/views", {
        method: "DELETE",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "view-api-delete-1",
        },
      });
    const missingDeleteKey = await deleteView(
      new Request("http://orbit.local/api/v1/views", {
        method: "DELETE",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      }),
      viewId,
    );
    expect(missingDeleteKey.status).toBe(400);
    const deletedView = await deleteView(deleteViewRequest(), viewId);
    expect(deletedView.status).toBe(200);
    expect((await body<{ ok: boolean }>(deletedView)).ok).toBe(true);
    expect((await deleteView(deleteViewRequest(), viewId)).status).toBe(200);
    const viewsAfterDelete = await listViews(new Request("http://orbit.local/api/v1/views"));
    expect(
      (await body<{ items: Array<{ id: string }> }>(viewsAfterDelete)).items.some(
        (item) => item.id === viewId,
      ),
    ).toBe(false);
  });

  it("[異常系] Project / Saved View mutationはRuntime lock中に423になる", async () => {
    const projectResponse = await createProject(
      mutation("http://orbit.local/api/v1/projects", "POST", {
        idempotencyKey: "project-lock-api-1",
        name: "Lock Project",
      }),
    );
    const projectId = (await body<{ project: { id: string } }>(projectResponse)).project.id;
    const viewResponse = await createView(
      mutation("http://orbit.local/api/v1/views", "POST", {
        idempotencyKey: "view-lock-api-1",
        name: "Lock View",
        query: {
          mode: "list",
          filter: {},
          showEmptyGroups: false,
          order: "manual",
          layout: {},
          limit: 100,
        },
      }),
    );
    const viewId = (await body<{ view: { id: string } }>(viewResponse)).view.id;
    await startBackgroundRun(
      mutation("http://orbit.local/api/v1/background-runs", "POST", {
        kind: "maintenance",
        idempotencyKey: "project-view-lock-run",
      }),
    );
    const lockedStore = getOrbitStore("dev-owner");
    const beforeLockedMutations = {
      projects: structuredClone([...lockedStore.projects.entries()]),
      views: structuredClone([...lockedStore.views.entries()]),
      activities: structuredClone(lockedStore.activities),
      outbox: structuredClone(lockedStore.outbox),
      receipts: structuredClone([...lockedStore.receipts.entries()]),
    };
    const lockedProject = await updateProject(
      mutation("http://orbit.local/api/v1/projects", "PATCH", {
        idempotencyKey: "project-lock-api-update",
        patch: { name: "拒否" },
      }),
      projectId,
    );
    const lockedView = await updateView(
      mutation("http://orbit.local/api/v1/views", "PATCH", {
        idempotencyKey: "view-lock-api-update",
        name: "拒否",
      }),
      viewId,
    );
    expect(lockedProject.status).toBe(423);
    expect(lockedView.status).toBe(423);
    expect((await body<{ error: { code: string } }>(lockedProject)).error.code).toBe(
      "OPERATION_IN_PROGRESS",
    );
    expect((await body<{ error: { code: string } }>(lockedView)).error.code).toBe(
      "OPERATION_IN_PROGRESS",
    );
    const lockedCreate = await createProject(
      mutation("http://orbit.local/api/v1/projects", "POST", {
        idempotencyKey: "project-lock-api-create",
        name: "拒否",
      }),
    );
    const lockedDelete = await deleteView(
      new Request("http://orbit.local/api/v1/views", {
        method: "DELETE",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "view-lock-api-delete",
        },
      }),
      viewId,
    );
    expect(lockedCreate.status).toBe(423);
    expect(lockedDelete.status).toBe(423);
    expect((await body<{ error: { code: string } }>(lockedCreate)).error.code).toBe(
      "OPERATION_IN_PROGRESS",
    );
    expect((await body<{ error: { code: string } }>(lockedDelete)).error.code).toBe(
      "OPERATION_IN_PROGRESS",
    );
    const lockedCreateView = await createView(
      mutation("http://orbit.local/api/v1/views", "POST", {
        idempotencyKey: "view-lock-api-create",
        name: "拒否View",
        query: {
          mode: "list",
          filter: {},
          showEmptyGroups: false,
          order: "manual",
          layout: {},
          limit: 100,
        },
      }),
    );
    expect(lockedCreateView.status).toBe(423);
    expect(structuredClone([...lockedStore.projects.entries()])).toEqual(
      beforeLockedMutations.projects,
    );
    expect(structuredClone([...lockedStore.views.entries()])).toEqual(beforeLockedMutations.views);
    expect(structuredClone(lockedStore.activities)).toEqual(beforeLockedMutations.activities);
    expect(structuredClone(lockedStore.outbox)).toEqual(beforeLockedMutations.outbox);
    expect(structuredClone([...lockedStore.receipts.entries()])).toEqual(
      beforeLockedMutations.receipts,
    );
  });
});
