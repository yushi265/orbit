import type { D1Database } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authFixture = vi.hoisted(() => ({
  payload: {} as Record<string, unknown>,
}));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({ mocked: true })),
  jwtVerify: vi.fn(async () => ({ payload: authFixture.payload })),
}));

import { resolveOwner, type RuntimeEnvironment } from "./auth";

const CLIENT_ID = "bot-client.access";

class OwnerD1 {
  constructor(private readonly email: string | null) {}
  readonly boundValues: unknown[][] = [];
  prepare(_query: string) {
    const row = {
      id: "owner-1",
      name: "Owner",
      email: this.email,
      avatar_url: null,
      created_at: 1_700_000_000_000,
    };
    const statement = {
      bind: (...values: unknown[]) => {
        this.boundValues.push(values);
        return statement;
      },
      first: async () => (this.email === null ? null : row),
      all: async () => ({ results: this.email === null ? [] : [row] }),
      raw: async () =>
        this.email === null ? [] : [[row.id, row.name, row.email, null, row.created_at]],
    };
    return statement;
  }
}

class FailingD1 {
  prepare() {
    throw new Error("database unavailable");
  }
}

function environment(database: unknown, clientId: string | null = CLIENT_ID): RuntimeEnvironment {
  return {
    APP_ENV: "production",
    OWNER_USER_ID: "owner-1",
    OWNER_EMAIL: "owner@example.com",
    ACCESS_TEAM_DOMAIN: "orbit-team",
    ACCESS_AUD: "orbit-audience",
    ...(clientId === null ? {} : { ACCESS_SERVICE_TOKEN_CLIENT_ID: clientId }),
    DB: database as D1Database,
  } as unknown as RuntimeEnvironment;
}

function request(init: RequestInit = {}) {
  return new Request("https://orbit.example/api/v1/issues", {
    ...init,
    headers: {
      "Cf-Access-Jwt-Assertion": "service-token-jwt",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

function servicePayload(overrides: Record<string, unknown> = {}) {
  return { type: "app", common_name: CLIENT_ID, sub: "", ...overrides };
}

describe("service token owner authentication", () => {
  beforeEach(() => {
    authFixture.payload = servicePayload();
  });

  it("[デシジョンテーブル] #1 登録Client ID一致・sub空 → Owner本人として扱う", async () => {
    const database = new OwnerD1("owner@example.com");
    await expect(resolveOwner(request(), environment(database))).resolves.toEqual({
      userId: "owner-1",
      email: "owner@example.com",
      accessAuthenticated: true,
    });
    expect(database.boundValues).toEqual([["owner-1"]]);
  });

  it("[デシジョンテーブル] #2 Client ID不一致 → 401・DB未照会", async () => {
    authFixture.payload = servicePayload({
      common_name: "other-client.access",
    });
    const database = new OwnerD1("owner@example.com");
    const prepare = vi.spyOn(database, "prepare");
    await expect(resolveOwner(request(), environment(database))).rejects.toMatchObject({
      status: 401,
      code: "AUTH_REQUIRED",
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("[デシジョンテーブル] #3 登録Client ID未設定・空文字 → 401・DB未照会", async () => {
    for (const clientId of [null, ""]) {
      const database = new OwnerD1("owner@example.com");
      const prepare = vi.spyOn(database, "prepare");
      await expect(resolveOwner(request(), environment(database, clientId))).rejects.toMatchObject({
        status: 401,
        code: "AUTH_REQUIRED",
      });
      expect(prepare).not.toHaveBeenCalled();
    }
  });

  it("[デシジョンテーブル] #3 common_nameが空文字でも登録値が空なら一致扱いしない", async () => {
    authFixture.payload = servicePayload({ common_name: "" });
    await expect(
      resolveOwner(request(), environment(new OwnerD1("owner@example.com"), "")),
    ).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
  });

  it("[デシジョンテーブル] #4 Client ID一致でもsubが空でない → 401・DB未照会", async () => {
    for (const sub of ["user-123", undefined]) {
      authFixture.payload = servicePayload({ sub });
      const database = new OwnerD1("owner@example.com");
      const prepare = vi.spyOn(database, "prepare");
      await expect(resolveOwner(request(), environment(database))).rejects.toMatchObject({
        status: 401,
        code: "AUTH_REQUIRED",
      });
      expect(prepare).not.toHaveBeenCalled();
    }
  });

  it("[同値分割] 文字列以外のcommon_nameはemailが一致していても401・DB未照会", async () => {
    for (const commonName of [null, 123, [CLIENT_ID]]) {
      authFixture.payload = servicePayload({ common_name: commonName, email: "owner@example.com" });
      const database = new OwnerD1("owner@example.com");
      const prepare = vi.spyOn(database, "prepare");
      await expect(resolveOwner(request(), environment(database))).rejects.toMatchObject({
        status: 401,
        code: "AUTH_REQUIRED",
      });
      expect(prepare).not.toHaveBeenCalled();
    }
  });

  it("[デシジョンテーブル] common_nameがあればemail一致でもService Token判定を優先する", async () => {
    authFixture.payload = servicePayload({
      common_name: "other-client.access",
      email: "owner@example.com",
    });
    const database = new OwnerD1("owner@example.com");
    const prepare = vi.spyOn(database, "prepare");
    await expect(resolveOwner(request(), environment(database))).rejects.toMatchObject({
      status: 401,
      code: "AUTH_REQUIRED",
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("[デシジョンテーブル] #1 登録Client ID一致ならJWTのemailに関係なくOWNER_EMAILで扱う", async () => {
    authFixture.payload = servicePayload({ email: "someone-else@example.com" });
    await expect(
      resolveOwner(request(), environment(new OwnerD1("owner@example.com"))),
    ).resolves.toEqual({
      userId: "owner-1",
      email: "owner@example.com",
      accessAuthenticated: true,
    });
  });

  it("[代表値] AC-3 Owner行なし → 401 / DB照会失敗 → 500", async () => {
    await expect(resolveOwner(request(), environment(new OwnerD1(null)))).rejects.toMatchObject({
      status: 401,
      code: "AUTH_REQUIRED",
    });
    await expect(resolveOwner(request(), environment(new FailingD1()))).rejects.toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
    });
  });

  it("[代表値] AC-4 common_nameなしは従来どおりemailで判定する", async () => {
    authFixture.payload = { email: "owner@example.com", sub: "user-1" };
    await expect(
      resolveOwner(request(), environment(new OwnerD1("owner@example.com"))),
    ).resolves.toMatchObject({ userId: "owner-1", accessAuthenticated: true });
  });
});
