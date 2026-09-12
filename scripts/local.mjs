import { resolve, isAbsolute, dirname, basename } from "node:path";
import { mkdir, realpath, rm, writeFile, readdir, readFile, cp, lstat } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { buildBootstrapSql } from "./bootstrap-owner.mjs";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { networkInterfaces } from "node:os";
import { isIPv4 } from "node:net";

export const ROOT = resolve(import.meta.dirname, "..");
export function lanAddresses(interfaces = networkInterfaces()) {
  return [
    ...new Set(
      Object.values(interfaces)
        .flatMap((entries) => entries ?? [])
        .filter(({ address, family, internal }) => {
          if (internal || family !== "IPv4" || !isIPv4(address)) return false;
          const [first, second] = address.split(".").map(Number);
          return (
            first === 10 ||
            (first === 172 && second >= 16 && second <= 31) ||
            (first === 192 && second === 168)
          );
        })
        .map(({ address }) => address),
    ),
  ];
}
export function resolveDataDir(environment = process.env) {
  const value = environment.ORBIT_LOCAL_DATA_DIR;
  if (value !== undefined && (!value || !isAbsolute(value)))
    throw new Error("保存先は絶対パスで指定してください。");
  return resolve(value ?? resolve(ROOT, ".orbit/local"));
}

export function localEnvironment(environment, dataDir) {
  const result = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM"]) {
    if (environment[key] !== undefined) result[key] = environment[key];
  }
  return {
    ...result,
    APP_ENV: "local",
    ORBIT_STORAGE: "d1",
    ORBIT_LOCAL_MODE: "1",
    ORBIT_LOCAL_ORIGINS: JSON.stringify(["http://127.0.0.1:3000"]),
    ORBIT_LOCAL_DATA_DIR: dataDir,
    XDG_CONFIG_HOME: `${dataDir}.config`,
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_HIDE_BANNER: "true",
    WRANGLER_LOG_PATH: resolve(dataDir, "../tool-logs"),
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
    CLOUDFLARE_VITE_FORCE_LOCAL: "true",
    CI: "true",
    BROWSER: "none",
    NODE_OPTIONS: `--import=${pathToFileURL(resolve(ROOT, "scripts/local-network.mjs")).href}`,
  };
}

export function wranglerArgs(dataDir, args) {
  return [
    ...args,
    "--local",
    "--config",
    resolve(ROOT, "wrangler.local.jsonc"),
    "--persist-to",
    dataDir,
  ];
}

// Resolve aliases before locking so symlinked paths cannot bypass exclusion.
export async function canonicalPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return resolve(await canonicalPath(dirname(path)), basename(path));
  }
}
export async function withLock(path, action) {
  const lock = `${path}.lock`;
  await mkdir(dirname(lock), { recursive: true });
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error("保存先は使用中です。全プロセスを停止してください。");
    throw error;
  }
  try {
    await writeFile(
      resolve(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    return await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export function executeTool(args, env, tool = "wrangler") {
  const cli =
    tool === "vite" ? "node_modules/vite/bin/vite.js" : "node_modules/wrangler/bin/wrangler.js";
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [resolve(ROOT, cli), ...args], {
      cwd: ROOT,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let timer;
    let stopping = false;
    const kill = (signal) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const stop = () => {
      stopping = true;
      kill("SIGTERM");
      timer ??= setTimeout(() => kill("SIGKILL"), 5000);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    child.stdout.on("data", (data) => {
      if (tool === "vite") process.stdout.write(data);
      else stdout += data;
    });
    child.stderr.on("data", (data) => {
      if (tool === "vite") process.stderr.write(data);
    });
    const cleanup = () => {
      clearTimeout(timer);
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      kill("SIGTERM");
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code, signal) => {
      cleanup();
      if (
        code === 0 ||
        (tool === "vite" &&
          stopping &&
          (code === 143 || code === 130 || signal === "SIGTERM" || signal === "SIGINT"))
      )
        accept({ stdout });
      else reject(new Error(`${tool}工程が失敗しました（終了コード ${code}）。`));
    });
  });
}

async function rejectImplicitConfig() {
  const entries = await readdir(ROOT);
  if (entries.some((name) => name === ".dev.vars" || name.startsWith(".dev.vars.")))
    throw new Error("local起動では.dev.varsを読み込めません。ファイルを退避してください。");
}
async function checkOwner(execute, env, dataDir, required) {
  const { stdout } = await execute(
    wranglerArgs(dataDir, [
      "d1",
      "execute",
      "orbit-local",
      "--json",
      "--command",
      "SELECT id, email FROM users WHERE id = 'local-owner';",
    ]),
    env,
  );
  const rows = JSON.parse(stdout).flatMap((result) => result.results ?? []);
  if (
    (required && rows.length !== 1) ||
    rows.some((row) => row.email !== "local-owner@orbit.local")
  )
    throw new Error("固定Ownerが未初期化または衝突しています。");
}
export async function runLocal(
  argv,
  environment = process.env,
  execute = executeTool,
  { copy = cp, interfaces = networkInterfaces, log = console.log } = {},
) {
  const [command, ...args] = argv;
  if (args[0] === "--") args.shift();
  const lan = command === "start" && args.length === 1 && args[0] === "--lan";
  if (
    !Object.hasOwn({ setup: 0, start: 0, backup: 1, restore: 2 }, command) ||
    (!lan && args.length !== { setup: 0, start: 0, backup: 1, restore: 2 }[command])
  )
    throw new Error("コマンド引数が不正です。");
  const addresses = lan ? lanAddresses(interfaces()) : [];
  if (lan && addresses.length === 0)
    throw new Error("LAN用のRFC1918 IPv4アドレスが見つかりません。");
  const dataDir = await canonicalPath(resolveDataDir(environment));
  const env = localEnvironment(environment, dataDir);
  const origins = [
    "http://127.0.0.1:3000",
    ...addresses.map((address) => `http://${address}:3000`),
  ];
  env.ORBIT_LOCAL_ORIGINS = JSON.stringify(origins);
  if (command === "restore") {
    const source = await canonicalPath(resolve(args[0]));
    const target = await canonicalPath(resolve(args[1]));
    ensureSeparate(source, target);
    return withLock(source, () => withLock(target, () => restoreBackup(source, target, copy)));
  }
  if (command === "backup") {
    const target = await canonicalPath(resolve(args[0]));
    ensureSeparate(dataDir, target);
    return withLock(dataDir, () => withLock(target, () => createBackup(dataDir, target, copy)));
  }
  await rejectImplicitConfig();
  return withLock(dataDir, async () => {
    if (command === "start") {
      await requireInitialized(dataDir);
      await checkOwner(execute, env, dataDir, true);
      if (lan) for (const origin of origins) log(`接続URL: ${origin}`);
      return execute(
        ["dev", "--host", lan ? "0.0.0.0" : "127.0.0.1", "--port", "3000", "--strictPort"],
        env,
        "vite",
      );
    }
    await mkdir(dataDir, { recursive: true });
    await execute(wranglerArgs(dataDir, ["d1", "migrations", "apply", "orbit-local"]), env);
    await checkOwner(execute, env, dataDir, false);
    await execute(
      wranglerArgs(dataDir, [
        "d1",
        "execute",
        "orbit-local",
        "--command",
        buildBootstrapSql({
          userId: "local-owner",
          email: "local-owner@orbit.local",
          name: "Orbit User",
          now: Date.now(),
        }),
      ]),
      env,
    );
    await checkOwner(execute, env, dataDir, true);
    await writeFile(resolve(dataDir, "initialized.json"), JSON.stringify({ format: 1 }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocal(process.argv.slice(2))
    .then(() => console.log("ローカル操作が完了しました。"))
    .catch((error) => {
      console.error(`local:${process.argv[2] ?? "command"}: ${error.message}`);
      process.exitCode = 1;
    });
}

export function localViteOptions(environment = process.env) {
  if (environment.ORBIT_LOCAL_MODE !== "1") return undefined;
  if (environment.CLOUDFLARE_ENV) throw new Error("localとCloudflare環境選択を併用できません。");
  return {
    server: { host: "127.0.0.1", port: 3000, strictPort: true, allowedHosts: ["127.0.0.1"] },
    urlPlugin: {
      name: "orbit-local-urls",
      configureServer(server) {
        const printUrls = server.printUrls.bind(server);
        server.printUrls = () => {
          if (server.resolvedUrls) {
            // The CLI supplies this list; invalid settings are rejected by the Worker.
            let origins = [];
            try {
              const value = JSON.parse(
                environment.ORBIT_LOCAL_ORIGINS ?? '["http://127.0.0.1:3000"]',
              );
              if (Array.isArray(value) && value.every((origin) => typeof origin === "string"))
                origins = value;
            } catch {
              /* Do not advertise URLs for malformed settings. */
            }
            server.resolvedUrls = {
              local: origins
                .filter((origin) => origin === "http://127.0.0.1:3000")
                .map((origin) => `${origin}/`),
              network: origins
                .filter((origin) => origin !== "http://127.0.0.1:3000")
                .map((origin) => `${origin}/`),
            };
          }
          printUrls();
        };
      },
    },
    cloudflare: {
      configPath: resolve(ROOT, "wrangler.local.jsonc"),
      config: (config) => ({
        vars: {
          ...config.vars,
          ORBIT_LOCAL_ORIGINS:
            environment.ORBIT_LOCAL_ORIGINS ?? JSON.stringify(["http://127.0.0.1:3000"]),
        },
      }),
      persistState: { path: resolveDataDir(environment) },
      inspectorPort: false,
      remoteBindings: false,
      tunnel: false,
    },
  };
}

const execAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function ensureSeparate(source, target) {
  for (const sourceArea of [source, `${source}.lock`]) {
    for (const targetArea of [target, `${target}.lock`]) {
      if (
        sourceArea === targetArea ||
        sourceArea.startsWith(`${targetArea}/`) ||
        targetArea.startsWith(`${sourceArea}/`)
      )
        throw new Error("保存先・コピー先・排他領域が重複しない別ディレクトリにしてください。");
    }
  }
}
async function toolVersions() {
  const git = async (...args) => (await execAsync("git", args, { cwd: ROOT })).stdout.trim();
  return {
    node: process.version,
    pnpm: (await execAsync("pnpm", ["--version"], { cwd: ROOT })).stdout.trim(),
    wrangler: require("wrangler/package.json").version,
    plugin: JSON.parse(
      await readFile(resolve(ROOT, "node_modules/@cloudflare/vite-plugin/package.json"), "utf8"),
    ).version,
    gitRevision: await git("rev-parse", "HEAD"),
    dirty: Boolean(await git("status", "--porcelain")),
    lockfileSha256: sha256(await readFile(resolve(ROOT, "pnpm-lock.yaml"))),
  };
}
async function stateHash(directory) {
  const hash = createHash("sha256");
  const walk = async (path, prefix = "") => {
    for (const name of (await readdir(path)).sort()) {
      const file = resolve(path, name);
      const info = await lstat(file);
      if (info.isSymbolicLink())
        throw new Error("状態ディレクトリ内のシンボリックリンクは扱えません。");
      if (info.isDirectory()) await walk(file, `${prefix}${name}/`);
      else {
        hash.update(`${prefix}${name}\0`);
        hash.update(await readFile(file));
        hash.update("\0");
      }
    }
  };
  await walk(directory);
  return hash.digest("hex");
}
async function requireInitialized(dataDir) {
  try {
    if (JSON.parse(await readFile(resolve(dataDir, "initialized.json"), "utf8")).format !== 1)
      throw new Error();
  } catch {
    throw new Error("保存先が未初期化です。local:setupを実行してください。");
  }
}
async function createBackup(source, target, copy) {
  await requireInitialized(source);
  const stateSha256 = await stateHash(source);
  const manifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    ...(await toolVersions()),
    stateSha256,
  };
  try {
    await mkdir(target);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("バックアップ先が既に存在します。");
    throw error;
  }
  try {
    await copy(source, resolve(target, "state"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    if ((await stateHash(resolve(target, "state"))) !== stateSha256)
      throw new Error("バックアップの内容が一致しません。");
    await writeFile(resolve(target, "manifest.json"), JSON.stringify(manifest, null, 2));
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}
async function restoreBackup(source, target, copy) {
  const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));
  if (manifest.format !== 1 || (await stateHash(resolve(source, "state"))) !== manifest.stateSha256)
    throw new Error("バックアップが不正または破損しています。");
  const versions = await toolVersions();
  for (const key of ["node", "pnpm", "wrangler", "plugin", "gitRevision", "lockfileSha256"]) {
    if (manifest[key] !== versions[key])
      throw new Error("バックアップとコード・ツール版を揃えてください。");
  }
  await mkdir(target, { recursive: true });
  if ((await readdir(target)).length) throw new Error("復元先は空のディレクトリにしてください。");
  try {
    for (const name of await readdir(resolve(source, "state")))
      await copy(resolve(source, "state", name), resolve(target, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    if ((await stateHash(target)) !== manifest.stateSha256)
      throw new Error("復元内容が一致しません。");
  } catch (error) {
    for (const name of await readdir(target))
      await rm(resolve(target, name), { recursive: true, force: true });
    throw error;
  }
}
