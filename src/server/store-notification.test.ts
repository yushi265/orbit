import { describe, expect, it } from "vitest";
import type { Notification } from "./model";
import { OrbitStore } from "./store";

function setup() {
  const store = new OrbitStore(() => 1_700_000_000_000);
  store.ensureOwner("owner", "owner@example.com");
  const notification: Notification = {
    id: "notification_1",
    userId: "owner",
    type: "due_soon",
    title: "期限が近いIssue",
    body: "TASK-1を確認してください。",
    entityType: "issue",
    entityId: "issue_1",
    readAt: null,
    deletedAt: null,
    createdAt: 1_700_000_000_000,
  };
  store.notifications.set(notification.id, notification);
  return { store, notification };
}

describe("Notification service", () => {
  it("[状態遷移] Notificationを既読・未読にし、same-key replayをNo-opにする", () => {
    const { store, notification } = setup();
    expect(store.listNotifications("owner")).toEqual([notification]);
    const read = store.markNotification("owner", notification.id, true, "notification-read-1");
    expect(read.readAt).toBe(1_700_000_000_000);
    expect(store.markNotification("owner", notification.id, true, "notification-read-1")).toEqual(
      read,
    );
    expect(() =>
      store.markNotification("owner", notification.id, false, "notification-read-1"),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" }));
    const unread = store.markNotification("owner", notification.id, false, "notification-unread-1");
    expect(unread.readAt).toBeNull();
  });

  it("[セキュリティ境界] Owner外・不存在・lock中はNotificationを変更しない", () => {
    const { store, notification } = setup();
    store.ensureOwner("other", "other@example.com");
    store.notifications.set("notification_other", {
      ...notification,
      id: "notification_other",
      userId: "other",
    });
    store.notifications.set("notification_deleted", {
      ...notification,
      id: "notification_deleted",
      deletedAt: 1_700_000_000_000,
    });
    expect(store.listNotifications("owner").map((item) => item.id)).toEqual([notification.id]);
    expect(store.listNotifications("other").map((item) => item.id)).toEqual(["notification_other"]);
    expect(() =>
      store.markNotification("owner", "notification_deleted", true, "notification-deleted"),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() =>
      store.markNotification("other", notification.id, true, "notification-other"),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() =>
      store.markNotification("owner", "missing", true, "notification-missing"),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    const run = store.startRun("owner", {
      kind: "maintenance",
      idempotencyKey: "notification-lock",
    });
    const before = structuredClone(notification);
    const receipts = store.receipts.size;
    expect(() =>
      store.markNotification("owner", notification.id, true, "notification-locked"),
    ).toThrowError(expect.objectContaining({ status: 423 }));
    expect(notification).toEqual(before);
    expect(store.receipts.size).toBe(receipts);
    expect(store.getRun("owner", run.run_id).status).toBe("running");
  });
});
