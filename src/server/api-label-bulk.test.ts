import { beforeEach, describe, expect, it } from "vitest";
import {
  bootstrap,
  bulkUpdateIssues,
  createIssue,
  createLabel,
  deleteLabel,
  listIssues,
  listLabels,
  startBackgroundRun,
  updateLabel,
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

describe("Label / Issue Bulk HTTP service", () => {
  beforeEach(() => resetOrbitStores());

  it("[代表値] Label CRUD APIとIssue参照削除を通す", async () => {
    const created = await createLabel(
      mutation("http://orbit.local/api/v1/labels", "POST", {
        idempotencyKey: "label-api-create",
        name: "Bug",
        color: "#E05252",
      }),
    );
    expect(created.status).toBe(201);
    const label = (await body<{ label: { id: string } }>(created)).label;
    const boot = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    expect(
      (await body<{ labels: Array<{ id: string }> }>(boot)).labels.map((item) => item.id),
    ).toEqual([label.id]);
    expect(
      (
        await body<{ items: Array<{ id: string }> }>(
          await listLabels(new Request("http://orbit.local/api/v1/labels")),
        )
      ).items,
    ).toHaveLength(1);
    const updated = await updateLabel(
      mutation("http://orbit.local/api/v1/labels", "PATCH", {
        idempotencyKey: "label-api-update",
        name: "Defect",
        color: "#AA1122",
      }),
      label.id,
    );
    expect(updated.status).toBe(200);
    expect((await body<{ label: { name: string; color: string } }>(updated)).label).toMatchObject({
      name: "Defect",
      color: "#AA1122",
    });
    const labeledIssue = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "label-api-attached-issue",
        title: "Attached",
        labelIds: [label.id],
      }),
    );
    expect(labeledIssue.status).toBe(201);
    const missingDeleteKey = await deleteLabel(
      new Request("http://orbit.local/api/v1/labels", {
        method: "DELETE",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      }),
      label.id,
    );
    expect(missingDeleteKey.status).toBe(400);
    const deleted = await deleteLabel(
      new Request("http://orbit.local/api/v1/labels", {
        method: "DELETE",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "label-api-delete",
        },
      }),
      label.id,
    );
    expect(deleted.status).toBe(200);
    expect(
      (
        await body<{ items: unknown[] }>(
          await listLabels(new Request("http://orbit.local/api/v1/labels")),
        )
      ).items,
    ).toEqual([]);
    const afterDelete = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const attachedId = (await body<{ issue: { id: string } }>(labeledIssue)).issue.id;
    expect(
      (await body<{ issues: Array<{ id: string; labelIds: string[] }> }>(afterDelete)).issues.find(
        (issue) => issue.id === attachedId,
      )?.labelIds,
    ).toEqual([]);
  });

  it("[状態遷移] Bulk APIは複数Issueを更新し、same-key replay / conflictを返す", async () => {
    const labelResponse = await createLabel(
      mutation("http://orbit.local/api/v1/labels", "POST", {
        idempotencyKey: "bulk-api-label",
        name: "Bulk",
        color: "#334455",
      }),
    );
    const labelId = (await body<{ label: { id: string } }>(labelResponse)).label.id;
    const createdIssues = await Promise.all(
      ["A", "B"].map((title, index) =>
        createIssue(
          mutation("http://orbit.local/api/v1/issues", "POST", {
            idempotencyKey: `bulk-api-issue-${index}`,
            title,
          }),
        ),
      ),
    );
    const issueIds = await Promise.all(
      createdIssues.map(
        async (response) => (await body<{ issue: { id: string } }>(response)).issue.id,
      ),
    );
    const input = {
      idempotencyKey: "bulk-api-update",
      issueIds: [issueIds[0], issueIds[1], issueIds[0]],
      patch: { labelIds: [labelId] },
    };
    const updated = await bulkUpdateIssues(
      mutation("http://orbit.local/api/v1/issues/bulk", "POST", input),
    );
    expect(updated.status).toBe(200);
    expect(
      (await body<{ items: Array<{ labelIds: string[]; version: number }> }>(updated)).items,
    ).toHaveLength(2);
    const filtered = await listIssues(
      new Request(`http://orbit.local/api/v1/issues?label=${labelId}`),
    );
    expect(
      (await body<{ items: Array<{ id: string }> }>(filtered)).items.map((item) => item.id),
    ).toEqual(expect.arrayContaining(issueIds));
    const replayed = await bulkUpdateIssues(
      mutation("http://orbit.local/api/v1/issues/bulk", "POST", input),
    );
    expect(replayed.status).toBe(200);
    const replayStore = getOrbitStore("dev-owner");
    const beforeConflict = {
      issues: structuredClone([...replayStore.issues.entries()]),
      activities: structuredClone(replayStore.activities),
      outbox: structuredClone(replayStore.outbox),
      receipts: structuredClone([...replayStore.receipts.entries()]),
    };
    const conflict = await bulkUpdateIssues(
      mutation("http://orbit.local/api/v1/issues/bulk", "POST", {
        ...input,
        patch: { priority: "urgent" },
      }),
    );
    expect(conflict.status).toBe(409);
    expect(structuredClone([...replayStore.issues.entries()])).toEqual(beforeConflict.issues);
    expect(structuredClone(replayStore.activities)).toEqual(beforeConflict.activities);
    expect(structuredClone(replayStore.outbox)).toEqual(beforeConflict.outbox);
    expect(structuredClone([...replayStore.receipts.entries()])).toEqual(beforeConflict.receipts);
  });

  it("[異常系] Bulk validation / lockは状態と台帳を変更しない", async () => {
    const first = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "bulk-api-invalid-issue",
        title: "対象",
      }),
    );
    const issueId = (await body<{ issue: { id: string } }>(first)).issue.id;
    const store = getOrbitStore("dev-owner");
    const before = {
      issues: structuredClone([...store.issues.entries()]),
      activities: structuredClone(store.activities),
      outbox: structuredClone(store.outbox),
      receipts: structuredClone([...store.receipts.entries()]),
    };
    const invalid = await bulkUpdateIssues(
      mutation("http://orbit.local/api/v1/issues/bulk", "POST", {
        idempotencyKey: "bulk-api-invalid-target",
        issueIds: [issueId, "missing"],
        patch: { priority: "low" },
      }),
    );
    expect(invalid.status).toBe(404);
    expect(structuredClone([...store.issues.entries()])).toEqual(before.issues);
    expect(structuredClone(store.activities)).toEqual(before.activities);
    expect(structuredClone(store.outbox)).toEqual(before.outbox);
    expect(structuredClone([...store.receipts.entries()])).toEqual(before.receipts);
    const labelResponse = await createLabel(
      mutation("http://orbit.local/api/v1/labels", "POST", {
        idempotencyKey: "bulk-api-lock-label",
        name: "Locked",
        color: "#445566",
      }),
    );
    const labelId = (await body<{ label: { id: string } }>(labelResponse)).label.id;
    await startBackgroundRun(
      mutation("http://orbit.local/api/v1/background-runs", "POST", {
        kind: "maintenance",
        idempotencyKey: "bulk-api-lock",
      }),
    );
    const lockedBefore = {
      labels: structuredClone([...store.labels.entries()]),
      issues: structuredClone([...store.issues.entries()]),
      activities: structuredClone(store.activities),
      outbox: structuredClone(store.outbox),
      receipts: structuredClone([...store.receipts.entries()]),
    };
    const locked = await bulkUpdateIssues(
      mutation("http://orbit.local/api/v1/issues/bulk", "POST", {
        idempotencyKey: "bulk-api-locked",
        issueIds: [issueId],
        patch: { priority: "urgent" },
      }),
    );
    expect(locked.status).toBe(423);
    expect((await body<{ error: { code: string } }>(locked)).error.code).toBe(
      "OPERATION_IN_PROGRESS",
    );
    const lockedLabel = await updateLabel(
      mutation("http://orbit.local/api/v1/labels", "PATCH", {
        idempotencyKey: "bulk-api-locked-label-update",
        name: "拒否",
      }),
      labelId,
    );
    expect(lockedLabel.status).toBe(423);
    const lockedDeleteLabel = await deleteLabel(
      new Request("http://orbit.local/api/v1/labels", {
        method: "DELETE",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "bulk-api-locked-label-delete",
        },
      }),
      labelId,
    );
    expect(lockedDeleteLabel.status).toBe(423);
    expect(structuredClone([...store.labels.entries()])).toEqual(lockedBefore.labels);
    expect(structuredClone([...store.issues.entries()])).toEqual(lockedBefore.issues);
    expect(structuredClone(store.activities)).toEqual(lockedBefore.activities);
    expect(structuredClone(store.outbox)).toEqual(lockedBefore.outbox);
    expect(structuredClone([...store.receipts.entries()])).toEqual(lockedBefore.receipts);
  });

  it("[契約] Label / Bulk APIはunknown keyと型違反を400にする", async () => {
    const invalidLabel = await createLabel(
      mutation("http://orbit.local/api/v1/labels", "POST", {
        idempotencyKey: "label-api-invalid",
        name: "Bad",
        color: "red",
      }),
    );
    expect(invalidLabel.status).toBe(400);
    expect(
      (await body<{ error: { fieldErrors: Record<string, string[]> } }>(invalidLabel)).error,
    ).toMatchObject({ fieldErrors: { color: expect.arrayContaining([expect.any(String)]) } });
    const invalidLabelUnknown = await createLabel(
      mutation("http://orbit.local/api/v1/labels", "POST", {
        idempotencyKey: "label-api-unknown",
        name: "Unknown",
        color: "#123456",
        secret: true,
      }),
    );
    expect(invalidLabelUnknown.status).toBe(400);
    const invalidLabelKey = await createLabel(
      mutation("http://orbit.local/api/v1/labels", "POST", {
        idempotencyKey: 123,
        name: "Numeric",
        color: "#123456",
      }),
    );
    expect(invalidLabelKey.status).toBe(400);
    const missingLabelKey = await createLabel(
      mutation("http://orbit.local/api/v1/labels", "POST", {
        name: "Missing",
        color: "#123456",
      }),
    );
    expect(missingLabelKey.status).toBe(400);
    const invalidBulk = await bulkUpdateIssues(
      mutation("http://orbit.local/api/v1/issues/bulk", "POST", {
        idempotencyKey: "bulk-api-invalid-contract",
        issueIds: [],
        patch: { priority: "high" },
      }),
    );
    expect(invalidBulk.status).toBe(400);
    expect(
      (await body<{ error: { fieldErrors: Record<string, string[]> } }>(invalidBulk)).error,
    ).toMatchObject({ fieldErrors: { issueIds: expect.arrayContaining([expect.any(String)]) } });
    const invalidBulkKey = await bulkUpdateIssues(
      mutation("http://orbit.local/api/v1/issues/bulk", "POST", {
        idempotencyKey: null,
        issueIds: ["missing"],
        patch: { priority: "high" },
      }),
    );
    expect(invalidBulkKey.status).toBe(400);
  });
});
