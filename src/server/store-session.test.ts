import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import { readStoreSnapshot, writeStoreSnapshot } from "../db/repositories/store-snapshot";
import { ServiceError } from "./errors";
import { withOwner, json } from "./http";
import { openStoreSession } from "./store-session";
import { OrbitStore, resetOrbitStores, type OrbitStoreSnapshot } from "./store";

class FakeD1 {
  private readonly rows = new Map<
    string,
    { version: number; stateJson: string; updatedAt: number }
  >();

  prepare(_query: string) {
    let values: unknown[] = [];
    const statement = {
      bind: (...nextValues: unknown[]) => {
        values = nextValues;
        return statement;
      },
      first: async <T>() => {
        const row = this.rows.get(String(values[0]));
        return row
          ? ({ version: row.version, stateJson: row.stateJson, updatedAt: row.updatedAt } as T)
          : (null as T | null);
      },
      run: async () => {
        const [userId, version, stateJson, updatedAt, expectedVersion] = values as [
          string,
          number,
          string,
          number,
          number,
        ];
        const current = this.rows.get(userId);
        if (current && current.version !== expectedVersion) return { meta: { changes: 0 } };
        this.rows.set(userId, { version, stateJson, updatedAt });
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  }
}

describe("store session", () => {
  it("[状態遷移] productionの空Snapshotを初回GETでActiveとUpcomingへ初期化し、再読込できる", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const environment = { APP_ENV: "production", DB: database };
    const empty = new OrbitStore(() => 1_700_000_000_000);
    empty.ensureOwner("owner-empty", "owner@example.com");
    await writeStoreSnapshot(database, "owner-empty", 0, empty.toSnapshot(), 1_700_000_000_000);

    const first = await openStoreSession("owner-empty", "owner@example.com", environment);
    expect(first.store.listCycles("owner-empty")).toHaveLength(4);
    expect(first.store.listCycles("owner-empty").map((cycle) => cycle.number)).toEqual([
      1, 2, 3, 4,
    ]);
    await first.persist();

    const persisted = (await readStoreSnapshot(database, "owner-empty"))?.snapshot as
      | { cycles: Array<{ number: number; status: string }> }
      | undefined;
    expect(persisted?.cycles).toHaveLength(4);
    expect(persisted?.cycles.filter((cycle) => cycle.status === "active")).toHaveLength(1);
    expect(persisted?.cycles.filter((cycle) => cycle.status === "upcoming")).toHaveLength(3);

    const second = await openStoreSession("owner-empty", "owner@example.com", environment);
    expect(second.store.listCycles("owner-empty").map((cycle) => cycle.number)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("persists Upcoming cycles derived during a successful bootstrap GET", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const seed = new OrbitStore(() => 1_700_000_000_000);
    seed.ensureOwner("owner-1", "owner@example.com");
    seed.cycles.set("cycle-1", {
      id: "cycle-1",
      userId: "owner-1",
      number: 1,
      name: "Cycle 1",
      nameOverride: null,
      description: "Active",
      startsAt: 1_699_000_000_000,
      endsAt: 1_701_000_000_000,
      status: "active",
      completedAt: null,
      scheduleOverridden: false,
    });
    await writeStoreSnapshot(database, "owner-1", 0, seed.toSnapshot(), 1_700_000_000_000);
    const environment = { APP_ENV: "production", DB: database };
    const resolvedOwner = {
      userId: "owner-1",
      email: "owner@example.com",
      accessAuthenticated: true,
    };

    const response = await withOwner(
      new Request("https://orbit.example/api/v1/bootstrap"),
      async ({ owner }) => json({ cycles: owner.store.bootstrap("owner-1").cycles }),
      {
        resolveOwner: async () => resolvedOwner,
        openStoreSession: (userId, email) => openStoreSession(userId, email, environment),
      },
    );

    expect(response.status).toBe(200);
    const persisted = (await readStoreSnapshot(database, "owner-1"))?.snapshot as
      | { cycles: Array<{ status: string }> }
      | undefined;
    expect(persisted?.cycles).toHaveLength(4);
    expect(persisted?.cycles.filter((cycle) => cycle.status === "upcoming")).toHaveLength(3);
  });

  it("loads and persists the production store through D1", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const environment = { APP_ENV: "production", DB: database };
    const first = await openStoreSession("owner-1", "owner@example.com", environment);
    const status = first.store.ownedWorkflowStates("owner-1")[1];
    first.store.createIssue("owner-1", {
      idempotencyKey: "issue-1",
      title: "Persistent issue",
      statusId: status.id,
    });
    await first.persist();

    const second = await openStoreSession("owner-1", "owner@example.com", environment);
    expect(second.store.listIssues("owner-1")).toHaveLength(1);
    expect(second.store.listIssues("owner-1")[0].title).toBe("Persistent issue");
    second.store.updatePreferences("owner-1", { timezone: "UTC" }, "preferences-1");
    second.store.cycleSettings.get("owner-1")!.durationWeeks = 3;
    const cycle = second.store.listCycles("owner-1").find((item) => item.number === 1)!;
    cycle.description = "Persisted cycle";
    cycle.startsAt = 1_700_000_000_000;
    cycle.endsAt = 1_700_100_000_000;
    await second.persist();
    expect((await readStoreSnapshot(database, "owner-1"))?.version).toBe(2);
    const third = await openStoreSession("owner-1", "owner@example.com", environment);
    expect(third.store.preferences.get("owner-1")?.timezone).toBe("UTC");
    expect(third.store.cycleSettings.get("owner-1")?.durationWeeks).toBe(3);
    expect(third.store.listCycles("owner-1")).toHaveLength(4);
  });

  it("does not persist a discarded session and rejects stale writers", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const environment = { APP_ENV: "production", DB: database };
    const first = await openStoreSession("owner-1", "owner@example.com", environment);
    const stale = await openStoreSession("owner-1", "owner@example.com", environment);
    const status = first.store.ownedWorkflowStates("owner-1")[1];
    first.store.createIssue("owner-1", {
      idempotencyKey: "issue-1",
      title: "First writer",
      statusId: status.id,
    });
    stale.store.createIssue("owner-1", {
      idempotencyKey: "issue-2",
      title: "Stale writer",
      statusId: stale.store.ownedWorkflowStates("owner-1")[1].id,
    });
    const writes = await Promise.allSettled([first.persist(), stale.persist()]);
    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter((result) => result.status === "rejected")[0]).toMatchObject({
      reason: { code: "D1_WRITE_CONFLICT", status: 409 },
    });

    const discarded = await openStoreSession("owner-1", "owner@example.com", environment);
    discarded.store.createIssue("owner-1", {
      idempotencyKey: "issue-3",
      title: "Discarded issue",
      statusId: discarded.store.ownedWorkflowStates("owner-1")[1].id,
    });
    const reloaded = await openStoreSession("owner-1", "owner@example.com", environment);
    expect(reloaded.store.listIssues("owner-1").map((issue) => issue.title)).toEqual([
      "First writer",
    ]);
  });

  it("persists only successful mutation handlers", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const environment = { APP_ENV: "production", DB: database };
    const resolvedOwner = {
      userId: "owner-1",
      email: "owner@example.com",
      accessAuthenticated: true,
    };
    const request = new Request("https://orbit.example/api/v1/issues", {
      method: "POST",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const open = (userId: string, email: string) => openStoreSession(userId, email, environment);

    const success = await withOwner(
      request,
      async ({ owner }) => {
        owner.store.createIssue("owner-1", {
          idempotencyKey: "issue-success",
          title: "Successful mutation",
          statusId: owner.store.ownedWorkflowStates("owner-1")[1].id,
        });
        return json({ ok: true });
      },
      { resolveOwner: async () => resolvedOwner, openStoreSession: open },
    );
    expect(success.status).toBe(200);

    const failure = await withOwner(
      request,
      async ({ owner }) => {
        owner.store.createIssue("owner-1", {
          idempotencyKey: "issue-failure",
          title: "Failed mutation",
          statusId: owner.store.ownedWorkflowStates("owner-1")[1].id,
        });
        throw new ServiceError(400, "VALIDATION_ERROR", "invalid");
      },
      { resolveOwner: async () => resolvedOwner, openStoreSession: open },
    );
    expect(failure.status).toBe(400);

    const serverFailure = await withOwner(
      request,
      async ({ owner }) => {
        owner.store.createIssue("owner-1", {
          idempotencyKey: "issue-server-failure",
          title: "Server failure",
          statusId: owner.store.ownedWorkflowStates("owner-1")[1].id,
        });
        return json({ ok: false }, 500);
      },
      { resolveOwner: async () => resolvedOwner, openStoreSession: open },
    );
    expect(serverFailure.status).toBe(500);

    const notFound = await withOwner(
      request,
      async ({ owner }) => {
        owner.store.createIssue("owner-1", {
          idempotencyKey: "issue-not-found",
          title: "Not found",
          statusId: owner.store.ownedWorkflowStates("owner-1")[1].id,
        });
        return json({ ok: false }, 404);
      },
      { resolveOwner: async () => resolvedOwner, openStoreSession: open },
    );
    expect(notFound.status).toBe(404);

    const conflictResponse = await withOwner(
      request,
      async ({ owner }) => {
        owner.store.createIssue("owner-1", {
          idempotencyKey: "issue-handler-conflict",
          title: "Handler conflict",
          statusId: owner.store.ownedWorkflowStates("owner-1")[1].id,
        });
        return json({ ok: false }, 409);
      },
      { resolveOwner: async () => resolvedOwner, openStoreSession: open },
    );
    expect(conflictResponse.status).toBe(409);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const unexpected = await withOwner(
      request,
      async ({ owner }) => {
        owner.store.createIssue("owner-1", {
          idempotencyKey: "issue-unexpected",
          title: "Unexpected error",
          statusId: owner.store.ownedWorkflowStates("owner-1")[1].id,
        });
        throw new Error("unexpected");
      },
      { resolveOwner: async () => resolvedOwner, openStoreSession: open },
    );
    expect(unexpected.status).toBe(500);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();

    const reloaded = await openStoreSession("owner-1", "owner@example.com", environment);
    expect(reloaded.store.listIssues("owner-1").map((issue) => issue.title)).toEqual([
      "Successful mutation",
    ]);
  });

  it("maps a production D1 conflict to a 409 ErrorEnvelope", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const environment = { APP_ENV: "production", DB: database };
    const resolvedOwner = {
      userId: "owner-1",
      email: "owner@example.com",
      accessAuthenticated: true,
    };
    const request = new Request("https://orbit.example/api/v1/issues", {
      method: "POST",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const first = await openStoreSession("owner-1", "owner@example.com", environment);
    const stale = await openStoreSession("owner-1", "owner@example.com", environment);

    const success = await withOwner(
      request,
      async ({ owner }) => {
        owner.store.createIssue("owner-1", {
          idempotencyKey: "issue-first",
          title: "First",
          statusId: owner.store.ownedWorkflowStates("owner-1")[1].id,
        });
        return json({ ok: true });
      },
      { resolveOwner: async () => resolvedOwner, openStoreSession: async () => first },
    );
    expect(success.status).toBe(200);

    const conflict = await withOwner(
      request,
      async ({ owner }) => {
        owner.store.createIssue("owner-1", {
          idempotencyKey: "issue-stale",
          title: "Stale",
          statusId: owner.store.ownedWorkflowStates("owner-1")[1].id,
        });
        return json({ ok: true });
      },
      { resolveOwner: async () => resolvedOwner, openStoreSession: async () => stale },
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "D1_WRITE_CONFLICT" } });
  });

  it("initializes a missing snapshot on the first GET but does not rewrite an existing one", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const environment = { APP_ENV: "production", DB: database };
    const resolvedOwner = {
      userId: "owner-1",
      email: "owner@example.com",
      accessAuthenticated: true,
    };
    const open = (userId: string, email: string) => openStoreSession(userId, email, environment);
    const getRequest = (method: string) =>
      new Request("https://orbit.example/api/v1/bootstrap", { method });

    const initial = await withOwner(
      getRequest("GET"),
      async ({ owner }) => json(owner.store.bootstrap("owner-1")),
      { resolveOwner: async () => resolvedOwner, openStoreSession: open },
    );
    expect(initial.status).toBe(200);
    expect((await readStoreSnapshot(database, "owner-1"))?.version).toBe(1);

    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const session = await open("owner-1", "owner@example.com");
      const response = await withOwner(
        getRequest(method),
        async ({ owner }) => {
          owner.store.cycleSettings.get("owner-1")!.durationWeeks = 8;
          return json({ ok: true });
        },
        { resolveOwner: async () => resolvedOwner, openStoreSession: async () => session },
      );
      expect(response.status).toBe(200);
    }
    expect((await readStoreSnapshot(database, "owner-1"))?.version).toBe(1);

    for (const status of [404, 409]) {
      const session = await open("owner-1", "owner@example.com");
      const response = await withOwner(
        new Request("https://orbit.example/api/v1/issues", {
          method: "POST",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        }),
        async ({ owner }) => {
          owner.store.cycleSettings.get("owner-1")!.durationWeeks = 7;
          return json({ ok: false }, status);
        },
        { resolveOwner: async () => resolvedOwner, openStoreSession: async () => session },
      );
      expect(response.status).toBe(status);
    }
    expect((await readStoreSnapshot(database, "owner-1"))?.version).toBe(1);
  });

  it("does not fall back when production D1 is missing", async () => {
    await expect(
      openStoreSession("owner-1", "owner@example.com", { APP_ENV: "production" }),
    ).rejects.toThrow("Production D1 binding is missing");
  });

  it("[状態遷移] persists a lease expiry discovered during a successful GET", async () => {
    let now = 1_700_000_000_000;
    const database = new FakeD1() as unknown as D1Database;
    const seed = new OrbitStore(() => now);
    seed.ensureOwner("owner-lease", "lease@example.com");
    seed.ensureUpcomingCycles("owner-lease");
    const run = seed.startRun("owner-lease", {
      kind: "maintenance",
      idempotencyKey: "lease-expiry-run",
    });
    await writeStoreSnapshot(database, "owner-lease", 0, seed.toSnapshot(), now);
    now = run.leaseExpiresAt!;
    const environment = { APP_ENV: "production", DB: database };
    const resolvedOwner = {
      userId: "owner-lease",
      email: "lease@example.com",
      accessAuthenticated: true,
    };

    const response = await withOwner(
      new Request("https://orbit.example/api/v1/background-runs/current"),
      async ({ owner }) => {
        const current = owner.store.currentRun("owner-lease");
        return json({ run: current ? owner.store.publicRun(current) : null });
      },
      {
        resolveOwner: async () => resolvedOwner,
        openStoreSession: (userId, email) => openStoreSession(userId, email, environment),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ run: { status: "paused" } });
    const persisted = await readStoreSnapshot(database, "owner-lease");
    const snapshot = persisted?.snapshot as OrbitStoreSnapshot | undefined;
    expect(persisted?.version).toBe(2);
    expect(snapshot?.runs[0]?.status).toBe("paused");
    expect(snapshot?.locks[0]?.status).toBe("idle");
  });

  it("keeps development sessions on the existing Memory Store", async () => {
    resetOrbitStores();
    const environment = { APP_ENV: "development" };
    const first = await openStoreSession("local-owner", "local@example.com", environment);
    first.store.createIssue("local-owner", {
      idempotencyKey: "local-issue",
      title: "Local issue",
      statusId: first.store.ownedWorkflowStates("local-owner")[1].id,
    });
    await first.persist();

    const second = await openStoreSession("local-owner", "local@example.com", environment);
    expect(second.store).toBe(first.store);
    expect(second.store.listIssues("local-owner")[0].title).toBe("Local issue");
    resetOrbitStores();

    for (const appEnv of [undefined, "preview"]) {
      const fixtureEnvironment = appEnv ? { APP_ENV: appEnv } : {};
      const fixture = await openStoreSession("dev-owner", "you@orbit.local", fixtureEnvironment);
      expect(fixture.store.listIssues("dev-owner").length).toBeGreaterThan(0);
      resetOrbitStores();
    }
  });

  it("keeps two production owners in separate snapshot rows", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const environment = { APP_ENV: "production", DB: database };
    const ownerA = await openStoreSession("owner-a", "a@example.com", environment);
    ownerA.store.createIssue("owner-a", {
      idempotencyKey: "issue-a",
      title: "Owner A issue",
      statusId: ownerA.store.ownedWorkflowStates("owner-a")[1].id,
    });
    await ownerA.persist();

    const ownerB = await openStoreSession("owner-b", "b@example.com", environment);
    ownerB.store.createIssue("owner-b", {
      idempotencyKey: "issue-b",
      title: "Owner B issue",
      statusId: ownerB.store.ownedWorkflowStates("owner-b")[1].id,
    });
    await ownerB.persist();

    const reloadedA = await openStoreSession("owner-a", "a@example.com", environment);
    const reloadedB = await openStoreSession("owner-b", "b@example.com", environment);
    expect(reloadedA.store.listIssues("owner-a").map((issue) => issue.title)).toEqual([
      "Owner A issue",
    ]);
    expect(reloadedB.store.listIssues("owner-b").map((issue) => issue.title)).toEqual([
      "Owner B issue",
    ]);
  });
});
