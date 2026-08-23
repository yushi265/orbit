import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTierTable, parseStageTable, parseStageGates, tier1TargetCell } from "./parse-rules";

const TIER_TABLE = [
  "| ティア | 対象 | 人間ゲート | spec |",
  "|--------|------|-----------|------|",
  "| **Tier 1（高リスク）** | DB schema / データ境界 | Gate 1 + Gate 2 + Gate 3 すべてブロッキング承認。spec 省略不可 | 必須（ADR が要る場合あり） |",
  "| **Tier 2（中リスク）** | それ以外 | Gate 1 + Gate 3 はブロッキング承認。Gate 2 は spec 実行時のみ | 条件付き（4 条件で判定） |",
  "| **Tier 3（低リスク）** | typo 等 | Gate 1 は**宣言のみ（承認待ち不要）**。Gate 3（コミット前承認）のみブロッキング | 不要 |",
].join("\n");

test("parseTierTable: 3 tier の gate/spec を抽出（代表値）", () => {
  const rows = parseTierTable(TIER_TABLE);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { tier: "1", gate1: "blocking", gate2: "blocking", gate3: "blocking", spec: "required" });
  assert.deepEqual(rows[1], { tier: "2", gate1: "blocking", gate2: "conditional", gate3: "blocking", spec: "conditional" });
  assert.deepEqual(rows[2], { tier: "3", gate1: "declare-only", gate2: "n/a", gate3: "blocking", spec: "none" });
});

test("parseTierTable: キーフレーズが変わったら throw（silent pass しない・境界値）", () => {
  const mutated = TIER_TABLE.replace("Gate 2 は spec 実行時のみ", "Gate 2 は状況次第");
  assert.throws(() => parseTierTable(mutated), /解釈できない/);
});

test("parseTierTable: 表が無い文書は throw（正本の構造変更シグナル）", () => {
  assert.throws(() => parseTierTable("# ただの文書"), /3 行を抽出できない/);
});

test("parseStageTable / parseStageGates: Stage 表と gate 見出しを抽出", () => {
  const md = [
    "| Stage | 区分 | スキップ基準 |",
    "| 0+1 Stage 宣言 | 🔒必須 | 深さのみ適応 |",
    "| 2 spec 作成 | 🔓条件付き | 4 条件 |",
    "### 0+1. Stage 宣言＋要件整理【Gate 1（要件承認）】",
    "### 2. design doc 作成【Gate 2（spec 承認・条件付き）】",
    "### 8. 成果提示【Gate 3（コミット承認）】",
  ].join("\n");
  assert.deepEqual(parseStageTable(md), [
    { id: "0+1", required: true },
    { id: "2", required: false },
  ]);
  assert.deepEqual(parseStageGates(md), { "0+1": "gate1", "2": "gate2", "8": "gate3" });
});

test("tier1TargetCell: Tier 1 の対象セル（昇格トリガー正本文言）を返す", () => {
  assert.equal(tier1TargetCell(TIER_TABLE), "DB schema / データ境界");
});
