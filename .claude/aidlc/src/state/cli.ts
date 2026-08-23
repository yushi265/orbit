// AI-DLC 決定論エンジン: report CLI（advisory）
// 機械可読 state ファイルを read → 1 手の結果（event）を適用 → state 遷移 + audit 追記 → write。
// 更新後に next() の「次の 1 手」を助言として表示し、next→実行→report のループを閉じる。
//
// 使い方:
//   # 新規作成（state ファイルを初期化）
//   pnpm -C .claude/aidlc report <state-file> init tier=2 spec=true
//   # 1 手の結果を報告（state 遷移 + audit 追記）
//   pnpm -C .claude/aidlc report <state-file> stage-done 0+1
//   pnpm -C .claude/aidlc report <state-file> gate-approve gate1
//
// Phase B は advisory（非強制）。progress.md と並走し、Gate を強制しない（hard stop は lefthook/CI/人間）。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename, extname } from "node:path";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { next } from "../next";
import {
  formatGate3Checklist,
  matchGlob,
  verifyStage,
  type GuardEvidence,
} from "../guard/artifacts";
import { parseLedger, extractSpecAcs } from "../ledger/parse";
import { verifyLedger, formatLedgerReport } from "../ledger/verify";
import {
  applyReportToDocument,
  initialDocument,
  parseReportEvent,
  parseInitArgs,
  parseStateFile,
  serializeStateFile,
  auditLine,
  type StateDocument,
} from "./state";
import { formatSummary, summarizeAudit } from "./summary";
import { resolveScope, scopeToInitialState, type ScopesData } from "../scopes/resolve";
import type { Directive, StageGraph, TierGateMap } from "../types";

const graph: StageGraph = JSON.parse(
  readFileSync(new URL("../../stage-graph.json", import.meta.url), "utf8"),
);
const tierMap: TierGateMap = JSON.parse(
  readFileSync(new URL("../../tier-gate-map.json", import.meta.url), "utf8"),
);

function fail(message: string): never {
  process.stderr.write(`⚠ ${message}\n`);
  process.exit(1);
}

function adviseNext(d: Directive): string {
  switch (d.kind) {
    case "run-stage":
      return `▶ 次に実行: Stage ${d.stage}「${d.name}」${d.skill ? `（スキル: ${d.skill}）` : ""}`;
    case "gate":
      return `⏸ 人間ゲート: ${d.gate}（${d.mode}）— Stage ${d.stage}「${d.name}」の承認待ち`;
    case "done":
      return "✓ 全 Stage 解決済み（完了）";
    case "error":
      return `⚠ エラー: ${d.message}`;
  }
}

const statePath = process.argv[2];
const tokens = process.argv.slice(3);
if (!statePath || tokens.length === 0) {
  fail("使い方: report <state-file> <init tier=N spec=B | stage-done <id> | gate-approve <gate> | gate-delegate gate2 | gate-undelegate gate2 | ...>");
}

// ISO8601（秒精度・UTC）。audit のタイムスタンプは CLI 側で打つ（純粋関数はテスト容易性のため時刻を持たない）。
const now = new Date().toISOString();

function loadDoc(): StateDocument {
  if (!existsSync(statePath)) fail(`state ファイルが無い: ${statePath}（先に 'init' で作成）`);
  return parseStateFile(readFileSync(statePath, "utf8"));
}

function writeDoc(doc: StateDocument): void {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, serializeStateFile(doc));
}

let doc: StateDocument;
let skipped = false;

let scopeName: string | null = null;

// summary（照会）: audit を機械集計して表を出す。state は変更しない。
if (tokens[0] === "summary") {
  const d = loadDoc();
  process.stdout.write(formatSummary(d.ticket, summarizeAudit(d.audit)) + "\n");
  process.exit(0);
}

if (tokens[0] === "init") {
  // init には 2 形態:
  //   1) scope=<name>     → scopes.json の scope プロファイルから tier/spec を seed
  //   2) tier=N spec=B    → 明示指定（欠落・不正値は fail fast）
  const scopeTok = tokens.slice(1).find((t) => t.startsWith("scope="));
  let tier, specPlanned;
  if (scopeTok) {
    scopeName = scopeTok.slice("scope=".length);
    const scopesData: ScopesData = JSON.parse(
      readFileSync(new URL("../../scopes.json", import.meta.url), "utf8"),
    );
    let seed;
    try {
      seed = scopeToInitialState(resolveScope(scopeName, scopesData));
    } catch (e) {
      fail((e as Error).message);
    }
    ({ tier, specPlanned } = seed);
  } else {
    let init;
    try {
      init = parseInitArgs(tokens.slice(1));
    } catch (e) {
      fail((e as Error).message);
    }
    ({ tier, specPlanned } = init);
  }
  const ticket = basename(statePath, extname(statePath));
  doc = initialDocument(ticket, { tier, specPlanned });
  // 初期宣言を audit に残す（TIER_DECLARED / PLAN_DECLARED）
  doc = {
    ...doc,
    audit: [
      auditLine({ type: "tier-declared", tier }, now),
      auditLine({ type: "plan-declared", specPlanned }, now),
    ],
  };
} else {
  let event;
  try {
    event = parseReportEvent(tokens);
  } catch (e) {
    fail((e as Error).message);
  }
  const result = applyReportToDocument(loadDoc(), event, now);
  doc = result.doc;
  skipped = result.skipped;
}

writeDoc(doc);

// --- artifact guard（advisory）--------------------------------
// stage-done: 当該 stage の produces 不足を警告（遷移は拒否しない）。
// stage-done 8 / gate-approve gate3: 全 stage の証跡チェックリストを提示（Gate 3 審査材料）。
// evidence 収集（fs/git）はここに隔離。git が使えない環境・バイパス時は無音スキップ（fail-open）。
function collectEvidence(): (GuardEvidence & { root: string }) | null {
  if (process.env.AIDLC_SKIP_ARTIFACT_GUARD === "1") return null;
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    const opts = { encoding: "utf8" as const, cwd: root, maxBuffer: 32 * 1024 * 1024 };
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], opts)
      .split("\n")
      .filter(Boolean);
    const diffNumstat = execFileSync("git", ["diff", "--numstat", "HEAD"], opts).trim();
    return { files, diffNumstat, root };
  } catch {
    return null;
  }
}

function artifactGuardNotes(): string {
  const isStageDone = tokens[0] === "stage-done";
  const isGate3 = tokens[0] === "gate-approve" && tokens[1] === "gate3";
  if (!isStageDone && !isGate3) return "";
  const ev = collectEvidence();
  if (!ev) return "";
  const ctx = { ticket: doc.ticket, state: doc.state, evidence: ev };
  const notes: string[] = [];
  if (isStageDone) {
    const stage = graph.stages.find((s) => s.id === tokens[1]);
    const findings = stage ? verifyStage(stage, ctx) : [];
    if (findings.length > 0) {
      notes.push(
        `[artifact guard] Stage ${tokens[1]} の証跡不足（advisory・遷移は記録済み）:`,
        ...findings.map((f) => `  - ✗ ${f.detail}`),
        "  証跡を作ってから再報告を推奨（ハーネス自体のテスト時のみ AIDLC_SKIP_ARTIFACT_GUARD=1）",
      );
    }
  }
  if (isGate3 || (isStageDone && tokens[1] === "8")) {
    notes.push(formatGate3Checklist(graph, ctx));
    // task ledger 検査（advisory）: progress.md の台帳（残タスク・AC カバレッジ・依存違反）を Gate 3 材料に添付
    const progressPath = ev.files.find((f) => matchGlob(`docs/spec/${doc.ticket}-*/progress.md`, f));
    if (progressPath) {
      try {
        const tasks = parseLedger(readFileSync(join(ev.root, progressPath), "utf8"));
        const indexPath = ev.files.find((f) => matchGlob(`docs/spec/${doc.ticket}-*/index.md`, f));
        const specAcs = indexPath ? extractSpecAcs(readFileSync(join(ev.root, indexPath), "utf8")) : null;
        notes.push(formatLedgerReport(verifyLedger(tasks, specAcs)));
      } catch {
        // advisory: progress.md が読めなければ黙ってスキップ
      }
    }
  }
  return notes.length > 0 ? notes.join("\n") + "\n" : "";
}

const directive = next(doc.state, graph, tierMap);
process.stdout.write(JSON.stringify(doc.state) + "\n"); // 機械可読（更新後 state）
const seededFrom = scopeName
  ? ` (scope: ${scopeName} → tier=${doc.state.tier} spec=${doc.state.specPlanned})`
  : "";
process.stderr.write(
  `[aidlc-engine report]${skipped ? " (冪等: 重複につき追記スキップ)" : ""}${seededFrom} ${statePath}\n` +
    artifactGuardNotes() +
    `[aidlc-engine 助言] ${adviseNext(directive)}\n`,
);
