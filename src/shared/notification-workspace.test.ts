import { describe, expect, it } from "vitest";
import { notificationReadMutationSchema } from "./contracts/notifications";

describe("Notification read shared contract", () => {
  it("[境界値] read true / falseとstrict idempotencyを検証する", () => {
    expect(
      notificationReadMutationSchema.safeParse({ idempotencyKey: "read-true", read: true }).success,
    ).toBe(true);
    expect(
      notificationReadMutationSchema.safeParse({ idempotencyKey: "read-false", read: false })
        .success,
    ).toBe(true);
    expect(
      notificationReadMutationSchema.safeParse({ idempotencyKey: null, read: true }).success,
    ).toBe(false);
    expect(
      notificationReadMutationSchema.safeParse({ idempotencyKey: 123, read: true }).success,
    ).toBe(false);
    expect(notificationReadMutationSchema.safeParse({ read: true }).success).toBe(false);
    expect(
      notificationReadMutationSchema.safeParse({
        idempotencyKey: "unknown",
        read: true,
        secret: true,
      }).success,
    ).toBe(false);
  });
});
