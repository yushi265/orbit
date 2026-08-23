// harness doctor CLI（read-only）
// 使い方:
//   pnpm -C .claude/aidlc doctor            … 全検査（drift テスト invoke 含む）
//   pnpm -C .claude/aidlc doctor --fast     … deps / hooks-wiring のみ（fs 存在確認・SessionStart 用）
//   pnpm -C .claude/aidlc doctor --json     … 機械可読出力
//   （--quiet: ok / skip を出さない。bootstrap の「欠落時のみ NOTE」用）
// exit code は常に 0（doctor 自体が CI / フックを壊さない）。観測に失敗した項目は skip/warn。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { runChecks, formatDoctorReport, type DoctorObservations } from "./checks";
import { parseStateFile } from "../state/state";

const aidlcRoot = fileURLToPath(new URL("../..", import.meta.url));
const repoRoot = resolve(aidlcRoot, "..", "..");

const fast = process.argv.includes("--fast");
const json = process.argv.includes("--json");
const quiet = process.argv.includes("--quiet");

function tryExec(cmd: string, args: string[]): { ok: boolean; out: string } | null {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { status?: number; stdout?: string };
    if (err.code === "ENOENT") return null; // コマンド不在
    return { ok: false, out: String(err.stdout ?? "") };
  }
}

function collectHookFiles(): DoctorObservations["hookFiles"] {
  try {
    const settings = readFileSync(join(repoRoot, ".claude", "settings.json"), "utf8");
    const paths = [...new Set([...settings.matchAll(/\.claude\/hooks\/[\w.-]+\.sh/g)].map((m) => m[0]))];
    return paths.map((p) => ({ path: p, exists: existsSync(join(repoRoot, p)) }));
  } catch {
    return null; // settings.json が読めない → 収集失敗（0 件検出と区別し、その検査だけ warn。doctor は落ちない）
  }
}

function collectStates(): DoctorObservations["states"] {
  const stateDir = join(aidlcRoot, "state");
  if (!existsSync(stateDir)) return [];
  const states: DoctorObservations["states"] = [];
  for (const entry of readdirSync(stateDir)) {
    if (!entry.endsWith(".md")) continue;
    try {
      const doc = parseStateFile(readFileSync(join(stateDir, entry), "utf8"));
      const specRoot = join(repoRoot, "docs", "spec");
      const hasSpecDir =
        existsSync(specRoot) &&
        readdirSync(specRoot).some((d) => d.startsWith(`${doc.ticket}-`) || d === doc.ticket);
      states.push({ ticket: doc.ticket, hasSpecDir, parked: doc.state.parked === true });
    } catch {
      // 壊れた state は state-orphan とは別問題（parse 不能）。ここでは skip（fail-open）
    }
  }
  return states;
}

const hooksPathRes = tryExec("git", ["config", "core.hooksPath"]);
const hooksPath = hooksPathRes?.ok ? hooksPathRes.out || null : null;
// mise は .mise.toml が実在するプロジェクトでだけ検査する（使わないプロジェクトで誤って ok/skip を出さない）
const miseConfigExists =
  existsSync(join(repoRoot, ".mise.toml")) || existsSync(join(repoRoot, "mise.toml"));
const miseRes = fast || !miseConfigExists ? null : tryExec("mise", ["exec", "--", "true"]);

let driftPassed: boolean | null = null;
if (!fast) {
  const drift = tryExec("node", [
    "--import",
    "tsx",
    "--test",
    join(aidlcRoot, "src/drift/parse-rules.test.ts"),
    join(aidlcRoot, "src/drift/mirrors.test.ts"),
  ]);
  driftPassed = drift === null ? null : drift.ok;
}

const observations: DoctorObservations = {
  nodeModulesExists: existsSync(join(aidlcRoot, "node_modules")),
  pnpmAvailable: tryExec("pnpm", ["--version"]) !== null,
  hookFiles: collectHookFiles(),
  hooksPath,
  hooksPathInsideRepo: hooksPath === null ? null : resolve(repoRoot, hooksPath).startsWith(repoRoot),
  miseTrusted: miseRes === null ? null : miseRes.ok,
  states: fast ? [] : collectStates(),
  driftPassed,
};

let results = runChecks(observations);
if (fast) results = results.filter((r) => r.id === "deps" || r.id === "hooks-wiring");
if (quiet) results = results.filter((r) => r.status === "fail" || r.status === "warn");

if (json) {
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
} else if (results.length > 0) {
  process.stdout.write(formatDoctorReport(results) + "\n");
}
process.exit(0);
