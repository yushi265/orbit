import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { runLocal, localEnvironment, ROOT } from "./local.mjs";

// Bundle existing TypeScript for Node without adding a runtime loader dependency.
async function loadApplication(temp) {
  const require = createRequire(import.meta.url);
  const { build } = require(require.resolve("esbuild", { paths: [require.resolve("vite")] }));
  const outfile = resolve(temp, "application.mjs");
  await build({
    stdin: {
      contents: [
        'export { OrbitStore } from "./src/server/store.ts";',
        'export * from "./src/db/repositories/store-snapshot.ts";',
        'export { bootstrapOwner } from "./src/db/repositories/owner.ts";',
        'export { createDb } from "./src/db/client.ts";',
        'export { defaultProjectIssueDisplaySettings } from "./src/shared/contracts/project-display.ts";',
      ].join("\n"),
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

function fullFixture(OrbitStore, defaults, now) {
  const owner = "local-owner";
  const store = new OrbitStore(() => now);
  store.ensureOwner(owner, "local-owner@orbit.local");
  store.ensureUpcomingCycles(owner);
  const project = store.createProject(owner, {
    idempotencyKey: "project",
    name: "Fixture project",
  });
  store.updateProjectDisplayPreferences(owner, project.id, {
    idempotencyKey: "display",
    displayPreferences: { ...defaults(), showCompleted: false },
  });
  const label = store.createLabel(owner, {
    idempotencyKey: "label",
    name: "Fixture",
    color: "#123456",
  });
  const cycles = store.listCycles(owner);
  const issue = store.createIssue(owner, {
    idempotencyKey: "issue",
    title: "Fixture issue",
    projectId: project.id,
    cycleId: cycles[0].id,
    labelIds: [label.id],
  });
  const related = store.createIssue(owner, { idempotencyKey: "related", title: "Related" });
  store.createIssueNote(owner, issue.id, { idempotencyKey: "note", body: "Fixture note" });
  store.createIssueRelation(owner, issue.id, {
    idempotencyKey: "relation",
    targetIssueId: related.id,
    type: "related",
  });
  store.recordRecentIssueView(owner, issue.id, "recent-view");
  store.recordRecentSearch(owner, { text: "Fixture", filter: {} }, "recent-search");
  store.createView(owner, {
    idempotencyKey: "view",
    name: "Fixture view",
    query: {
      mode: "list",
      filter: {},
      showEmptyGroups: false,
      order: "manual",
      layout: { status: true },
      limit: 100,
    },
  });
  store.updatePreferences(owner, { theme: "dark", colorTheme: "forest" }, "preferences");
  // Synthetic notification: normal-owner notification generation is not implemented.
  // This tests the persistence contract only, not notification generation.
  store.notifications.set("synthetic-notification", {
    id: "synthetic-notification",
    userId: owner,
    type: "due_soon",
    title: "Synthetic persistence fixture",
    body: "No notification-generation claim",
    entityType: "issue",
    entityId: issue.id,
    readAt: null,
    deletedAt: null,
    createdAt: now,
  });
  // Expire the active Cycle so the first chunk performs a real carryover.
  // Its persisted history/receipt must survive resume without being duplicated.
  const active = cycles.find((cycle) => cycle.status === "active");
  assert(active);
  store.cycles.get(active.id).endsAt = now - 1;
  const run = store.startRun(owner, { kind: "maintenance", idempotencyKey: "run" });
  // Save after a completed chunk: resume must preserve its cursor and not repeat it.
  const firstChunk = store.continueRun(owner, run.run_id, {
    expected_cursor: null,
    idempotencyKey: "first-chunk",
  });
  assert(firstChunk.processed_count > 0, "first chunk must perform real cycle work");
  const snapshot = store.toSnapshot();
  for (const [name, value] of Object.entries(snapshot)) {
    if (Array.isArray(value)) assert.ok(value.length > 0, `${name} fixture must be nonempty`);
  }
  assert.equal(snapshot.runs[0].stepIndex, 1);
  assert.notEqual(snapshot.runs[0].progress.cursor, null);
  return { snapshot, runId: run.run_id };
}

test(
  "[状態遷移] 公開Repository×実D1: CAS/Owner分離/全モデル再起動/backup復元/Lease再開",
  { timeout: 180000 },
  async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "orbit-repository-test-"));
    const dataDir = resolve(temp, "data");
    const environment = localEnvironment(process.env, dataDir);
    const now = 1_800_000_000_000;
    let proxy;
    try {
      const app = await loadApplication(temp);
      await runLocal(["setup"], { ...process.env, ORBIT_LOCAL_DATA_DIR: dataDir });
      process.env.WRANGLER_SEND_METRICS = "false";
      process.env.WRANGLER_LOG_PATH = environment.WRANGLER_LOG_PATH;
      process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
      const { getPlatformProxy } = await import("wrangler");
      const open = (directory) =>
        getPlatformProxy({
          configPath: resolve(ROOT, "wrangler.local.jsonc"),
          envFiles: [],
          remoteBindings: false,
          persist: { path: resolve(directory, "v3") },
        });
      proxy = await open(dataDir);
      const db = proxy.env.DB;
      const { snapshot, runId } = fullFixture(
        app.OrbitStore,
        app.defaultProjectIssueDisplaySettings,
        now,
      );
      assert.equal(await app.readStoreSnapshot(db, "local-owner"), null);
      await app.writeStoreSnapshot(db, "local-owner", 0, snapshot, now);
      const alternate = structuredClone(snapshot);
      alternate.preferences[0].theme = "light";
      const outcomes = await Promise.allSettled([
        app.writeStoreSnapshot(db, "local-owner", 1, snapshot, now + 1),
        app.writeStoreSnapshot(db, "local-owner", 1, alternate, now + 1),
      ]);
      assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
      const loser = outcomes.find((result) => result.status === "rejected");
      assert(loser.reason instanceof app.SnapshotVersionConflict);
      const winner = outcomes[0].status === "fulfilled" ? snapshot : alternate;
      assert.deepEqual((await app.readStoreSnapshot(db, "local-owner")).snapshot, winner);
      assert.equal((await app.readStoreSnapshot(db, "local-owner")).version, 2);

      await app.bootstrapOwner(
        app.createDb({ DB: db }),
        "other-owner",
        "Fixture Owner",
        "other@orbit.local",
        now,
      );
      const other = new app.OrbitStore(() => now);
      other.ensureOwner("other-owner", "other@orbit.local");
      other.createIssue("other-owner", { idempotencyKey: "other", title: "Other owner only" });
      const otherSnapshot = other.toSnapshot();
      await app.writeStoreSnapshot(db, "other-owner", 0, otherSnapshot, now);
      assert.deepEqual((await app.readStoreSnapshot(db, "other-owner")).snapshot, otherSnapshot);
      assert.deepEqual((await app.readStoreSnapshot(db, "local-owner")).snapshot, winner);
      assert.equal(await app.readStoreSnapshot(db, "missing-owner"), null);
      assert.throws(
        () => app.OrbitStore.fromSnapshot(otherSnapshot, () => now, "local-owner"),
        /Invalid OrbitStore snapshot/,
      );
      await proxy.dispose();
      proxy = null;

      proxy = await open(dataDir);
      const reloaded = await app.readStoreSnapshot(proxy.env.DB, "local-owner");
      assert.deepEqual(reloaded.snapshot, winner, "all fields survive runtime disposal/recreation");
      assert.deepEqual(
        app.OrbitStore.fromSnapshot(reloaded.snapshot, () => now, "local-owner").toSnapshot(),
        winner,
      );
      await proxy.dispose();
      proxy = null;
      const backup = resolve(temp, "backup");
      const restored = resolve(temp, "restored");
      await runLocal(["backup", backup], { ...process.env, ORBIT_LOCAL_DATA_DIR: dataDir });
      await runLocal(["restore", backup, restored], {
        ...process.env,
        ORBIT_LOCAL_DATA_DIR: dataDir,
      });
      proxy = await open(restored);
      const restoredRow = await app.readStoreSnapshot(proxy.env.DB, "local-owner");
      assert.deepEqual(
        restoredRow,
        reloaded,
        "backup/restore preserves version and complete snapshot",
      );
      assert.deepEqual(
        (await app.readStoreSnapshot(proxy.env.DB, "other-owner")).snapshot,
        otherSnapshot,
      );

      const expiry = winner.runs[0].leaseExpiresAt;
      assert.equal(typeof expiry, "number");
      const recovered = app.OrbitStore.fromSnapshot(
        restoredRow.snapshot,
        () => expiry,
        "local-owner",
      );
      assert.equal(recovered.currentRun("local-owner").status, "paused");
      assert.equal(recovered.locks.get("local-owner").status, "idle");
      const previousIndex = recovered.runs.get(runId).stepIndex;
      recovered.resumeRun("local-owner", runId);
      assert.equal(recovered.runs.get(runId).stepIndex, previousIndex);
      assert.equal(recovered.runs.get(runId).resume_count, 1);
      const staleRetry = recovered.continueRun("local-owner", runId, {
        expected_cursor: null,
        idempotencyKey: "replayed-first-chunk",
      });
      assert.equal(staleRetry.processed_count, 0);
      assert.equal(recovered.runs.get(runId).stepIndex, previousIndex);
      for (let index = 0; index < 3 && recovered.runs.get(runId).status === "running"; index++) {
        recovered.continueRun("local-owner", runId, {
          expected_cursor: recovered.runs.get(runId).progress.cursor,
          idempotencyKey: `resumed-${index}`,
        });
      }
      assert.equal(recovered.runs.get(runId).status, "succeeded");
      const completed = recovered.toSnapshot();
      assert.deepEqual(
        completed.cycleHistory,
        winner.cycleHistory,
        "resume cannot repeat cycle carryover",
      );
      assert.deepEqual(
        completed.activities,
        winner.activities,
        "resume cannot duplicate completed-step activity",
      );
      assert.equal(
        recovered.continueRun("local-owner", runId, {
          expected_cursor: null,
          idempotencyKey: "completed-retry",
        }).processed_count,
        0,
      );
      assert.deepEqual(recovered.toSnapshot(), completed, "completed retry cannot repeat work");
      await app.writeStoreSnapshot(
        proxy.env.DB,
        "local-owner",
        restoredRow.version,
        completed,
        expiry,
      );
      await proxy.dispose();
      proxy = null;
      proxy = await open(restored);
      assert.deepEqual(
        (await app.readStoreSnapshot(proxy.env.DB, "local-owner")).snapshot,
        completed,
      );
    } finally {
      if (proxy) await proxy.dispose();
      await rm(temp, { recursive: true, force: true });
    }
  },
);
