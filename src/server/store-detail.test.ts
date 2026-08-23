import { describe, expect, it } from "vitest";
import { OrbitStore } from "./store";

function setup() {
  const store = new OrbitStore(() => 1_700_000_000_000);
  store.ensureOwner("owner", "owner@example.com");
  const first = store.createIssue("owner", { idempotencyKey: "detail-issue-1", title: "詳細対象" });
  const second = store.createIssue("owner", { idempotencyKey: "detail-issue-2", title: "関連先" });
  return { store, first, second };
}

describe("Issue detail service", () => {
  it("[代表値] detailはIssue / notes / relations / activityをOwner scopedで返す", () => {
    const { store, first } = setup();
    store.createIssueNote("owner", first.id, {
      idempotencyKey: "detail-note-1",
      body: "調査メモ",
    });
    const detail = store.getIssueDetail("owner", first.id);

    expect(detail.issue.id).toBe(first.id);
    expect(detail.notes).toHaveLength(1);
    expect(detail.notes[0]).toMatchObject({ issueId: first.id, body: "調査メモ", deletedAt: null });
    expect(detail.relations).toEqual([]);
    expect(detail.activity.some((event) => event.action === "created")).toBe(true);
    expect("mutationKey" in detail.activity[0]).toBe(false);
  });

  it("[状態遷移] note create → edit → deleteはActivityを1回ずつ追加する", () => {
    const { store, first } = setup();
    const note = store.createIssueNote("owner", first.id, {
      idempotencyKey: "detail-note-2",
      body: "最初",
    });
    const edited = store.updateIssueNote("owner", first.id, note.id, {
      idempotencyKey: "detail-note-3",
      body: "編集後",
    });
    store.deleteIssueNote("owner", first.id, note.id, "detail-note-4");
    const activityAfterDelete = store.activities.length;
    const outboxAfterDelete = store.outbox.length;
    expect(() => store.deleteIssueNote("owner", first.id, note.id, "detail-note-4")).not.toThrow();
    expect(store.activities).toHaveLength(activityAfterDelete);
    expect(store.outbox).toHaveLength(outboxAfterDelete);

    expect(edited.body).toBe("編集後");
    expect(store.getIssueDetail("owner", first.id).notes).toEqual([]);
    expect(
      store.activities.filter(
        (event) => event.entityId === first.id && event.action.startsWith("note"),
      ).length,
    ).toBe(3);
  });

  it("[冪等性] Noteの同一Key再送は再利用し、内容違いは409にする", () => {
    const { store, first } = setup();
    const note = store.createIssueNote("owner", first.id, {
      idempotencyKey: "detail-note-replay-create",
      body: "同じ内容",
    });
    expect(
      store.createIssueNote("owner", first.id, {
        idempotencyKey: "detail-note-replay-create",
        body: "同じ内容",
      }).id,
    ).toBe(note.id);
    expect(() =>
      store.createIssueNote("owner", first.id, {
        idempotencyKey: "detail-note-replay-create",
        body: "異なる内容",
      }),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" }));

    const edited = store.updateIssueNote("owner", first.id, note.id, {
      idempotencyKey: "detail-note-replay-update",
      body: "更新内容",
    });
    expect(
      store.updateIssueNote("owner", first.id, note.id, {
        idempotencyKey: "detail-note-replay-update",
        body: "更新内容",
      }).body,
    ).toBe(edited.body);
    expect(() =>
      store.updateIssueNote("owner", first.id, note.id, {
        idempotencyKey: "detail-note-replay-update",
        body: "別の更新",
      }),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" }));
  });

  it("[デシジョンテーブル] relationはvalidだけを追加し、self / duplicate / other ownerを拒否する", () => {
    const { store, first, second } = setup();
    const relation = store.createIssueRelation("owner", first.id, {
      idempotencyKey: "detail-rel-1",
      targetIssueId: second.id,
      type: "related",
    });
    expect(store.getIssueDetail("owner", first.id).relations[0].target.identifier).toBe(
      second.identifier,
    );
    expect(() =>
      store.createIssueRelation("owner", first.id, {
        idempotencyKey: "detail-rel-2",
        targetIssueId: first.id,
        type: "related",
      }),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    const replayedRelation = store.createIssueRelation("owner", first.id, {
      idempotencyKey: "detail-rel-3",
      targetIssueId: second.id,
      type: "related",
    });
    expect(replayedRelation.id).toBe(relation.id);
    expect(() =>
      store.createIssueRelation("owner", first.id, {
        idempotencyKey: "detail-rel-3",
        targetIssueId: second.id,
        type: "blocking",
      }),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" }));
    expect(store.getIssueDetail("owner", first.id).relations).toHaveLength(1);
    const activityBeforeDuplicate = store.activities.length;
    const outboxBeforeDuplicate = store.outbox.length;
    expect(
      store.createIssueRelation("owner", first.id, {
        idempotencyKey: "detail-rel-3b",
        targetIssueId: second.id,
        type: "related",
      }).id,
    ).toBe(relation.id);
    expect(store.activities).toHaveLength(activityBeforeDuplicate);
    expect(store.outbox).toHaveLength(outboxBeforeDuplicate);
    store.ensureOwner("other", "other@example.com");
    const other = store.createIssue("other", {
      idempotencyKey: "detail-other-1",
      title: "他Owner",
    });
    expect(() =>
      store.createIssueRelation("owner", first.id, {
        idempotencyKey: "detail-rel-4",
        targetIssueId: other.id,
        type: "blocking",
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    store.deleteIssueRelation("owner", first.id, relation.id, "detail-rel-5");
    const activityAfterRelationDelete = store.activities.length;
    const outboxAfterRelationDelete = store.outbox.length;
    expect(() =>
      store.deleteIssueRelation("owner", first.id, relation.id, "detail-rel-5"),
    ).not.toThrow();
    expect(store.activities).toHaveLength(activityAfterRelationDelete);
    expect(store.outbox).toHaveLength(outboxAfterRelationDelete);
    expect(store.getIssueDetail("owner", first.id).relations).toEqual([]);
  });

  it("[境界値] Note bodyの長さをServiceでも検証する", () => {
    const { store, first } = setup();
    expect(
      store.createIssueNote("owner", first.id, { idempotencyKey: "detail-note-valid-1", body: "a" })
        .body,
    ).toBe("a");
    expect(
      store.createIssueNote("owner", first.id, {
        idempotencyKey: "detail-note-valid-2",
        body: "a".repeat(10_000),
      }).body,
    ).toHaveLength(10_000);
    expect(() =>
      store.createIssueNote("owner", first.id, { idempotencyKey: "detail-note-5", body: "" }),
    ).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() =>
      store.createIssueNote("owner", first.id, {
        idempotencyKey: "detail-note-6",
        body: "a".repeat(10_001),
      }),
    ).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("[表示変換] Relationを逆側Issueから見ると方向ラベルを反転する", () => {
    const { store, first, second } = setup();
    store.createIssueRelation("owner", first.id, {
      idempotencyKey: "detail-rel-direction",
      targetIssueId: second.id,
      type: "blocking",
    });

    expect(store.getIssueDetail("owner", first.id).relations[0]).toMatchObject({
      type: "blocking",
      target: { id: second.id },
    });
    expect(store.getIssueDetail("owner", second.id).relations[0]).toMatchObject({
      type: "blocked_by",
      target: { id: first.id },
    });
  });

  it("[デシジョンテーブル] Owner外Detail / Note / Relationは404で副作用なし", () => {
    const { store, first } = setup();
    store.ensureOwner("other", "other@example.com");
    const other = store.createIssue("other", {
      idempotencyKey: "detail-other-2",
      title: "他Owner",
    });
    store.notes.set("foreign-note", {
      id: "foreign-note",
      userId: "other",
      issueId: first.id,
      body: "混入してはいけないメモ",
      createdAt: 1,
      editedAt: null,
      deletedAt: null,
    });
    store.relations.set("foreign-relation", {
      id: "foreign-relation",
      userId: "other",
      sourceIssueId: first.id,
      targetIssueId: other.id,
      type: "related",
      createdAt: 1,
    });
    const before = {
      activities: store.activities.length,
      outbox: store.outbox.length,
      receipts: store.receipts.size,
      notes: store.notes.size,
      relations: store.relations.size,
      version: store.issues.get(first.id)?.version,
    };
    expect(() => store.getIssueDetail("other", first.id)).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
    expect(() =>
      store.createIssueNote("other", first.id, {
        idempotencyKey: "detail-owner-note",
        body: "拒否",
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() =>
      store.createIssueRelation("owner", first.id, {
        idempotencyKey: "detail-owner-rel",
        targetIssueId: other.id,
        type: "blocking",
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(store.activities).toHaveLength(before.activities);
    expect(store.outbox).toHaveLength(before.outbox);
    expect(store.receipts.size).toBe(before.receipts);
    expect(store.notes.size).toBe(before.notes);
    expect(store.relations.size).toBe(before.relations);
    expect(store.issues.get(first.id)?.version).toBe(before.version);
    const ownerDetail = store.getIssueDetail("owner", first.id);
    expect(ownerDetail.notes.some((note) => note.id === "foreign-note")).toBe(false);
    expect(ownerDetail.relations.some((relation) => relation.id === "foreign-relation")).toBe(
      false,
    );
  });

  it("[状態遷移] Background lock中のDetail Mutationは423で副作用を増やさない", () => {
    const { store, first, second } = setup();
    const note = store.createIssueNote("owner", first.id, {
      idempotencyKey: "detail-lock-note-seed",
      body: "ロック対象メモ",
    });
    const relation = store.createIssueRelation("owner", first.id, {
      idempotencyKey: "detail-lock-relation-seed",
      targetIssueId: second.id,
      type: "related",
    });
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "detail-run-lock" });
    const before = {
      activities: store.activities.length,
      outbox: store.outbox.length,
      notes: store.notes.size,
      relations: store.relations.size,
      receipts: store.receipts.size,
      version: first.version,
    };
    expect(() =>
      store.updateIssue("owner", {
        id: first.id,
        version: first.version,
        idempotencyKey: "detail-lock-update",
        patch: { description: "拒否" },
      }),
    ).toThrowError(expect.objectContaining({ status: 423 }));
    expect(() =>
      store.createIssueNote("owner", first.id, {
        idempotencyKey: "detail-lock-note",
        body: "拒否",
      }),
    ).toThrowError(expect.objectContaining({ status: 423 }));
    expect(() =>
      store.createIssueRelation("owner", first.id, {
        idempotencyKey: "detail-lock-rel",
        targetIssueId: second.id,
        type: "related",
      }),
    ).toThrowError(expect.objectContaining({ status: 423 }));
    expect(() =>
      store.updateIssueNote("owner", first.id, note.id, {
        idempotencyKey: "detail-lock-note-update",
        body: "拒否",
      }),
    ).toThrowError(expect.objectContaining({ status: 423 }));
    expect(() =>
      store.deleteIssueNote("owner", first.id, note.id, "detail-lock-note-delete"),
    ).toThrowError(expect.objectContaining({ status: 423 }));
    expect(() =>
      store.deleteIssueRelation("owner", first.id, relation.id, "detail-lock-relation-delete"),
    ).toThrowError(expect.objectContaining({ status: 423 }));
    expect(store.activities.length).toBe(before.activities);
    expect(store.outbox.length).toBe(before.outbox);
    expect(store.notes.size).toBe(before.notes);
    expect(store.relations.size).toBe(before.relations);
    expect(store.receipts.size).toBe(before.receipts);
    expect(store.issues.get(first.id)?.version).toBe(before.version);
    expect(store.getRun("owner", run.run_id).status).toBe("running");
  });
});
