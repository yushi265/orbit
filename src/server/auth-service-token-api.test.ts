import type { D1Database } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ persist: null as null | (() => Promise<void>) }));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({ mocked: true })),
  jwtVerify: vi.fn(async () => ({
    payload: { type: "app", common_name: "bot-client.access", sub: "" },
  })),
}));

vi.mock("cloudflare:workers", () => {
  const row = {
    id: "owner-1",
    name: "Owner",
    email: "owner@example.com",
    avatar_url: null,
    created_at: 1_700_000_000_000,
  };
  const statement = {
    bind: () => statement,
    first: async () => row,
    all: async () => ({ results: [row] }),
    raw: async () => [[row.id, row.name, row.email, null, row.created_at]],
  };
  return {
    env: {
      APP_ENV: "production",
      OWNER_USER_ID: "owner-1",
      OWNER_EMAIL: "owner@example.com",
      ACCESS_TEAM_DOMAIN: "orbit-team",
      ACCESS_AUD: "orbit-audience",
      ACCESS_SERVICE_TOKEN_CLIENT_ID: "bot-client.access",
      DB: { prepare: () => statement } as unknown as D1Database,
    },
  };
});

vi.mock("./store-session", async () => {
  const { getOrbitStore } = await import("./store");
  return {
    openStoreSession: vi.fn(async (userId: string, email: string) => {
      const store = getOrbitStore(userId);
      store.ensureOwner(userId, email);
      return { store, persist: fixture.persist!, needsInitialPersist: false };
    }),
  };
});

import { createIssue } from "./api";
import { getOrbitStore, resetOrbitStores } from "./store";

function botRequest(headers: Record<string, string>) {
  return new Request("https://orbit.example/api/v1/issues", {
    method: "POST",
    headers: {
      "Cf-Access-Jwt-Assertion": "service-token-jwt",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ idempotencyKey: "bot-key-1", title: "牛乳を買う" }),
  });
}

describe("POST /api/v1/issues via service token", () => {
  beforeEach(() => {
    resetOrbitStores();
    fixture.persist = vi.fn(async () => undefined);
  });

  it("[代表値] AC-5 X-Requested-With付きならOwnerのIssueとして作成・永続化される", async () => {
    const response = await createIssue(botRequest({ "X-Requested-With": "XMLHttpRequest" }));
    expect(response.status).toBe(201);
    const { issue } = (await response.json()) as { issue: { id: string; title: string } };
    expect(issue.title).toBe("牛乳を買う");
    const stored = getOrbitStore("owner-1")
      .listIssues("owner-1")
      .map((item) => item.title);
    expect(stored).toContain("牛乳を買う");
    expect(fixture.persist).toHaveBeenCalledTimes(1);
  });

  it("[代表値] AC-5 X-Requested-Withなしは400でIssueを作らない", async () => {
    const response = await createIssue(botRequest({}));
    expect(response.status).toBe(400);
    expect(getOrbitStore("owner-1").listIssues("owner-1")).toEqual([]);
    expect(fixture.persist).not.toHaveBeenCalled();
  });
});
