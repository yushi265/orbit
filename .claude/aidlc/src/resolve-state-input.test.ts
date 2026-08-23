import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveStateInput } from "./resolve-state-input";

// next CLI の入力解決（#1 Phase A/B の統合バグ修正）。
// - report が生成する markdown ラッパー state（aidlc:state マーカー付き）を next が読めること
// - 純 JSON（examples/state.example.json 等）後方互換
// - 空入力・壊れ JSON は生スタックトレースにせず friendly Error（fail-fast）

test("純 JSON を WorkflowState に解釈する（後方互換）", () => {
  const raw = JSON.stringify({
    tier: 1,
    specPlanned: true,
    stageStatus: {},
    gateStatus: {},
  });
  const s = resolveStateInput(raw);
  assert.equal(s.tier, 1);
  assert.equal(s.specPlanned, true);
});

test("report 生成の markdown ラッパー state から state ブロックを抽出する", () => {
  const md = [
    "# aidlc engine state: demo",
    "",
    "<!-- aidlc:state:begin -->",
    JSON.stringify(
      {
        tier: 2,
        specPlanned: true,
        stageStatus: {},
        gateStatus: { gate1: "approved" },
      },
      null,
      2,
    ),
    "<!-- aidlc:state:end -->",
    "",
    "## audit log",
    "- 2026-06-25T00:00:00.000Z TIER_DECLARED tier=2",
  ].join("\n");
  const s = resolveStateInput(md);
  assert.equal(s.tier, 2);
  assert.equal(s.gateStatus.gate1, "approved");
});

test("空入力は fail-fast（friendly Error・生スタックにしない）", () => {
  assert.throws(() => resolveStateInput("   \n  "), /空/);
});

test("壊れた JSON は friendly Error", () => {
  assert.throws(() => resolveStateInput("{ not json"), /JSON/);
});
