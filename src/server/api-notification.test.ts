import { beforeEach, describe, expect, it } from "vitest";
import { bootstrap, listNotifications, markNotification } from "./api";
import { getOrbitStore, resetOrbitStores } from "./store";
import type { Notification } from "./model";

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function mutation(value: unknown): Request {
  return new Request("http://orbit.local/api/v1/notifications/notification_1", {
    method: "PATCH",
    headers: { "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify(value),
  });
}

describe("Notification HTTP service", () => {
  beforeEach(() => resetOrbitStores());

  function seed() {
    const store = getOrbitStore("dev-owner");
    const notification: Notification = {
      id: "notification_1",
      userId: "dev-owner",
      type: "due_soon",
      title: "期限が近いIssue",
      body: "確認してください。",
      entityType: "issue",
      entityId: "issue_1",
      readAt: null,
      deletedAt: null,
      createdAt: 1_700_000_000_000,
    };
    store.notifications.set(notification.id, notification);
    return store;
  }

  it("[状態遷移] Notification read APIはstrict、replay、Owner境界を守る", async () => {
    seed();
    const updated = await markNotification(
      mutation({ idempotencyKey: "api-read-1", read: true }),
      "notification_1",
    );
    expect(updated.status).toBe(200);
    expect((await body<{ notification: { readAt: number } }>(updated)).notification.readAt).toEqual(
      expect.any(Number),
    );
    const replayed = await markNotification(
      mutation({ idempotencyKey: "api-read-1", read: true }),
      "notification_1",
    );
    expect(replayed.status).toBe(200);
    const conflict = await markNotification(
      mutation({ idempotencyKey: "api-read-1", read: false }),
      "notification_1",
    );
    expect(conflict.status).toBe(409);
    const missing = await markNotification(
      mutation({ idempotencyKey: "api-missing", read: true }),
      "missing",
    );
    expect(missing.status).toBe(404);
  });

  it("[契約] Notification readの欠落・型違反・unknown keyは400 fieldErrorsを返す", async () => {
    seed();
    const missingRead = await markNotification(
      mutation({ idempotencyKey: "api-missing-read" }),
      "notification_1",
    );
    expect(
      (await body<{ error: { code: string; fieldErrors: Record<string, string[]> } }>(missingRead))
        .error,
    ).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: { read: expect.arrayContaining([expect.any(String)]) },
    });
    const invalidReadType = await markNotification(
      mutation({ idempotencyKey: "api-invalid-read", read: 1 }),
      "notification_1",
    );
    expect(
      (await body<{ error: { fieldErrors: Record<string, string[]> } }>(invalidReadType)).error,
    ).toMatchObject({ fieldErrors: { read: expect.arrayContaining([expect.any(String)]) } });
    const invalidKeyType = await markNotification(
      mutation({ idempotencyKey: null, read: true }),
      "notification_1",
    );
    expect(
      (await body<{ error: { fieldErrors: Record<string, string[]> } }>(invalidKeyType)).error,
    ).toMatchObject({
      fieldErrors: { idempotencyKey: expect.arrayContaining([expect.any(String)]) },
    });
    for (const input of [
      { idempotencyKey: null, read: true },
      { idempotencyKey: 123, read: true },
      { idempotencyKey: "api-read-unknown", read: true, secret: true },
    ]) {
      const response = await markNotification(mutation(input), "notification_1");
      expect(response.status).toBe(400);
      expect(
        (await body<{ error: { code: string; fieldErrors?: Record<string, string[]> } }>(response))
          .error.code,
      ).toBe("VALIDATION_ERROR");
    }
  });

  it("[異常系] Runtime lock中のNotification readは423で状態不変", async () => {
    const store = seed();
    await import("./api").then(({ startBackgroundRun }) =>
      startBackgroundRun(
        new Request("http://orbit.local/api/v1/background-runs", {
          method: "POST",
          headers: { "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
          body: JSON.stringify({ kind: "maintenance", idempotencyKey: "notification-api-lock" }),
        }),
      ),
    );
    const before = structuredClone(store.notifications.get("notification_1"));
    const response = await markNotification(
      mutation({ idempotencyKey: "api-read-locked", read: true }),
      "notification_1",
    );
    expect(response.status).toBe(423);
    expect(store.notifications.get("notification_1")).toEqual(before);
  });

  it("[Bootstrap] Inboxの未読データを返す", async () => {
    const store = seed();
    store.notifications.set("notification_deleted", {
      ...store.notifications.get("notification_1")!,
      id: "notification_deleted",
      deletedAt: 1_700_000_000_000,
    });
    const listed = await listNotifications(new Request("http://orbit.local/api/v1/notifications"));
    expect(listed.status).toBe(200);
    const listedBody = await body<{ items: Array<{ id: string }> }>(listed);
    expect(listedBody.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "notification_1" })]),
    );
    expect(listedBody.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "notification_deleted" })]),
    );
    const response = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    expect((await body<{ notifications: Array<{ id: string }> }>(response)).notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "notification_1" })]),
    );
  });
});
