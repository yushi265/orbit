import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import { readStoreSnapshot, writeStoreSnapshot } from "../db/repositories/store-snapshot";
import { ServiceError } from "./errors";
import { withOwner, json } from "./http";
import { defaultProjectIssueDisplaySettings } from "../shared/contracts/project-display";
import { encodeStoreSnapshot } from "./store-snapshot-compat";
import { openStoreSession } from "./store-session";
import { FakeD1 } from "./store-session.test-fixtures";
import { OrbitStore, resetOrbitStores, type OrbitStoreSnapshot } from "./store";

describe("store session", () => {
  it("[状態遷移] localはD1へ保存し、Memory Storeリセット後も空状態から作ったIssueを再読込する", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const environment = { APP_ENV: "local", ORBIT_STORAGE: "d1", DB: database };
    const first = await openStoreSession("local-owner", "local-owner@orbit.local", environment);
    expect(first.store.listIssues("local-owner")).toHaveLength(0);
    first.store.createIssue("local-owner", {
      idempotencyKey: "local-d1-issue",
      title: "Persistent local issue",
    });
    await first.persist();
    resetOrbitStores();
    const reloaded = await openStoreSession("local-owner", "local-owner@orbit.local", environment);
    expect(reloaded.store).not.toBe(first.store);
    expect(reloaded.store.listIssues("local-owner").map((issue) => issue.title)).toEqual([
      "Persistent local issue",
    ]);
    expect((await readStoreSnapshot(database, "local-owner"))?.version).toBe(1);
  });

  it("[レイヤー内結合] production Sessionの再読込後もCycle繰越履歴を投影する", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const environment = { APP_ENV: "production", DB: database };
    const first = await openStoreSession("owner-history-session", "owner@example.com", environment);
    const active = first.store
      .listCycles("owner-history-session")
      .find((cycle) => cycle.status === "active")!;
    const upcoming = first.store
      .listCycles("owner-history-session")
      .find((cycle) => cycle.status === "upcoming")!;
    const issue = first.store.createIssue("owner-history-session", {
      idempotencyKey: "production-history-issue",
      title: "Production履歴対象",
      cycleId: active.id,
    });
    first.store.cycleHistory.push({
      id: "production-history-entry",
      userId: "owner-history-session",
      issueId: issue.id,
      fromCycleId: active.id,
      toCycleId: upcoming.id,
      movedAt: 1_700_000_000_001,
    });
    await first.persist();

    const second = await openStoreSession(
      "owner-history-session",
      "owner@example.com",
      environment,
    );

    expect(second.store.bootstrap("owner-history-session").cycleHistory).toEqual([
      {
        id: "production-history-entry",
        issue: { id: issue.id, identifier: issue.identifier, title: issue.title },
        fromCycle: {
          id: active.id,
          number: active.number,
          name: active.nameOverride ?? active.name,
        },
        toCycle: {
          id: upcoming.id,
          number: upcoming.number,
          name: upcoming.nameOverride ?? upcoming.name,
        },
        movedAt: 1_700_000_000_001,
      },
    ]);
    expect(second.store.getIssueDetail("owner-history-session", issue.id).carryoverCount).toBe(1);
  });

  it("[状態遷移] productionのCycleSettingsを保存し、次回Sessionで再読込できる", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const environment = { APP_ENV: "production", DB: database };
    const first = await openStoreSession("owner-cycle-settings", "owner@example.com", environment);

    const updated = first.store.updateCycleSettings("owner-cycle-settings", {
      idempotencyKey: "production-cycle-settings",
      durationWeeks: 6,
      startWeekday: 4,
      cooldownWeeks: 3,
      futureCount: 8,
    });
    expect(updated).toMatchObject({
      durationWeeks: 6,
      startWeekday: 4,
      cooldownWeeks: 3,
      futureCount: 8,
    });
    await first.persist();

    const second = await openStoreSession("owner-cycle-settings", "owner@example.com", environment);
    expect(second.store.cycleSettings.get("owner-cycle-settings")).toMatchObject({
      durationWeeks: 6,
      startWeekday: 4,
      cooldownWeeks: 3,
      futureCount: 8,
    });
  });

  it("[状態遷移] productionのCycle日付調整をSnapshotへ保存し、次回Sessionで再読込できる", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const environment = { APP_ENV: "production", DB: database };
    const first = await openStoreSession("owner-cycle-schedule", "owner@example.com", environment);
    const target = first.store
      .bootstrap("owner-cycle-schedule")
      .cycles.find((cycle) => cycle.status === "upcoming")!;

    const updated = first.store.updateCycleSchedule("owner-cycle-schedule", target.id, {
      idempotencyKey: "production-cycle-schedule",
      startDate: "2030-01-07",
      endDate: "2030-01-21",
    });
    expect(updated).toMatchObject({
      startsAt: 1_893_942_000_000,
      endsAt: 1_895_151_600_000,
      scheduleOverridden: true,
    });
    await first.persist();

    const second = await openStoreSession("owner-cycle-schedule", "owner@example.com", environment);
    expect(second.store.cycles.get(target.id)).toMatchObject({
      startsAt: 1_893_942_000_000,
      endsAt: 1_895_151_600_000,
      scheduleOverridden: true,
    });
  });

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

  it.each(["local", "production"])(
    "does not persist a discarded session and rejects stale writers (%s)",
    async (APP_ENV) => {
      const database = new FakeD1() as unknown as D1Database;
      const environment = { APP_ENV, ORBIT_STORAGE: "d1", DB: database };
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
    },
  );

  it.each(["local", "production"])(
    "persists only successful mutation handlers (%s)",
    async (APP_ENV) => {
      const database = new FakeD1() as unknown as D1Database;
      const environment = { APP_ENV, ORBIT_STORAGE: "d1", DB: database };
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
    },
  );

  it.each(["local", "production"])(
    "maps a production D1 conflict to a 409 ErrorEnvelope (%s)",
    async (APP_ENV) => {
      const database = new FakeD1() as unknown as D1Database;
      const environment = { APP_ENV, ORBIT_STORAGE: "d1", DB: database };
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
    },
  );

  it.each(["local", "production"])(
    "initializes a missing snapshot on the first GET but does not rewrite an existing one (%s)",
    async (APP_ENV) => {
      const database = new FakeD1() as unknown as D1Database;
      const environment = { APP_ENV, ORBIT_STORAGE: "d1", DB: database };
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
    },
  );

  it("does not fall back when production D1 is missing", async () => {
    await expect(
      openStoreSession("owner-1", "owner@example.com", { APP_ENV: "production" }),
    ).rejects.toThrow("Production D1 binding is missing");
  });

  it.each(["local", "production"])(
    "[状態遷移] persists a lease expiry discovered during a successful GET (%s)",
    async (APP_ENV) => {
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
      const environment = { APP_ENV, ORBIT_STORAGE: "d1", DB: database };
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
    },
  );

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

    for (const appEnv of [undefined, "development"]) {
      const fixtureEnvironment = appEnv ? { APP_ENV: appEnv } : {};
      const fixture = await openStoreSession("dev-owner", "you@orbit.local", fixtureEnvironment);
      expect(fixture.store.listIssues("dev-owner").length).toBeGreaterThan(0);
      resetOrbitStores();
    }
  });

  it.each(["local", "production"])(
    "keeps two production owners in separate snapshot rows (%s)",
    async (APP_ENV) => {
      const database = new FakeD1() as unknown as D1Database;
      const environment = { APP_ENV, ORBIT_STORAGE: "d1", DB: database };
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
    },
  );
});

it("[同値分割] localのDB欠落・不正JSON・不正Snapshot・書込例外を500へ変換し再生成しない", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const fault of ["missing", "json", "shape", "write"]) {
      const run = vi.fn(async () => {
        throw new Error("disk write failed");
      });
      const statement = {
        bind: (..._values: unknown[]) => statement,
        first: async () =>
          fault === "write"
            ? null
            : { version: 1, stateJson: fault === "json" ? "broken-json" : "{}", updatedAt: 1 },
        run,
      };
      const DB =
        fault === "missing" ? undefined : ({ prepare: () => statement } as unknown as D1Database);
      const environment = { APP_ENV: "local", ORBIT_STORAGE: "d1", DB };
      const handler = vi.fn(async ({ owner }: { owner: { store: OrbitStore } }) =>
        json(owner.store.bootstrap("local-owner")),
      );
      const response = await withOwner(
        new Request("http://127.0.0.1:3000/api/v1/bootstrap", {
          headers: { Host: "127.0.0.1:3000" },
        }),
        handler,
        {
          runtimeEnv: async () => environment as unknown as import("./auth").RuntimeEnvironment,
          resolveOwner: async () => ({
            userId: "local-owner",
            email: "local-owner@orbit.local",
            accessAuthenticated: false,
          }),
        },
      );
      expect(response.status, fault).toBe(500);
      expect(await response.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
      if (fault !== "write") {
        expect(handler).not.toHaveBeenCalled();
        expect(run).not.toHaveBeenCalled();
      } else {
        expect(run).toHaveBeenCalledTimes(1);
      }
    }
  } finally {
    consoleError.mockRestore();
  }
});

it.each(["local", "production"])(
  "[レイヤー内結合] %s D1 stores legacy settings but bootstrap and retries restore new settings without metadata",
  async (APP_ENV) => {
    const database = new FakeD1() as unknown as D1Database;
    const environment = { APP_ENV, ORBIT_STORAGE: "d1", DB: database };
    const owner = "owner-compat-session";
    const first = await openStoreSession(owner, "compat@example.com", environment);
    const project = first.store.createProject(owner, {
      idempotencyKey: "compat-project",
      name: "Compatibility",
    });
    const input = {
      idempotencyKey: "compat-settings",
      displayPreferences: {
        ...defaultProjectIssueDisplaySettings(),
        order: "priority_asc" as const,
        dueFilter: "next7" as const,
      },
    };
    const updated = first.store.updateProjectDisplayPreferences(owner, project.id, input);
    first.store.createIssue(owner, {
      idempotencyKey: "compat-issue",
      title: "Date carrier",
      dueAt: 1_800_007_200_000,
    });
    await first.persist();
    const persisted = await readStoreSnapshot(database, owner);
    expect(
      (persisted!.snapshot as OrbitStoreSnapshot).projectDisplayPreferences[0].settings,
    ).toMatchObject({ order: "priority_desc", dueFilter: "upcoming" });
    expect(persisted!.version).toBe(1);
    const second = await openStoreSession(owner, "compat@example.com", environment);
    expect(second.needsInitialPersist).toBe(false);
    expect(second.store.updateProjectDisplayPreferences(owner, project.id, input)).toEqual(updated);
    expect(second.store.bootstrap(owner).projectDisplayPreferences[0].settings).toMatchObject({
      order: "priority_asc",
      dueFilter: "next7",
    });
    expect(second.store.listIssues(owner)[0].dueAt).toBe(1_800_007_200_000);
    expect(JSON.stringify(second.store.toSnapshot())).not.toContain("__orbitRollback");
    expect(JSON.stringify(second.store.bootstrap(owner))).not.toContain("__orbitRollback");
    await second.persist();
    expect((await readStoreSnapshot(database, owner))!.version).toBe(1);
    expect(() =>
      second.store.updateProjectDisplayPreferences(owner, project.id, {
        ...input,
        displayPreferences: { ...input.displayPreferences, order: "priority_desc" },
      }),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" }));
  },
);
it.each(["local", "production"])(
  "[同値分割] %s rejects corrupt compatibility metadata before opening or overwriting its D1 row",
  async (APP_ENV) => {
    const database = new FakeD1() as unknown as D1Database;
    const owner = "owner-corrupt-meta";
    const store = new OrbitStore(() => 1_800_000_000_000);
    store.ensureOwner(owner, "compat@example.com");
    store.ensureUpcomingCycles(owner);
    const project = store.createProject(owner, {
      idempotencyKey: "corrupt-project",
      name: "Corruption",
    });
    store.updateProjectDisplayPreferences(owner, project.id, {
      idempotencyKey: "corrupt-settings",
      displayPreferences: { ...defaultProjectIssueDisplaySettings(), order: "created_asc" },
    });
    const saved = encodeStoreSnapshot(store.toSnapshot()) as OrbitStoreSnapshot;
    const item = saved.projectDisplayPreferences[0] as unknown as Record<string, unknown>;
    (item.__orbitRollback as Record<string, unknown>).version = 999;
    await writeStoreSnapshot(database, owner, 0, saved, 1_800_000_000_000);
    const before = await readStoreSnapshot(database, owner);
    await expect(
      openStoreSession(owner, "compat@example.com", { APP_ENV, ORBIT_STORAGE: "d1", DB: database }),
    ).rejects.toThrow("Invalid OrbitStore rollback metadata");
    expect(await readStoreSnapshot(database, owner)).toEqual(before);
  },
);

it.each([
  ["local", "version"],
  ["local", "owner"],
  ["production", "version"],
  ["production", "owner"],
] as const)(
  "[同値分割] %s does not overwrite a row with invalid old Receipt inner metadata (%s)",
  async (APP_ENV, fault) => {
    const database = new FakeD1() as unknown as D1Database;
    const owner = "owner-corrupt-inner-meta";
    const store = new OrbitStore(() => 1_800_000_000_000);
    store.ensureOwner(owner, "compat@example.com");
    store.ensureUpcomingCycles(owner);
    const project = store.createProject(owner, { idempotencyKey: "inner-project", name: "Inner" });
    store.updateProjectDisplayPreferences(owner, project.id, {
      idempotencyKey: "inner-settings",
      displayPreferences: { ...defaultProjectIssueDisplaySettings(), order: "created_asc" },
    });
    const saved = encodeStoreSnapshot(store.toSnapshot()) as OrbitStoreSnapshot;
    const old = structuredClone(
      saved.receipts.find((item) => item.operation === "project.displayPreferences.update")!,
    );
    old.idempotencyKey = "legacy-inner";
    delete (old as unknown as Record<string, unknown>).__orbitRollback;
    old.response = structuredClone(saved.projectDisplayPreferences[0]);
    const inner = (old.response as Record<string, unknown>).__orbitRollback as Record<
      string,
      unknown
    >;
    if (fault === "version") inner.version = 2;
    else inner.userId = "different-owner";
    saved.receipts.push(old);
    await writeStoreSnapshot(database, owner, 0, saved, 1_800_000_000_000);
    const before = await readStoreSnapshot(database, owner);
    await expect(
      openStoreSession(owner, "compat@example.com", { APP_ENV, ORBIT_STORAGE: "d1", DB: database }),
    ).rejects.toThrow("Invalid OrbitStore rollback metadata");
    expect(await readStoreSnapshot(database, owner)).toEqual(before);
  },
);
