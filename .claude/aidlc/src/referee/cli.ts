// referee-check CLI
// 使い方: pnpm -C .claude/aidlc referee-check [--layer <layer>|all] [--state <state-file>]
//   既定は --layer all。--state を渡すと判定を engine audit へ note 追記する（NOTE REFEREE_GREEN|RED <layer>。
//   冪等性は applyReportToDocument の既存重複スキップが担保・新 event 型は増やさない = YAGNI）。
// exit code: GREEN=0 / unavailable=0（環境差は誤赤にしない・advisory）/ RED=1（権威 red）/ 不正な --layer 引数=2。

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
// missingPrecondition: deps 未導入層を spawn 前に unavailable へ（RED 誤判定の防止）
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decideTargets,
  toResult,
  overallVerdict,
  classifyOutcome,
  buildAuditNote,
  missingPrecondition,
  type RefereeConfig,
  type RefereeResult,
} from "./check";
import { applyReportToDocument, parseStateFile, serializeStateFile } from "../state/state";

const aidlcRoot = fileURLToPath(new URL("../..", import.meta.url));
const repoRoot = join(aidlcRoot, "..", "..");

const config: RefereeConfig = JSON.parse(readFileSync(join(aidlcRoot, "referee.config.json"), "utf8"));

const args = process.argv.slice(2);
const layerIdx = args.indexOf("--layer");
const layerArg = layerIdx !== -1 ? (args[layerIdx + 1] ?? "all") : "all";
const stateIdx = args.indexOf("--state");
const statePath = stateIdx !== -1 ? args[stateIdx + 1] : null;

let targets;
try {
  targets = decideTargets(layerArg, config);
} catch (e) {
  process.stderr.write(`⚠ ${(e as Error).message}\n`);
  process.exit(2);
}

const results: RefereeResult[] = [];
for (const t of targets) {
  process.stderr.write(`[referee] ${t.name}: ${t.cmd.command.join(" ")}（cwd: ${t.cmd.cwd}）\n`);
  // deps 未導入層は spawn せず unavailable（npx は ENOENT にならず exit 非 0 で死ぬため RED と誤判定しない）
  if (missingPrecondition(t.cmd, (p) => existsSync(join(repoRoot, p)))) {
    results.push({ name: t.name, verdict: "unavailable", summary: [`前提 ${t.cmd.cwd}/${t.cmd.precondition} が無い（deps 未導入）`] });
    continue;
  }
  const proc = spawnSync(t.cmd.command[0], t.cmd.command.slice(1), {
    cwd: join(repoRoot, t.cmd.cwd),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  results.push(toResult(t.name, classifyOutcome(proc)));
}

const overall = overallVerdict(results);
for (const r of results) {
  process.stderr.write(`[referee] ${r.name}: ${r.verdict}\n`);
  if (r.verdict !== "GREEN") for (const l of r.summary) process.stderr.write(`    > ${l}\n`);
}
process.stderr.write(`[referee] 総合: ${overall}（exit 0 の集合だけが権威 green・自己申告は判定に使わない）\n`);

// --state 指定時: 判定を engine audit へ note 追記（冪等・advisory。書けなければ無音 = fail-open）
if (statePath) {
  try {
    const abs = join(aidlcRoot, statePath);
    const doc = parseStateFile(readFileSync(abs, "utf8"));
    const note = buildAuditNote(layerArg, results, overall);
    const { doc: next } = applyReportToDocument(doc, { type: "note", note }, new Date().toISOString());
    writeFileSync(abs, serializeStateFile(next));
  } catch {
    // advisory: state が読めなければ黙ってスキップ
  }
}

process.exit(overall === "RED" ? 1 : 0);
