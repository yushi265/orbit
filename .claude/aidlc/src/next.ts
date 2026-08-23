// AI-DLC 決定論エンジン: next() — state から「次の 1 手」を算出する純粋関数
// 助言モード。同じ state なら常に同じ Directive を返す（副作用なし）。
// 正本: .claude/skills/ai-dlc-flow/SKILL.md（Stage） / .claude/rules/risk-tiers.md（Tier・Gate）

import type {
  Directive,
  GateId,
  GateMode,
  StageGraph,
  StageNode,
  TierGateMap,
  WorkflowState,
} from "./types";

/** その Stage を実行しない（飛ばす）か。明示 skip か、planKey が false の条件付き Stage */
function isSkipped(stage: StageNode, state: WorkflowState): boolean {
  if (state.stageStatus[stage.id] === "skipped") return true;
  if (stage.planKey && !state[stage.planKey]) return true;
  return false;
}

/** そのゲートが人間承認で停止する（ブロッキング）か。declare-only / n/a は停止しない */
function gateBlocks(mode: GateMode): boolean {
  return mode === "blocking" || mode === "conditional";
}

/**
 * 現在の state から次に取るべき 1 手を決定論的に返す。
 * Stage を宣言順に走査し、最初の「未完了の実行対象 Stage」または
 * 「完了済みだが未承認のブロッキングゲート」を返す。全て解決済みなら done。
 */
export function next(state: WorkflowState, graph: StageGraph, tierMap: TierGateMap): Directive {
  const policy = tierMap.tiers[String(state.tier)];
  if (!policy) return { kind: "error", message: `unknown tier: ${state.tier}` };

  for (const stage of graph.stages) {
    if (isSkipped(stage, state)) continue;

    const status = state.stageStatus[stage.id] ?? "pending";
    if (status !== "done") {
      // この Stage がまだ完了していない → これが次に実行する Stage
      return { kind: "run-stage", stage: stage.id, name: stage.name, skill: stage.skill };
    }

    // status === "done": この Stage に紐づくゲートを点検
    if (stage.gate) {
      const gate: GateId = stage.gate;
      const mode = policy[gate];
      // gate2 のみ、Gate 1 での人間の明示委任（gate2Delegated）で declare-only 相当へ降格する
      // （Tier 3 の Gate 1 と同型 = 停止せず素通り。gate1/gate3 は降格対象外）
      const effectiveMode: GateMode =
        gate === "gate2" && state.gate2Delegated ? "declare-only" : mode;
      const approved = state.gateStatus[gate] === "approved";
      if (!approved && gateBlocks(effectiveMode)) {
        return { kind: "gate", gate, mode: effectiveMode, stage: stage.id, name: stage.name };
      }
    }
  }

  return { kind: "done" };
}
