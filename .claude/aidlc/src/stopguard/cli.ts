// Stop guard CLI（観測のみ）
// state/*.md 全件を収集 → decideStop（純粋関数）→ decision を stdout + log.jsonl へ記録する。
// Phase A では shell（.claude/hooks/aidlc-stop-guard.sh）が stdout を捨てる（= block しない）。
// Phase B 昇格時は shell が stdout（Claude Code Stop hook の decision JSON）をそのまま返すだけ。
//
// 全経路 fail-open: state 破損・fs 例外など何が起きても `{}`（allow 相当）を出して exit 0。
// ターン終了を邪魔する事故を構造的に防ぐ（fail-open の安全設計）。

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decideStop,
  hasOpenAnswerTag,
  EMPTY_MEMORY,
  type BoltSnapshot,
  type StopGuardMemory,
} from "./decide";
import { parseStateFile } from "../state/state";
import type { StageGraph, TierGateMap } from "../types";

const aidlcRoot = fileURLToPath(new URL("../..", import.meta.url)); // .claude/aidlc
const repoRoot = join(aidlcRoot, "..", "..");
const stateDir = join(aidlcRoot, "state");
const guardDir = join(stateDir, ".stop-guard");
const memoryPath = join(guardDir, "memory.json");
const logPath = join(guardDir, "log.jsonl");

// docs/spec/<TICKET>-* 配下の questions.md に空 [Answer]: が残っているか（見つからなければ false）
function openQuestionsFor(ticket: string): boolean {
  try {
    const specRoot = join(repoRoot, "docs", "spec");
    for (const dir of readdirSync(specRoot)) {
      if (!dir.startsWith(`${ticket}-`) && dir !== ticket) continue;
      const q = join(specRoot, dir, "questions.md");
      if (existsSync(q) && hasOpenAnswerTag(readFileSync(q, "utf8"))) return true;
    }
  } catch {
    // spec ディレクトリが無い等は「開いている質問なし」扱い
  }
  return false;
}

function collectBolts(): BoltSnapshot[] {
  if (!existsSync(stateDir)) return [];
  const bolts: BoltSnapshot[] = [];
  for (const entry of readdirSync(stateDir)) {
    if (!entry.endsWith(".md")) continue;
    try {
      const doc = parseStateFile(readFileSync(join(stateDir, entry), "utf8"));
      bolts.push({
        ticket: doc.ticket,
        state: doc.state,
        auditLines: doc.audit.length,
        hasOpenQuestions: openQuestionsFor(doc.ticket),
      });
    } catch {
      // 壊れた state は判定対象から外す（fail-open。doctor が可視化を担う）
    }
  }
  return bolts;
}

function loadMemory(): StopGuardMemory {
  try {
    return { ...EMPTY_MEMORY, ...JSON.parse(readFileSync(memoryPath, "utf8")) };
  } catch {
    return EMPTY_MEMORY;
  }
}

try {
  const graph: StageGraph = JSON.parse(readFileSync(join(aidlcRoot, "stage-graph.json"), "utf8"));
  const tierMap: TierGateMap = JSON.parse(readFileSync(join(aidlcRoot, "tier-gate-map.json"), "utf8"));
  const cap = Number(process.env.AIDLC_STOP_GUARD_CAP ?? "") || 2;

  const decision = decideStop(collectBolts(), loadMemory(), cap, graph, tierMap);

  mkdirSync(guardDir, { recursive: true });
  writeFileSync(memoryPath, JSON.stringify(decision.memory) + "\n");
  appendFileSync(
    logPath,
    JSON.stringify({
      ts: new Date().toISOString(),
      decision: decision.decision,
      reason: decision.reason,
      blockCount: decision.memory.blockCount,
    }) + "\n",
  );

  // Claude Code Stop hook の decision JSON（Phase B で shell がそのまま返す形式）
  process.stdout.write(
    decision.decision === "block"
      ? JSON.stringify({ decision: "block", reason: decision.reason }) + "\n"
      : "{}\n",
  );
} catch {
  process.stdout.write("{}\n"); // fail-open
}
