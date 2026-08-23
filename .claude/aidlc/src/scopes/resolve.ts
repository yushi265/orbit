// scopes: 名前付き scope プロファイル → 実行計画
// 既存の risk-tiers + spec省略条件を「再利用可能な細粒度の開発部品」にする。
// scope=どの Stage を回すか（specPlanned/behaviorChange）。tier=ゲート深さ（役割分離）。
// stage-graph.json と組み合わせて、scope ごとの実行 Stage 列を算出する純粋関数。

import type { StageGraph, StageNode, Tier, WorkflowState } from "../types";

export interface ScopeProfile {
  tier: Tier;
  /** 挙動変更を伴うか。false（doc-only 等）は TDD 不要（testing.md） */
  behaviorChange: boolean;
  specPlanned: boolean;
  /** この scope で必須にする sensor の id */
  sensors: string[];
  note: string;
}

export interface ScopesData {
  version: number;
  scopes: Record<string, ScopeProfile>;
}

/** scope 名からプロファイルを引く。未知なら有効値を添えて throw */
export function resolveScope(name: string, data: ScopesData): ScopeProfile {
  const profile = data.scopes[name];
  if (!profile) {
    throw new Error(`unknown scope: ${name}（有効: ${Object.keys(data.scopes).join(", ")}）`);
  }
  return profile;
}

/**
 * scope プロファイルを engine state（WorkflowState）初期種に変換する（scope→engine seed）。
 * scope 宣言（feature 等）から `report init` の tier/spec を機械的に seed し、手書きの
 * `tier=N spec=B` を不要にする（scope → engine state の合成）。遷移前なので stageStatus/gateStatus は空
 * （next() が planKey と tier-gate-map で skip/停止を決める）。scope は破壊しない（純粋・immutable）。
 */
export function scopeToInitialState(scope: ScopeProfile): WorkflowState {
  return {
    tier: scope.tier,
    specPlanned: scope.specPlanned,
    behaviorChange: scope.behaviorChange, // artifact guard の test-delta 免除判定に使う
    stageStatus: {},
    gateStatus: {},
  };
}

/**
 * scope プロファイルと stage-graph から、実際に回す Stage 列を算出する。
 * - 条件付き Stage（planKey 付き = spec）は scope のフラグで取捨
 * - 挙動変更なし（doc-only）は TDD（skill=tdd-cycle）を外す（testing.md の N/A 規約）
 * - それ以外の必須 Stage は常に実行
 */
export function plannedStages(scope: ScopeProfile, graph: StageGraph): StageNode[] {
  return graph.stages.filter((s) => {
    if (s.planKey) return scope[s.planKey]; // "2"→specPlanned
    if (!scope.behaviorChange && s.skill === "tdd-cycle") return false; // 挙動変更なし→TDD skip
    return true;
  });
}
