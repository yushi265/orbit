import type { D1Database } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authFixture = vi.hoisted(() => ({
  payload: { email: "owner@example.com" },
  verificationError: null as Error | null,
  options: null as unknown,
}));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({ mocked: true })),
  jwtVerify: vi.fn(async (_token: string, _jwks: unknown, options: unknown) => {
    authFixture.options = options;
    if (authFixture.verificationError) throw authFixture.verificationError;
    return { payload: authFixture.payload };
  }),
}));

import { resolveOwner, type RuntimeEnvironment } from "./auth";

class OwnerD1 {
  constructor(private readonly email: string | null) {}

  prepare(_query: string) {
    const statement = {
      bind: () => statement,
      first: async () => ({
        id: "owner-1",
        name: "Owner",
        email: this.email,
        avatar_url: null,
        created_at: 1_700_000_000_000,
      }),
      all: async () => ({
        results:
          this.email === null
            ? []
            : [
                {
                  id: "owner-1",
                  name: "Owner",
                  email: this.email,
                  avatar_url: null,
                  created_at: 1_700_000_000_000,
                },
              ],
      }),
      raw: async () =>
        this.email === null ? [] : [["owner-1", "Owner", this.email, null, 1_700_000_000_000]],
    };
    return statement;
  }
}

class FailingD1 {
  prepare() {
    throw new Error("database unavailable");
  }
}

function environment(database: D1Database): RuntimeEnvironment {
  return {
    APP_ENV: "production",
    OWNER_USER_ID: "owner-1",
    OWNER_EMAIL: "owner@example.com",
    ACCESS_TEAM_DOMAIN: "orbit-team",
    ACCESS_AUD: "orbit-audience",
    DB: database,
  } as unknown as RuntimeEnvironment;
}

function request() {
  return new Request("https://orbit.example/api/v1/bootstrap", {
    headers: { "Cf-Access-Jwt-Assertion": "access-token" },
  });
}

describe("production owner lookup boundary", () => {
  beforeEach(() => {
    authFixture.payload.email = "owner@example.com";
    authFixture.verificationError = null;
    authFixture.options = null;
  });

  it("[代表値] accepts a verified Access identity matching the Owner row", async () => {
    await expect(
      resolveOwner(
        request(),
        environment(new OwnerD1("owner@example.com") as unknown as D1Database),
      ),
    ).resolves.toMatchObject({
      userId: "owner-1",
      email: "owner@example.com",
      accessAuthenticated: true,
    });
    expect(authFixture.options).toEqual({
      issuer: "https://orbit-team.cloudflareaccess.com",
      audience: "orbit-audience",
    });
  });

  it("[デシジョンテーブル] rejects a users row whose email differs from the verified identity", async () => {
    await expect(
      resolveOwner(
        request(),
        environment(new OwnerD1("other@example.com") as unknown as D1Database),
      ),
    ).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
  });

  it("[異常系] maps a D1 Owner lookup failure to an internal error", async () => {
    await expect(
      resolveOwner(request(), environment(new FailingD1() as unknown as D1Database)),
    ).rejects.toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });

  it("[デシジョンテーブル] rejects a JWT verification failure and a missing users row", async () => {
    authFixture.verificationError = new Error("invalid JWT");
    await expect(
      resolveOwner(
        request(),
        environment(new OwnerD1("owner@example.com") as unknown as D1Database),
      ),
    ).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED" });

    authFixture.verificationError = null;
    await expect(
      resolveOwner(request(), environment(new OwnerD1(null) as unknown as D1Database)),
    ).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
  });
});
