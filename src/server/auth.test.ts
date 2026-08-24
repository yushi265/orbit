import { describe, expect, it } from "vitest";
import { resolveOwner } from "./auth";

describe("production owner authentication", () => {
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
