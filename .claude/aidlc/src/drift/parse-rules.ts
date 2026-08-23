// drift guard: 散文正本の表行パーサ（advisory→テスト固定）
// 散文正本（risk-tiers.md / ai-dlc-flow SKILL.md）から JSON ミラーと突合できる構造値を抽出する。
// 方針: **意味解析しない**。アンカーは表の行頭パターンとキーフレーズのみ。
// 表現が変わって抽出できない時は null / throw（silent pass しない）——
// 「正本の構造変更をミラー担当へ知らせるシグナル」として fail するのが仕様。

import type { GateId, GateMode } from "../types";

export interface TierRowFacts {
  tier: "1" | "2" | "3";
  gate1: GateMode;
  gate2: GateMode;
  gate3: GateMode;
  spec: "required" | "conditional" | "none";
}

/** ゲートセルのキーフレーズ → gate モード 3 つ組（decision マップ。表現変更は null = fail シグナル） */
function gateModesFromCell(cell: string): Pick<TierRowFacts, "gate1" | "gate2" | "gate3"> | null {
  if (cell.includes("Gate 1 + Gate 2 + Gate 3 すべてブロッキング")) {
    return { gate1: "blocking", gate2: "blocking", gate3: "blocking" };
  }
  if (cell.includes("Gate 1 + Gate 3 はブロッキング") && cell.includes("Gate 2 は spec 実行時のみ")) {
    return { gate1: "blocking", gate2: "conditional", gate3: "blocking" };
  }
  if (cell.includes("宣言のみ") && cell.includes("Gate 3（コミット前承認）のみブロッキング")) {
    return { gate1: "declare-only", gate2: "n/a", gate3: "blocking" };
  }
  return null;
}

function specFromCell(cell: string): TierRowFacts["spec"] | null {
  const c = cell.trim();
  if (c.startsWith("必須")) return "required";
  if (c.startsWith("条件付き")) return "conditional";
  if (c.startsWith("不要")) return "none";
  return null;
}

/**
 * risk-tiers.md のティア定義表から 3 tier 分の事実を抽出する。
 * 3 行揃わない・セルが解釈できない時は throw（正本の表構造が変わった）。
 */
export function parseTierTable(md: string): TierRowFacts[] {
  const rows: TierRowFacts[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*\*\*Tier ([123])（/);
    if (!m) continue;
    const cells = line.split("|").map((c) => c.trim());
    // cells: [ "", "**Tier N（...）**", 対象, 人間ゲート, spec, "" ]
    if (cells.length < 5) throw new Error(`Tier ${m[1]} 行のセル数が想定外（表の構造が変わった）: ${line}`);
    const gates = gateModesFromCell(cells[3]);
    if (!gates) throw new Error(`Tier ${m[1]} のゲートセルを解釈できない（キーフレーズが変わった）: ${cells[3]}`);
    const spec = specFromCell(cells[4]);
    if (!spec) throw new Error(`Tier ${m[1]} の spec セルを解釈できない: ${cells[4]}`);
    rows.push({ tier: m[1] as TierRowFacts["tier"], ...gates, spec });
  }
  if (rows.length !== 3) {
    throw new Error(`ティア表から 3 行を抽出できない（${rows.length} 行。正本の表構造が変わった）`);
  }
  return rows;
}

export interface StageRowFacts {
  id: string;
  required: boolean; // 🔒必須 = true / 🔓条件付き = false
}

/**
 * ai-dlc-flow SKILL.md の「必須 Stage と条件付きスキップ基準」表から Stage 区分を抽出する。
 * 行頭 `| <id> ` かつ区分セルが 🔒/🔓 で始まる行だけを拾う。
 */
export function parseStageTable(md: string): StageRowFacts[] {
  const rows: StageRowFacts[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*([\d+]+)\s/);
    if (!m) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4) continue;
    const kubun = cells[2];
    if (kubun.startsWith("🔒")) rows.push({ id: m[1], required: true });
    else if (kubun.startsWith("🔓")) rows.push({ id: m[1], required: false });
  }
  if (rows.length === 0) throw new Error("Stage 表から 1 行も抽出できない（正本の表構造が変わった）");
  return rows;
}

/** 各 Stage 手順見出し（`### <id>. …【Gate N（…）】`）から stage id → gate の対応を抽出する。 */
export function parseStageGates(md: string): Record<string, GateId> {
  const gates: Record<string, GateId> = {};
  for (const line of md.split("\n")) {
    const m = line.match(/^###\s*([\d+]+)\.\s.*【Gate\s*([123])/);
    if (m) gates[m[1]] = `gate${m[2]}` as GateId;
  }
  return gates;
}

/**
 * 正本（ティア表の抽出結果）とミラー（tier-gate-map.json）の不一致を列挙する。
 * 空配列 = 同期。非空 = drift（メッセージに tier・キー・両側の値を含める）。
 */
export function diffTierFacts(
  rows: TierRowFacts[],
  tiers: Record<string, { gate1: GateMode; gate2: GateMode; gate3: GateMode; spec: string }>,
): string[] {
  const diffs: string[] = [];
  for (const row of rows) {
    const policy = tiers[row.tier];
    if (!policy) {
      diffs.push(`tier-gate-map.json に tier ${row.tier} が無い`);
      continue;
    }
    for (const key of ["gate1", "gate2", "gate3", "spec"] as const) {
      if (policy[key] !== row[key]) {
        diffs.push(`Tier ${row.tier} の ${key} が不一致: 正本=${row[key]} / ミラー=${policy[key]}`);
      }
    }
  }
  return diffs;
}

/** 正本（Stage 表の抽出結果）とミラー（stage-graph.json の required）の不一致を列挙する。 */
export function diffStageFacts(
  rows: StageRowFacts[],
  stages: { id: string; required: boolean }[],
): string[] {
  const diffs: string[] = [];
  if (rows.length !== stages.length) {
    diffs.push(`Stage 数が不一致: 正本=${rows.length} / ミラー=${stages.length}`);
  }
  for (const row of rows) {
    const node = stages.find((s) => s.id === row.id);
    if (!node) {
      diffs.push(`stage-graph.json に Stage ${row.id} が無い`);
      continue;
    }
    if (node.required !== row.required) {
      diffs.push(`Stage ${row.id} の required が不一致: 正本=${row.required} / ミラー=${node.required}`);
    }
  }
  return diffs;
}

/** risk-tiers.md の Tier 1 対象セル（昇格トリガーの正本文言）を返す。tier-triggers.json との対応検査に使う。 */
export function tier1TargetCell(md: string): string {
  for (const line of md.split("\n")) {
    if (!line.match(/^\|\s*\*\*Tier 1（/)) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 3) break;
    return cells[2];
  }
  throw new Error("Tier 1 行（対象セル）を抽出できない（正本の表構造が変わった）");
}
