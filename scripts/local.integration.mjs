import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { runLocal, localEnvironment, wranglerArgs, executeTool, ROOT } from "./local.mjs";

const ORIGIN = "http://127.0.0.1:3000";
async function request(path, body) {
  const response = await fetch(
    `${ORIGIN}${path}`,
    body
      ? {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            Origin: ORIGIN,
          },
          body: JSON.stringify(body),
        }
      : {},
  );
  assert.ok(response.ok, `${path}: ${response.status} ${response.ok ? "" : await response.text()}`);
  return response.json();
}
async function start(dataDir) {
  const child = spawn(process.execPath, [resolve(ROOT, "scripts/local.mjs"), "start"], {
    cwd: tmpdir(),
    env: { ...process.env, ORBIT_LOCAL_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  const closed = new Promise((accept) => child.on("close", (code) => accept(code)));
  const stop = async () => {
    child.kill("SIGTERM");
    const code = await closed;
    assert.equal(code, 0, output);
  };
  try {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (child.exitCode !== null) throw new Error(`local:start exited: ${output}`);
      if (stripVTControlCharacters(output).includes("http://127.0.0.1:3000")) return { stop };
      await delay(100);
    }
    throw new Error(`startup timeout: ${output}`);
  } catch (error) {
    child.kill("SIGTERM");
    await closed;
    throw error;
  }
}
async function query(dataDir, sql) {
  const { stdout } = await executeTool(
    wranglerArgs(dataDir, ["d1", "execute", "orbit-local", "--json", "--command", sql]),
    localEnvironment(process.env, dataDir),
  );
  return JSON.parse(stdout).flatMap((result) => result.results ?? []);
}

test(
  "[状態遷移] 実D1: 初期化・API保存・停止・再初期化・再起動・backup/restore",
  { timeout: 180000 },
  async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "orbit-local-test-"));
    const dataDir = resolve(temp, "data");
    const env = { ...process.env, ORBIT_LOCAL_DATA_DIR: dataDir };
    let server;
    try {
      await runLocal(["setup"], env);
      server = await start(dataDir);
      const first = await request("/api/v1/bootstrap");
      assert.equal(first.me.id, "local-owner");
      assert.equal(first.issues.length, 0);
      const { project } = await request("/api/v1/projects", {
        idempotencyKey: "local-project",
        name: "永続Project",
      });
      const { issue } = await request("/api/v1/issues", {
        idempotencyKey: "local-issue",
        title: "再起動後も残る",
        projectId: project.id,
      });
      await assert.rejects(runLocal(["setup"], env), /使用中/);
      await assert.rejects(runLocal(["backup", resolve(temp, "busy-backup")], env), /使用中/);
      const denied = await fetch(`${ORIGIN}/api/v1/issues`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Origin: "https://attacker.example",
        },
        body: JSON.stringify({ idempotencyKey: "bad-origin", title: "拒否" }),
      });
      assert.equal(denied.status, 400);
      await server.stop();
      server = null;
      const snapshotSql =
        "SELECT user_id, version, state_json, updated_at FROM orbit_store_snapshots ORDER BY user_id";
      const beforeSetup = await query(dataDir, snapshotSql);
      await runLocal(["setup"], env);
      assert.deepEqual(await query(dataDir, snapshotSql), beforeSetup);
      server = await start(dataDir);
      const after = await request("/api/v1/bootstrap");
      assert.equal(after.issues.find((item) => item.id === issue.id).title, "再起動後も残る");
      assert.equal(after.projects.find((item) => item.id === project.id).name, "永続Project");
      await server.stop();
      server = null;
      const snapshot = await query(dataDir, snapshotSql);
      const backup = resolve(temp, "backup");
      const restored = resolve(temp, "restored");
      await runLocal(["backup", backup], env);
      await runLocal(["restore", backup, restored], env);
      assert.deepEqual(await query(restored, snapshotSql), snapshot);
      server = await start(restored);
      assert.equal((await request("/api/v1/bootstrap")).issues[0].id, issue.id);
      await request("/api/v1/issues", { idempotencyKey: "restored-write", title: "復元後の追加" });
      await server.stop();
      server = null;
      const manifest = JSON.parse(await readFile(resolve(backup, "manifest.json"), "utf8"));
      assert.equal(manifest.format, 1);
      for (const dir of [dataDir, restored])
        await assert.rejects(access(`${dir}.network-denied.log`));
    } finally {
      if (server) await server.stop();
      await rm(temp, { recursive: true, force: true });
    }
  },
);
