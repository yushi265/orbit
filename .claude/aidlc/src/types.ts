// AI-DLC 決定論エンジン 型定義（助言モード）
// 正本: .claude/skills/ai-dlc-flow/SKILL.md（Stage） / .claude/rules/risk-tiers.md（Tier・Gate）

export type Tier = 1 | 2 | 3;
export type GateId = "gate1" | "gate2" | "gate3";

/** ゲートの挙動。risk-tiers.md の決定表に対応 */
export type GateMode = "blocking" | "declare-only" | "conditional" | "n/a";

export type StageStatus = "pending" | "active" | "done" | "skipped";
export type GateStatus = "pending" | "approved";

/** Stage が産むべき証跡 1 件（artifact guard）。glob の `<TICKET>` は state ファイル名で置換 */
export interface ProducesSpec {
  /** exists=glob が 1 件以上 / test-delta=テストファイル追加行 > 0 / progress-removed=glob が 0 件（除去済み） */
  kind: "exists" | "test-delta" | "progress-removed";
  glob?: string; // kind=test-delta では不要
  /** `key=value` 形式。state の該当キーが一致したら検証を免除（例: "behaviorChange=false"） */
  exemptWhen?: string;
}

/** stage-graph.json の 1 ノード（ai-dlc-flow の 1 Stage） */
export interface StageNode {
  id: string; // "0+1" | "2" | "3+4" | "5" | "6" | "8"
  name: string;
  required: boolean; // 🔒必須 = true / 🔓条件付き = false
  skill: string | null; // 呼び出す既存スキル（無ければ null）
  gate: GateId | null; // この Stage 完了に紐づく人間ゲート
  /** 実行可否を決める state のキー（条件付き Stage のみ。null = 必ず実行） */
  planKey: "specPlanned" | null;
  skipCondition: string | null;
  /** Stage 完了時に存在を検証する証跡（省略時は検証なし = 後方互換） */
  produces?: ProducesSpec[];
}

export interface StageGraph {
  version: number;
  source: string;
  stages: StageNode[];
}

/** risk-tiers.md の 1 ティア分のゲート方針 */
export interface TierPolicy {
  label: string;
  gate1: GateMode;
  gate2: GateMode;
  gate3: GateMode;
  spec: "required" | "conditional" | "none";
}

export interface TierGateMap {
  version: number;
  source: string;
  tiers: Record<string, TierPolicy>; // key: "1" | "2" | "3"
}

/** ワークフローの機械可読 state（Phase A では助言入力。将来 progress.md を置換） */
export interface WorkflowState {
  tier: Tier;
  /** Stage 2（spec）を実行するか。Stage 宣言で決定 */
  specPlanned: boolean;
  /** Gate 2 委任。Gate 1 で人間が明示委任した場合のみ true（AI から提案しない）。gate2 を declare-only 相当へ降格する */
  gate2Delegated?: boolean;
  /** 挙動変更を伴うか（scopes.json から seed・省略時は「変更あり」扱い = artifact guard を免除しない安全側） */
  behaviorChange?: boolean;
  /** 人間が正規中断（park）を宣言したか（Stop guard が allow 判定に使う） */
  parked?: boolean;
  /** stageId -> 状態。未記載は "pending" 扱い */
  stageStatus: Record<string, StageStatus>;
  /** gateId -> 状態。未記載は "pending" 扱い */
  gateStatus: Partial<Record<GateId, GateStatus>>;
}

/** next() が返す「次の 1 手」。engine が決定論的に算出する */
export type Directive =
  | { kind: "run-stage"; stage: string; name: string; skill: string | null }
  | { kind: "gate"; gate: GateId; mode: GateMode; stage: string; name: string }
  | { kind: "done" }
  | { kind: "error"; message: string };
