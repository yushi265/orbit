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
  constructor(
    private readonly email: string | null,
    private readonly userId = "owner-1",
  ) {}

  readonly boundValues: unknown[][] = [];

  prepare(_query: string) {
    const statement = {
      bind: (...values: unknown[]) => {
        this.boundValues.push(values);
        return statement;
      },
      first: async () => ({
        id: this.userId,
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
                  id: this.userId,
                  name: "Owner",
                  email: this.email,
                  avatar_url: null,
                  created_at: 1_700_000_000_000,
                },
              ],
      }),
      raw: async () =>
        this.email === null ? [] : [[this.userId, "Owner", this.email, null, 1_700_000_000_000]],
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

describe("local owner lookup boundary", () => {
  it("[デシジョンテーブル] localはAccessヘッダーやOwner上書きを無視して固定OwnerをDB照合する", async () => {
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    vi.mocked(createRemoteJWKSet).mockClear();
    vi.mocked(jwtVerify).mockClear();
    for (const token of [undefined, "untrusted-access-token"]) {
      const database = new OwnerD1("local-owner@orbit.local", "local-owner");
      const prepare = vi.spyOn(database, "prepare");
      const owner = await resolveOwner(
        new Request("http://127.0.0.1:3000/api/v1/bootstrap", {
          headers: token ? { "Cf-Access-Jwt-Assertion": token } : {},
        }),
        {
          APP_ENV: "local",
          ORBIT_STORAGE: "d1",
          DB: database as unknown as D1Database,
          DEV_OWNER_USER_ID: "attacker",
          OWNER_USER_ID: "attacker",
          OWNER_EMAIL: "attacker@example.com",
        } as unknown as RuntimeEnvironment,
      );
      expect(owner).toEqual({
        userId: "local-owner",
        email: "local-owner@orbit.local",
        accessAuthenticated: false,
      });
      expect(prepare).toHaveBeenCalled();
      expect(database.boundValues).toEqual([["local-owner"]]);
    }
    expect(createRemoteJWKSet).not.toHaveBeenCalled();
    expect(jwtVerify).not.toHaveBeenCalled();
  });
});

it("[同値分割] local DB欠落・Owner欠落・email衝突・DB失敗は500で停止する", async () => {
  for (const DB of [
    undefined,
    new OwnerD1(null),
    new OwnerD1("other@example.com"),
    new FailingD1(),
  ]) {
    await expect(
      resolveOwner(new Request("http://127.0.0.1:3000/api/v1/bootstrap"), {
        APP_ENV: "local",
        ORBIT_STORAGE: "d1",
        DB,
      } as unknown as RuntimeEnvironment),
    ).rejects.toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  }
});
