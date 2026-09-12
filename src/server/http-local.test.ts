import { expect, it, vi } from "vitest";
import { json, withOwner } from "./http";
import { OrbitStore } from "./store";

it("[デシジョンテーブル] LANのURL/Hostと同一Origin Mutationだけを許可する", async () => {
  const local = "http://127.0.0.1:3000";
  const lan = "http://192.168.1.20:3000";
  const unlisted = "http://192.168.1.21:3000";
  const resolveOwner = vi.fn(async () => ({
    userId: "local-owner",
    email: "local-owner@orbit.local",
    accessAuthenticated: false,
  }));
  const persist = vi.fn(async () => {});
  const openStoreSession = vi.fn(async () => ({
    store: new OrbitStore(),
    persist,
    needsInitialPersist: false,
  }));
  const handler = vi.fn(async () => json({ ok: true }));
  for (const urlOrigin of [local, lan, unlisted]) {
    for (const host of [
      new URL(local).host,
      new URL(lan).host,
      new URL(unlisted).host,
      "evil.example:3000",
      "",
    ]) {
      for (const method of ["GET", "HEAD", "OPTIONS", "POST", "PATCH", "DELETE"]) {
        for (const origin of [undefined, local, lan, unlisted, "null", `${lan}/`]) {
          for (const requestedWith of [undefined, "XMLHttpRequest"]) {
            vi.clearAllMocks();
            const headers = new Headers({ Host: host });
            if (origin !== undefined) headers.set("Origin", origin);
            if (requestedWith !== undefined) headers.set("X-Requested-With", requestedWith);
            const response = await withOwner(
              new Request(`${urlOrigin}/api/v1/issues`, { method, headers }),
              handler,
              {
                runtimeEnv: async () => ({
                  APP_ENV: "local",
                  ORBIT_STORAGE: "d1",
                  ORBIT_LOCAL_ORIGINS: JSON.stringify([local, lan]),
                }),
                resolveOwner,
                openStoreSession,
              },
            );
            const mutation = ["POST", "PATCH", "DELETE"].includes(method);
            const allowed =
              urlOrigin !== unlisted &&
              host === new URL(urlOrigin).host &&
              (!mutation || (origin === urlOrigin && requestedWith === "XMLHttpRequest"));
            expect(
              response.status,
              JSON.stringify({ urlOrigin, host, method, origin, requestedWith }),
            ).toBe(allowed ? 200 : 400);
            if (!allowed) {
              expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
              expect(handler).not.toHaveBeenCalled();
              expect(resolveOwner).not.toHaveBeenCalled();
              expect(openStoreSession).not.toHaveBeenCalled();
              expect(persist).not.toHaveBeenCalled();
            } else {
              expect(handler).toHaveBeenCalledOnce();
              expect(persist).toHaveBeenCalledTimes(mutation ? 1 : 0);
            }
          }
        }
      }
    }
  }
});

it("[同値分割] local APIのURL/HostとMutation Originを正規接続元に限定する", async () => {
  const resolveOwner = vi.fn(async () => ({
    userId: "local-owner",
    email: "local-owner@orbit.local",
    accessAuthenticated: false,
  }));
  const persist = vi.fn(async () => {});
  const openStoreSession = vi.fn(async () => ({
    store: new OrbitStore(),
    persist,
    needsInitialPersist: false,
  }));
  const handler = vi.fn(async () => json({ ok: true }));
  const cases = [
    {
      url: "http://192.168.1.20:3000/api/v1/bootstrap",
      host: "192.168.1.20:3000",
      method: "GET",
      status: 400,
    },
    {
      url: "http://127.0.0.1:3000/api/v1/bootstrap",
      host: "127.0.0.1:3000",
      method: "GET",
      status: 200,
    },
    {
      url: "http://evil.example:3000/api/v1/bootstrap",
      host: "127.0.0.1:3000",
      method: "GET",
      status: 400,
    },
    {
      url: "http://127.0.0.1:3000/api/v1/bootstrap",
      host: "evil.example:3000",
      method: "GET",
      status: 400,
    },
    {
      url: "https://127.0.0.1:3000/api/v1/bootstrap",
      host: "127.0.0.1:3000",
      method: "GET",
      status: 400,
    },
    {
      url: "http://127.0.0.1:3001/api/v1/bootstrap",
      host: "127.0.0.1:3001",
      method: "GET",
      status: 400,
    },
    ...[
      undefined,
      "null",
      "http://evil.example",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:3000/",
      "http://127.0.0.1:3000",
    ].map((origin) => ({
      url: "http://127.0.0.1:3000/api/v1/issues",
      host: "127.0.0.1:3000",
      method: "POST",
      origin,
      status: origin === "http://127.0.0.1:3000" ? 200 : 400,
    })),
  ];
  for (const testCase of cases) {
    vi.clearAllMocks();
    const headers = new Headers({ Host: testCase.host, "X-Requested-With": "XMLHttpRequest" });
    if ("origin" in testCase && testCase.origin !== undefined)
      headers.set("Origin", testCase.origin);
    const response = await withOwner(
      new Request(testCase.url, { method: testCase.method, headers }),
      handler,
      {
        runtimeEnv: async () => ({ APP_ENV: "local", ORBIT_STORAGE: "d1" }),
        resolveOwner,
        openStoreSession,
      },
    );
    expect(response.status, JSON.stringify(testCase)).toBe(testCase.status);
    if (testCase.status === 400) {
      expect(await response.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR", message: "ローカル接続元を確認してください。" },
      });
      expect(handler).not.toHaveBeenCalled();
      expect(resolveOwner).not.toHaveBeenCalled();
      expect(openStoreSession).not.toHaveBeenCalled();
      expect(persist).not.toHaveBeenCalled();
    }
  }
});

it("[同値分割] LAN設定不正はOwner/DB/handlerの前に500で停止し、productionはAccess認証を維持する", async () => {
  const resolveOwner = vi.fn();
  const openStoreSession = vi.fn();
  const handler = vi.fn();
  for (const ORBIT_LOCAL_ORIGINS of ["[]", "null", "bad-json", '["http://8.8.8.8:3000"]']) {
    const response = await withOwner(
      new Request("http://127.0.0.1:3000/api/v1/bootstrap", {
        headers: { Host: "127.0.0.1:3000" },
      }),
      handler,
      {
        runtimeEnv: async () => ({ APP_ENV: "local", ORBIT_STORAGE: "d1", ORBIT_LOCAL_ORIGINS }),
        resolveOwner,
        openStoreSession,
      },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    expect(resolveOwner).not.toHaveBeenCalled();
    expect(openStoreSession).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  }
  const production = await withOwner(
    new Request("https://orbit.example/api/v1/bootstrap"),
    handler,
    {
      runtimeEnv: async () => ({ APP_ENV: "production", ORBIT_LOCAL_ORIGINS: "bad-json" }),
      openStoreSession,
    },
  );
  expect(production.status).toBe(401);
  expect(await production.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
  expect(openStoreSession).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
});

it("[デシジョンテーブル] localもX-Requested-With必須で、不正設定はOwner解決前に500で拒否する", async () => {
  const resolveOwner = vi.fn();
  for (const environment of [
    { APP_ENV: "local", ORBIT_STORAGE: "d1" },
    { APP_ENV: "production", ORBIT_STORAGE: "memory" },
    { APP_ENV: "preview" },
  ]) {
    const response = await withOwner(
      new Request("http://127.0.0.1:3000/api/v1/issues", {
        method: "POST",
        headers: { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" },
      }),
      async () => json({ ok: true }),
      { runtimeEnv: async () => environment, resolveOwner },
    );
    expect(response.status).toBe(environment.APP_ENV === "local" ? 400 : 500);
    expect(await response.json()).toMatchObject({
      error: { code: environment.APP_ENV === "local" ? "VALIDATION_ERROR" : "INTERNAL_ERROR" },
    });
    expect(resolveOwner).not.toHaveBeenCalled();
  }
});

it("[同値分割] 別OwnerのRunを実API handlerへ送ると404でRun/lock/receiptを変更しない", async () => {
  const auth = await import("./auth");
  const sessions = await import("./store-session");
  const api = await import("./api");
  const store = new OrbitStore(() => 1_800_000_000_000);
  store.ensureOwner("owner-a", "a@orbit.local");
  store.ensureOwner("owner-b", "b@orbit.local");
  const run = store.startRun("owner-a", { kind: "maintenance", idempotencyKey: "owner-a-run" });
  const before = store.toSnapshot();
  const persist = vi.fn(async () => {});
  const ownerSpy = vi
    .spyOn(auth, "resolveOwner")
    .mockResolvedValue({ userId: "owner-b", email: "b@orbit.local", accessAuthenticated: true });
  // Both owners deliberately share this fixture so the handler must enforce ownership itself.
  const sessionSpy = vi
    .spyOn(sessions, "openStoreSession")
    .mockResolvedValue({ store, persist, needsInitialPersist: false });
  try {
    const get = new Request(`http://orbit.local/api/v1/background-runs/${run.run_id}`);
    const mutation = () =>
      new Request(`${get.url}/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ expected_cursor: null, idempotencyKey: "owner-b-attempt" }),
      });
    for (const response of [
      await api.getBackgroundRun(get, run.run_id),
      await api.continueBackgroundRun(mutation(), run.run_id),
      await api.resumeBackgroundRun(mutation(), run.run_id),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "RESOURCE_NOT_FOUND" } });
      expect(store.toSnapshot()).toEqual(before);
    }
    expect(persist).not.toHaveBeenCalled();
  } finally {
    ownerSpy.mockRestore();
    sessionSpy.mockRestore();
  }
});
