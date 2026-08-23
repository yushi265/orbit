import { beforeEach, describe, expect, it } from "vitest";
import {
  bootstrap,
  continueBackgroundRun,
  createIssue,
  createIssueNote,
  createIssueRelation,
  deleteIssueNote,
  deleteIssueRelation,
  getIssue,
  startBackgroundRun,
  updateIssueNote,
  updateIssue,
} from "./api";
import { resetOrbitStores } from "./store";

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
});
