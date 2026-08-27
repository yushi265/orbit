import { describe, expect, it } from "vitest";
import { resolveOwner } from "./auth";

describe("production owner authentication", () => {
  it("[デシジョンテーブル] production request has no Access assertion → 401", async () => {
    await expect(
      resolveOwner(new Request("https://orbit.example/api/v1/bootstrap"), {
        APP_ENV: "production",
      }),
    ).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
  });

  it("[デシジョンテーブル] incomplete Access configuration → 401", async () => {
    const request = new Request("https://orbit.example/api/v1/bootstrap", {
      headers: { "Cf-Access-Jwt-Assertion": "access-token" },
    });

    await expect(
      resolveOwner(request, {
        APP_ENV: "production",
        OWNER_USER_ID: "owner-1",
        OWNER_EMAIL: "owner@example.com",
      }),
    ).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
  });

  it("returns an internal error when the production D1 binding is missing", async () => {
    const request = new Request("https://orbit.example/api/v1/bootstrap", {
      headers: { "Cf-Access-Jwt-Assertion": "access-token" },
    });

    await expect(
      resolveOwner(request, {
        APP_ENV: "production",
        OWNER_USER_ID: "owner-1",
        OWNER_EMAIL: "owner@example.com",
        ACCESS_TEAM_DOMAIN: "orbit-team",
        ACCESS_AUD: "orbit-audience",
      }),
    ).rejects.toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });
});
