// AI-DLC 決定論エンジン 助言 CLI
// 使い方: pnpm -C .claude/aidlc next <state.json|state.md>   または  cat state | pnpm -C .claude/aidlc next
// state を読み、next() が算出した「次の 1 手」を JSON(stdout) と人間向け助言(stderr) で出す。
// 入力は純 JSON（Phase A）と report 生成の markdown ラッパー state.md（Phase B）の両形式を受ける。
// Phase A は助言のみ（非強制）。既存 ai-dlc-flow と並走し、AI の現在判断との一致/乖離の確認に使う。

import { readFileSync } from "node:fs";
import { next } from "./next";
import { resolveStateInput } from "./resolve-state-input";
import type { Directive, StageGraph, TierGateMap, WorkflowState } from "./types";

const graph: StageGraph = JSON.parse(
  readFileSync(new URL("../stage-graph.json", import.meta.url), "utf8"),
);
const tierMap: TierGateMap = JSON.parse(
  readFileSync(new URL("../tier-gate-map.json", import.meta.url), "utf8"),
);

function readState(): WorkflowState {
  const arg = process.argv[2];
  const raw = arg && arg !== "-" ? readFileSync(arg, "utf8") : readFileSync(0, "utf8");
  return resolveStateInput(raw);
}

function advise(d: Directive): string {
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

function main(): void {
  let state: WorkflowState;
  try {
    state = readState();
  } catch (e) {
    // fail-fast: 生スタックトレースを出さず原因を 1 行で返す（scope/report CLI と同じ作法）。
    process.stderr.write(`[aidlc-engine] 入力エラー: ${(e as Error).message}\n`);
    process.exit(1);
  }
  const directive = next(state, graph, tierMap);
  process.stdout.write(JSON.stringify(directive) + "\n"); // 機械可読
  process.stderr.write(`[aidlc-engine 助言] ${advise(directive)}\n`); // 人間向け（非強制）
}

main();
