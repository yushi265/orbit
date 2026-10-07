import { describe, expect, it } from "vitest";
import { resolveDataDir, localEnvironment, wranglerArgs } from "./local.mjs";
import { resolve } from "node:path";

describe("ローカルCLI設定", () => {
  it("[同値分割/境界値] LAN接続先は非internal RFC1918 IPv4だけを重複なく列挙する", async () => {
    const { lanAddresses } = await import("./local.mjs");
    const addresses = [
      "9.255.255.255",
      "10.0.0.0",
      "10.255.255.255",
      "11.0.0.0",
      "172.15.255.255",
      "172.16.0.0",
      "172.31.255.255",
      "172.32.0.0",
      "192.167.255.255",
      "192.168.0.0",
      "192.168.255.255",
      "192.169.0.0",
      "100.64.0.1",
      "8.8.8.8",
      "127.0.0.1",
      "192.168.0.0",
      "192.168.999.1",
    ];
    expect(
      lanAddresses({
        en0: addresses.map((address) => ({ address, family: "IPv4", internal: false })),
        lo: [{ address: "10.1.2.3", family: "IPv4", internal: true }],
        v6: [{ address: "fd00::1", family: "IPv6", internal: false }],
        missing: undefined,
      }),
    ).toEqual([
      "10.0.0.0",
      "10.255.255.255",
      "172.16.0.0",
      "172.31.255.255",
      "192.168.0.0",
      "192.168.255.255",
    ]);
    expect(lanAddresses({})).toEqual([]);
  });
  it("[同値分割] cwdに依存せず絶対保存先を解決し、相対上書きを拒否する", () => {
    expect(resolveDataDir({})).toBe(resolve(import.meta.dirname, "../.orbit/local"));
    expect(resolveDataDir({ ORBIT_LOCAL_DATA_DIR: "/tmp/orbit data" })).toBe("/tmp/orbit data");
    expect(() => resolveDataDir({ ORBIT_LOCAL_DATA_DIR: "relative" })).toThrow(/絶対/);
  });
});

it("[デシジョンテーブル] start --lanだけがLAN待受と導出したOriginを渡しURLを表示する", async () => {
  const { runLocal } = await import("./local.mjs");
  const { mkdtemp, rm, mkdir, writeFile } = await import("node:fs/promises");
  const tmp = await mkdtemp("/tmp/orbit-lan-");
  try {
    await mkdir(`${tmp}/data`);
    await writeFile(`${tmp}/data/initialized.json`, '{"format":1}');
    const env = {
      ORBIT_LOCAL_DATA_DIR: `${tmp}/data`,
      ORBIT_LOCAL_ORIGINS: '["http://evil.test:3000"]',
    };
    const calls = [];
    const messages = [];
    const execute = async (args, environment, tool) => {
      calls.push({ args, environment, tool });
      return {
        stdout: JSON.stringify([
          { results: [{ id: "local-owner", email: "local-owner@orbit.local" }] },
        ]),
      };
    };
    const options = {
      interfaces: () => ({ en0: [{ address: "192.168.1.2", family: "IPv4", internal: false }] }),
      log: (message) => messages.push(message),
    };
    for (const argv of [["start", "--lan"], ["start", "--", "--lan"], ["start"]]) {
      calls.length = 0;
      messages.length = 0;
      await runLocal(argv, env, execute, options);
      const lan = argv.includes("--lan");
      const vite = calls.find((call) => call.tool === "vite");
      expect(vite.args).toEqual([
        "dev",
        "--host",
        lan ? "0.0.0.0" : "127.0.0.1",
        "--port",
        "3000",
        "--strictPort",
      ]);
      expect(JSON.parse(vite.environment.ORBIT_LOCAL_ORIGINS)).toEqual(
        lan ? ["http://127.0.0.1:3000", "http://192.168.1.2:3000"] : ["http://127.0.0.1:3000"],
      );
      if (lan) {
        expect(messages.join("\n")).toContain("http://127.0.0.1:3000");
        expect(messages.join("\n")).toContain("http://192.168.1.2:3000");
      } else {
        // Normal startup consumers use Vite's URL output as a readiness signal.
        expect(messages).toEqual([]);
      }
    }
    calls.length = 0;
    for (const argv of [
      ["start", "--lan", "--lan"],
      ["setup", "--lan"],
      ["start", "--host", "0.0.0.0"],
      ["start", "--oops"],
      ["start", "--", "--", "--lan"],
      ["start", "--lan", "--"],
      ["--", "start"],
    ]) {
      await expect(runLocal(argv, env, execute, options)).rejects.toThrow(/引数/);
    }
    await expect(
      runLocal(["start", "--lan"], env, execute, { ...options, interfaces: () => ({}) }),
    ).rejects.toThrow(/LAN/);
    expect(calls).toHaveLength(0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

it("[デシジョンテーブル] 資格情報とproduction設定を継承せず全Wrangler引数をlocalへ固定する", () => {
  const env = localEnvironment(
    {
      PATH: "/bin",
      CLOUDFLARE_API_TOKEN: "secret",
      CLOUDFLARE_ENV: "production",
      APP_ENV: "production",
      NODE_OPTIONS: "injected",
      WRANGLER_HIDE_BANNER: "false",
    },
    "/tmp/data",
  );
  expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined();
  expect(env.CLOUDFLARE_ENV).toBeUndefined();
  expect(env.APP_ENV).toBe("local");
  expect(env.WRANGLER_SEND_METRICS).toBe("false");
  expect(env.WRANGLER_HIDE_BANNER).toBe("true");
  expect(env.NODE_OPTIONS).not.toContain("injected");
  const args = wranglerArgs("/tmp/data", ["d1", "migrations", "apply", "orbit-local"]);
  expect(args).toContain("--local");
  expect(args).not.toContain("--remote");
  expect(args[args.indexOf("--persist-to") + 1]).toBe("/tmp/data");
  expect(args[args.indexOf("--config") + 1]).toBe(
    resolve(import.meta.dirname, "../wrangler.local.jsonc"),
  );
});

it("[状態遷移] setupはmigrationとOwner照合・不足行登録をlocalで実施し排他を解放する", async () => {
  const { runLocal } = await import("./local.mjs");
  const { mkdtemp, rm, readdir, realpath } = await import("node:fs/promises");
  const tmp = await realpath(await mkdtemp("/tmp/orbit-cli-"));
  const calls = [];
  try {
    await runLocal(["setup"], { ORBIT_LOCAL_DATA_DIR: `${tmp}/data` }, async (args) => {
      calls.push(args);
      return {
        stdout: JSON.stringify([
          { results: [{ id: "local-owner", email: "local-owner@orbit.local" }] },
        ]),
      };
    });
    expect(calls[0]).toContain("migrations");
    expect(calls.every((args) => args.includes("--local") && args.includes(`${tmp}/data`))).toBe(
      true,
    );
    expect(
      calls.some((args) => args.some((v) => v.includes("ON CONFLICT(user_id) DO NOTHING"))),
    ).toBe(true);
    expect(await readdir(tmp)).not.toContain("data.lock");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

it("[状態遷移/禁止] 使用中の保存先のsetupを拒否し、未初期化のstartはCLIを呼ばない", async () => {
  const { runLocal, withLock } = await import("./local.mjs");
  const { mkdtemp, rm, realpath } = await import("node:fs/promises");
  const tmp = await realpath(await mkdtemp("/tmp/orbit-cli-"));
  try {
    const env = { ORBIT_LOCAL_DATA_DIR: `${tmp}/data` };
    await withLock(`${tmp}/data`, async () => {
      await expect(runLocal(["setup"], env)).rejects.toThrow(/使用中/);
    });
    await expect(
      runLocal(["start"], env, () => {
        throw new Error("呼ばれてはいけない");
      }),
    ).rejects.toThrow(/未初期化/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

it("[代表値] local Vite配線は専用設定・同じ保存先・loopback・無効Inspectorを選ぶ", async () => {
  const { localViteOptions } = await import("./local.mjs");
  const result = localViteOptions({ ORBIT_LOCAL_MODE: "1", ORBIT_LOCAL_DATA_DIR: "/tmp/data" });
  expect(result.server).toMatchObject({ host: "127.0.0.1", port: 3000, strictPort: true });
  expect(result.cloudflare).toMatchObject({
    configPath: resolve(import.meta.dirname, "../wrangler.local.jsonc"),
    persistState: { path: "/tmp/data" },
    inspectorPort: false,
    remoteBindings: false,
  });
  expect(localViteOptions({})).toBeUndefined();
  expect(() => localViteOptions({ ORBIT_LOCAL_MODE: "1", CLOUDFLARE_ENV: "production" })).toThrow();
});

it("[デシジョンテーブル] ViteはCLIのOriginを既存Worker varsを維持して渡し未指定はloopbackにする", async () => {
  const { localViteOptions } = await import("./local.mjs");
  for (const value of [
    undefined,
    '["http://127.0.0.1:3000","http://192.168.1.2:3000"]',
    "invalid",
  ]) {
    const result = localViteOptions({ ORBIT_LOCAL_MODE: "1", ORBIT_LOCAL_ORIGINS: value });
    const config = result.cloudflare.config({ vars: { APP_ENV: "local", ORBIT_STORAGE: "d1" } });
    expect(config.vars).toEqual({
      APP_ENV: "local",
      ORBIT_STORAGE: "d1",
      ORBIT_LOCAL_ORIGINS: value ?? '["http://127.0.0.1:3000"]',
    });
  }
});

it("[デシジョンテーブル] Viteの接続案内は許可OriginのみでlocalhostやVPNアドレスを表示しない", async () => {
  const { localViteOptions } = await import("./local.mjs");
  for (const lan of [false, true]) {
    const printed = [];
    const server = {
      resolvedUrls: null,
      printUrls() {
        printed.push(this.resolvedUrls);
      },
    };
    const options = localViteOptions({
      ORBIT_LOCAL_MODE: "1",
      ...(lan
        ? { ORBIT_LOCAL_ORIGINS: '["http://127.0.0.1:3000","http://192.168.0.180:3000"]' }
        : {}),
    });
    options.urlPlugin.configureServer(server);
    // Vite resolves these URLs only after configureServer and listen.
    server.resolvedUrls = {
      local: ["http://localhost:3000/"],
      network: ["http://192.168.0.180:3000/", "http://100.83.3.89:3000/"],
    };
    server.printUrls();
    expect(printed).toEqual([
      {
        local: ["http://127.0.0.1:3000/"],
        network: lan ? ["http://192.168.0.180:3000/"] : [],
      },
    ]);
  }
});

it("[同値分割] 通信防壁は外部DNS/TCPを拒否しloopbackとUnix socketを許可する", async () => {
  const { assertLocalHost } = await import("./local-network.mjs");
  for (const host of ["127.0.0.1", "::1", "localhost", undefined])
    expect(() => assertLocalHost(host)).not.toThrow();
  for (const host of ["api.cloudflare.com", "8.8.8.8", "192.168.1.1"])
    expect(() => assertLocalHost(host)).toThrow(/外部通信/);
});

it("[結合/アクセス境界] LAN待受用の数値lookupを許可し0.0.0.0とLANへの外向き接続は拒否する", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, rm, access } = await import("node:fs/promises");
  const tmp = await mkdtemp("/tmp/orbit-network-bind-");
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      import dns from 'node:dns';
      import net from 'node:net';
      const address = await new Promise((resolve, reject) => dns.lookup('0.0.0.0', (error, value) => error ? reject(error) : resolve(value)));
      assert.equal(address, '0.0.0.0');
      assert.equal((await dns.promises.lookup('0.0.0.0')).address, '0.0.0.0');
      const server = net.createServer();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '0.0.0.0', resolve);
      });
      assert.equal(server.address().address, '0.0.0.0');
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      console.log('bind passed');
    `,
      ],
      { env: localEnvironment(process.env, `${tmp}/data`) },
    );
    expect(stdout).toContain("bind passed");
    await expect(access(`${tmp}/data.network-denied.log`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    const denied = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      import dns from 'node:dns';
      import net from 'node:net';
      for (const host of ['0.0.0.0', '192.168.1.2', '8.8.8.8']) {
        assert.throws(() => net.connect({ host, port: 3000 }), { code: 'ORBIT_LOCAL_NETWORK_DENIED' });
      }
      for (const host of ['192.168.1.2', 'example.com']) {
        assert.throws(() => dns.lookup(host, () => {}), { code: 'ORBIT_LOCAL_NETWORK_DENIED' });
        await assert.rejects(async () => dns.promises.lookup(host), { code: 'ORBIT_LOCAL_NETWORK_DENIED' });
      }
      console.log('outgoing denied');
    `,
      ],
      { env: localEnvironment(process.env, `${tmp}/data`) },
    );
    expect(denied.stdout).toContain("outgoing denied");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// backup/restoreは呼び出しごとに版情報取得でpnpm・gitを子プロセス起動する（本テストは4回）。
// 全体実行でCPUが混むと起動待ちだけで既定の5秒を超えるため、待ち時間を明示する。
it("[状態遷移] backupは全状態と版情報を保存し空の別保存先へ復元、非空先と重複backupを拒否する", async () => {
  const { runLocal } = await import("./local.mjs");
  const { mkdtemp, rm, realpath, mkdir, writeFile, readFile } = await import("node:fs/promises");
  const tmp = await realpath(await mkdtemp("/tmp/orbit-cli-"));
  const env = { ...process.env, ORBIT_LOCAL_DATA_DIR: `${tmp}/data` };
  try {
    await mkdir(`${tmp}/data/nested`, { recursive: true });
    await writeFile(`${tmp}/data/initialized.json`, '{"format":1}');
    await writeFile(`${tmp}/data/nested/state`, "snapshot and lock and receipt");
    await runLocal(["backup", `${tmp}/backup`], env);
    const metadata = JSON.parse(await readFile(`${tmp}/backup/manifest.json`, "utf8"));
    expect(metadata).toMatchObject({ format: 1, node: process.version });
    expect(metadata.lockfileSha256).toMatch(/^[a-f0-9]{64}$/);
    await runLocal(["restore", `${tmp}/backup`, `${tmp}/restored`], env);
    expect(await readFile(`${tmp}/restored/nested/state`, "utf8")).toBe(
      "snapshot and lock and receipt",
    );
    await expect(runLocal(["restore", `${tmp}/backup`, `${tmp}/restored`], env)).rejects.toThrow(
      /空/,
    );
    await expect(runLocal(["backup", `${tmp}/backup`], env)).rejects.toThrow(/存在/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}, 20_000);

it("[代表値] Wranglerユーザー設定は保存先専用XDGディレクトリに隔離する", () => {
  expect(
    localEnvironment({ HOME: "/user", XDG_CONFIG_HOME: "/credentials" }, "/tmp/data"),
  ).toMatchObject({ HOME: "/user", XDG_CONFIG_HOME: "/tmp/data.config" });
});

it("[同値分割] Owner衝突では登録SQLを実行せず、migration失敗も握り潰さない", async () => {
  const { runLocal } = await import("./local.mjs");
  const { mkdtemp, rm, realpath } = await import("node:fs/promises");
  const tmp = await realpath(await mkdtemp("/tmp/orbit-cli-"));
  const calls = [];
  try {
    await expect(
      runLocal(["setup"], { ORBIT_LOCAL_DATA_DIR: `${tmp}/data` }, async (args) => {
        calls.push(args);
        return {
          stdout: JSON.stringify([
            { results: [{ id: "local-owner", email: "wrong@orbit.local" }] },
          ]),
        };
      }),
    ).rejects.toThrow(/衝突/);
    expect(calls).toHaveLength(2);
    await expect(
      runLocal(["setup"], { ORBIT_LOCAL_DATA_DIR: `${tmp}/data` }, async () => {
        throw new Error("migration failed");
      }),
    ).rejects.toThrow("migration failed");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

it("[同値分割] 破損backup・重複パス・不正引数で元データを維持する", async () => {
  const { runLocal } = await import("./local.mjs");
  const { mkdtemp, rm, realpath, mkdir, writeFile, readFile } = await import("node:fs/promises");
  const tmp = await realpath(await mkdtemp("/tmp/orbit-cli-"));
  const env = { ...process.env, ORBIT_LOCAL_DATA_DIR: `${tmp}/data` };
  try {
    await mkdir(`${tmp}/data`);
    await writeFile(`${tmp}/data/initialized.json`, '{"format":1}');
    await writeFile(`${tmp}/data/value`, "original");
    await expect(runLocal(["backup", `${tmp}/data/nested`], env)).rejects.toThrow(/重複/);
    await expect(runLocal(["setup", "--remote"], env)).rejects.toThrow(/引数/);
    await runLocal(["backup", `${tmp}/backup`], env);
    await writeFile(`${tmp}/backup/state/value`, "tampered");
    await expect(runLocal(["restore", `${tmp}/backup`, `${tmp}/restored`], env)).rejects.toThrow(
      /破損/,
    );
    expect(await readFile(`${tmp}/data/value`, "utf8")).toBe("original");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

it("[状態遷移/禁止] symlink別名でも同じ保存先の排他を回避できない", async () => {
  const { runLocal, withLock } = await import("./local.mjs");
  const { mkdtemp, rm, realpath, mkdir, symlink } = await import("node:fs/promises");
  const tmp = await realpath(await mkdtemp("/tmp/orbit-cli-"));
  try {
    await mkdir(`${tmp}/data`);
    await symlink(`${tmp}/data`, `${tmp}/alias`);
    await withLock(`${tmp}/data`, async () => {
      await expect(runLocal(["setup"], { ORBIT_LOCAL_DATA_DIR: `${tmp}/alias` })).rejects.toThrow(
        /使用中/,
      );
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

it("[境界値/禁止] コピー先がコピー元のlock配下なら作成前に拒否する", async () => {
  const { runLocal } = await import("./local.mjs");
  const { mkdtemp, rm, realpath, mkdir, writeFile, access } = await import("node:fs/promises");
  const tmp = await realpath(await mkdtemp("/tmp/orbit-lock-overlap-"));
  const env = { ...process.env, ORBIT_LOCAL_DATA_DIR: `${tmp}/data` };
  try {
    await mkdir(`${tmp}/data`);
    await writeFile(`${tmp}/data/initialized.json`, '{"format":1}');
    await expect(runLocal(["backup", `${tmp}/data.lock/backup`], env)).rejects.toThrow(/重複/);
    await expect(access(`${tmp}/data.lock`)).rejects.toThrow();
    await runLocal(["backup", `${tmp}/backup`], env);
    await expect(
      runLocal(["restore", `${tmp}/backup`, `${tmp}/backup.lock/restored`], env),
    ).rejects.toThrow(/重複/);
    await expect(access(`${tmp}/backup.lock`)).rejects.toThrow();
    await mkdir(`${tmp}/reverse.lock/source`, { recursive: true });
    await writeFile(`${tmp}/reverse.lock/source/initialized.json`, '{"format":1}');
    await expect(
      runLocal(["backup", `${tmp}/reverse`], {
        ...env,
        ORBIT_LOCAL_DATA_DIR: `${tmp}/reverse.lock/source`,
      }),
    ).rejects.toThrow(/重複/);
    await expect(access(`${tmp}/reverse.lock/source/initialized.json`)).resolves.toBeUndefined();
    await expect(runLocal(["restore", `${tmp}/backup`, `${tmp}/backup.lock`], env)).rejects.toThrow(
      /重複/,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// 版情報取得の子プロセス起動を3回伴うため、上のbackup/restoreテストと同じ理由で待ち時間を明示する。
it("[故障注入] コピー途中で失敗したbackup/restoreは部分成果を残さず元データを維持する", async () => {
  const { runLocal } = await import("./local.mjs");
  const { mkdtemp, rm, realpath, mkdir, writeFile, readFile, readdir, access } =
    await import("node:fs/promises");
  const tmp = await realpath(await mkdtemp("/tmp/orbit-copy-failure-"));
  const env = { ...process.env, ORBIT_LOCAL_DATA_DIR: `${tmp}/data` };
  try {
    await mkdir(`${tmp}/data`);
    await writeFile(`${tmp}/data/initialized.json`, '{"format":1}');
    await writeFile(`${tmp}/data/value`, "original");
    const failCopy = async (_source, target) => {
      await mkdir(target, { recursive: true });
      await writeFile(`${target}/partial`, "incomplete");
      throw Object.assign(new Error("copy failed"), { code: "EIO" });
    };
    await expect(
      runLocal(["backup", `${tmp}/broken`], env, undefined, { copy: failCopy }),
    ).rejects.toThrow("copy failed");
    await expect(access(`${tmp}/broken`)).rejects.toThrow();
    await runLocal(["backup", `${tmp}/backup`], env);
    await expect(
      runLocal(["restore", `${tmp}/backup`, `${tmp}/restored`], env, undefined, { copy: failCopy }),
    ).rejects.toThrow("copy failed");
    expect(await readdir(`${tmp}/restored`)).toEqual([]);
    expect(await readFile(`${tmp}/data/value`, "utf8")).toBe("original");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}, 20_000);

it("[故障注入] port使用中では起動を再試行せず失敗し、保存状態と排他解放を維持する", async () => {
  const { runLocal } = await import("./local.mjs");
  const { mkdtemp, rm, realpath, mkdir, writeFile, readFile, access } =
    await import("node:fs/promises");
  const tmp = await realpath(await mkdtemp("/tmp/orbit-port-busy-"));
  const calls = [];
  try {
    await mkdir(`${tmp}/data`);
    await writeFile(`${tmp}/data/initialized.json`, '{"format":1}');
    await writeFile(`${tmp}/data/value`, "original");
    await expect(
      runLocal(["start"], { ORBIT_LOCAL_DATA_DIR: `${tmp}/data` }, async (args, _env, tool) => {
        if (tool === "vite") {
          calls.push(args);
          throw Object.assign(new Error("port 3000 busy"), { code: "EADDRINUSE" });
        }
        return {
          stdout: JSON.stringify([
            { results: [{ id: "local-owner", email: "local-owner@orbit.local" }] },
          ]),
        };
      }),
    ).rejects.toThrow("port 3000 busy");
    expect(calls).toEqual([["dev", "--host", "127.0.0.1", "--port", "3000", "--strictPort"]]);
    expect(await readFile(`${tmp}/data/value`, "utf8")).toBe("original");
    await expect(access(`${tmp}/data.lock`)).rejects.toThrow();
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

it("[同値分割] 書込不可の保存先ではsetupが失敗し既存ファイルを保持する", async () => {
  const { runLocal } = await import("./local.mjs");
  const { mkdtemp, rm, realpath, mkdir, writeFile, readFile, chmod } =
    await import("node:fs/promises");
  const tmp = await realpath(await mkdtemp("/tmp/orbit-permission-"));
  try {
    await mkdir(`${tmp}/data`);
    await writeFile(`${tmp}/data/value`, "original");
    await chmod(`${tmp}/data`, 0o500);
    await expect(
      runLocal(["setup"], { ORBIT_LOCAL_DATA_DIR: `${tmp}/data` }, async () => ({
        stdout: JSON.stringify([
          { results: [{ id: "local-owner", email: "local-owner@orbit.local" }] },
        ]),
      })),
    ).rejects.toMatchObject({ code: "EACCES" });
    expect(await readFile(`${tmp}/data/value`, "utf8")).toBe("original");
  } finally {
    await chmod(`${tmp}/data`, 0o700);
    await rm(tmp, { recursive: true, force: true });
  }
});
