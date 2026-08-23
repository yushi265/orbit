import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeAudit, formatSummary } from "./summary";

const TS = "2026-07-02T00:00:00.000Z";

test("audit 行からボルトのコストレポートを集計する（代表値）", () => {
  const audit = [
    `${TS} TIER_DECLARED tier=2`,
    `${TS} PLAN_DECLARED spec=false`,
    `${TS} STAGE_COMPLETED stage=0+1`,
    `${TS} GATE_APPROVED gate=gate1`,
    `${TS} STAGE_SKIPPED stage=2`,
    `${TS} STAGE_COMPLETED stage=3+4`,
    `${TS} GATE_REJECTED gate=gate3`,
    `${TS} GATE_APPROVED gate=gate3`,
    `${TS} NOTE tokens=123456`,
  ];
  const s = summarizeAudit(audit);
  assert.equal(s.stagesCompleted, 2);
  assert.equal(s.stagesSkipped, 1);
  assert.equal(s.gatesApproved, 2);
  assert.equal(s.gateRejections, 1); // gate 往復数（差し戻し）
  assert.equal(s.tokens, 123456);
  assert.equal(s.events, 9);
});

test("audit 0 行 → 全カウント 0・tokens は null（境界値）", () => {
  const s = summarizeAudit([]);
  assert.equal(s.events, 0);
  assert.equal(s.stagesCompleted, 0);
  assert.equal(s.gateRejections, 0);
  assert.equal(s.tokens, null);
});

test("tokens note が複数あれば最後の値を採用する", () => {
  const s = summarizeAudit([`${TS} NOTE tokens=100`, `${TS} NOTE tokens=200`]);
  assert.equal(s.tokens, 200);
});

test("壊れた audit 行は skip して継続する（fail-open）", () => {
  const s = summarizeAudit(["こわれた行", `${TS} STAGE_COMPLETED stage=5`, ""]);
  assert.equal(s.stagesCompleted, 1);
  assert.equal(s.events, 1); // 解釈できた行だけ数える
});

test("formatSummary: 表 + 記録なしの注記（LLM に数えさせない機械集計の出力）", () => {
  const withTokens = formatSummary("PROJ-1", summarizeAudit([`${TS} NOTE tokens=42`]));
  assert.ok(withTokens.includes("PROJ-1"));
  assert.ok(withTokens.includes("42"));
  const empty = formatSummary("PROJ-2", summarizeAudit([]));
  assert.ok(empty.includes("記録なし"));
});
