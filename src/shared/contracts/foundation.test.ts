import { describe, expect, it } from "vitest";
import {
  preferencesMutationSchema,
  workflowStateCreateMutationSchema,
  workflowStateUpdateMutationSchema,
} from "./index";

describe("Phase 1 shared contracts", () => {
  it("[代表値] PreferencesはIANA timezoneと設定enumを受理する", () => {
    expect(
      preferencesMutationSchema.safeParse({
        idempotencyKey: "preferences-foundation",
        timezone: "Asia/Tokyo",
        locale: "ja",
        theme: "dark",
        colorTheme: "ocean",
        estimateEnabled: false,
      }).success,
    ).toBe(true);
    expect(
      preferencesMutationSchema.safeParse({
        idempotencyKey: "preferences-utc",
        timezone: "UTC",
      }).success,
    ).toBe(true);
  });

  it("[デシジョンテーブル] Preferencesの不正値とunknown keyを拒否する", () => {
    for (const value of ["", "Mars/Orbit", "Asia/Tokyo/invalid"]) {
      expect(
        preferencesMutationSchema.safeParse({
          idempotencyKey: "preferences-invalid",
          timezone: value,
        }).success,
      ).toBe(false);
    }
    expect(
      preferencesMutationSchema.safeParse({
        idempotencyKey: "preferences-invalid-enum",
        locale: "fr",
      }).success,
    ).toBe(false);
    expect(
      preferencesMutationSchema.safeParse({
        idempotencyKey: "preferences-unknown",
        unsupported: true,
      }).success,
    ).toBe(false);
  });

  it("[デシジョンテーブル] all supported locale/theme/colorTheme values are accepted", () => {
    for (const locale of ["ja", "en"]) {
      expect(
        preferencesMutationSchema.safeParse({ idempotencyKey: "locale", locale }).success,
      ).toBe(true);
    }
    for (const theme of ["light", "dark", "system"]) {
      expect(preferencesMutationSchema.safeParse({ idempotencyKey: "theme", theme }).success).toBe(
        true,
      );
    }
    for (const colorTheme of ["coral", "ocean", "violet", "forest", "amber"]) {
      expect(
        preferencesMutationSchema.safeParse({ idempotencyKey: "color-theme", colorTheme }).success,
      ).toBe(true);
    }
  });

  it("[境界値] idempotencyKeyの1〜200文字だけを受理する", () => {
    expect(preferencesMutationSchema.safeParse({ idempotencyKey: "a" }).success).toBe(true);
    expect(preferencesMutationSchema.safeParse({ idempotencyKey: "a".repeat(200) }).success).toBe(
      true,
    );
    expect(preferencesMutationSchema.safeParse({ idempotencyKey: "" }).success).toBe(false);
    expect(preferencesMutationSchema.safeParse({ idempotencyKey: "a".repeat(201) }).success).toBe(
      false,
    );
  });

  it("[境界値] Workflow name/color/positionの契約を検証する", () => {
    expect(
      workflowStateCreateMutationSchema.safeParse({
        idempotencyKey: "workflow-create",
        name: "A",
        category: "started",
        color: "#000000",
      }).success,
    ).toBe(true);
    expect(
      workflowStateCreateMutationSchema.safeParse({
        idempotencyKey: "workflow-create-max",
        name: "あ".repeat(100),
        category: "completed",
        color: "#FFFFFF",
      }).success,
    ).toBe(true);
    expect(
      workflowStateCreateMutationSchema.safeParse({
        idempotencyKey: "workflow-create-invalid",
        name: "",
        category: "started",
        color: "#000000",
      }).success,
    ).toBe(false);
    expect(
      workflowStateCreateMutationSchema.safeParse({
        idempotencyKey: "workflow-create-too-long",
        name: "あ".repeat(101),
        category: "started",
        color: "#000000",
      }).success,
    ).toBe(false);
    for (const color of ["#fff", "#12345g", "123456", "#1234567"]) {
      expect(
        workflowStateCreateMutationSchema.safeParse({
          idempotencyKey: "workflow-color-invalid",
          name: "Valid name",
          category: "started",
          color,
        }).success,
      ).toBe(false);
    }
    expect(
      workflowStateUpdateMutationSchema.safeParse({
        idempotencyKey: "workflow-position-zero",
        position: 0,
      }).success,
    ).toBe(true);
    expect(
      workflowStateUpdateMutationSchema.safeParse({
        idempotencyKey: "workflow-position-negative",
        position: -1,
      }).success,
    ).toBe(false);
    expect(
      workflowStateUpdateMutationSchema.safeParse({
        idempotencyKey: "workflow-position-fraction",
        position: 1.5,
      }).success,
    ).toBe(false);
  });
});
