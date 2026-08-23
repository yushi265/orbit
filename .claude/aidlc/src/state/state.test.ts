// state engine の TDD。
//           / .claude/skills/ai-dlc-flow/SKILL.md（Stage） / .claude/rules/risk-tiers.md（Tier/Gate）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyReport,
  auditLine,
  parseStateFile,
  serializeStateFile,
  applyReportToDocument,
  initialDocument,
  parseReportEvent,
  parseInitArgs,
  type StateDocument,
} from "./state";
import type { WorkflowState } from "../types";

const TS = "2026-06-25T00:00:00.000Z";

function baseState(): WorkflowState {
  return { tier: 2, specPlanned: true, stageStatus: {}, gateStatus: {} };
}

// --- applyReport: 遷移（純粋・不変） -----------------------------------------

test("applyReport は元の state を破壊しない（immutability）", () => {
  const s0 = baseState();
  const s1 = applyReport(s0, { type: "stage-completed", stage: "0+1" });
  assert.notEqual(s1, s0);
  assert.deepEqual(s0.stageStatus, {}); // 元は不変
  assert.equal(s1.stageStatus["0+1"], "done");
});

test("tier-declared は tier を更新する", () => {
  const s = applyReport(baseState(), { type: "tier-declared", tier: 1 });
  assert.equal(s.tier, 1);
});

test("plan-declared は specPlanned を更新する", () => {
  const s = applyReport(baseState(), { type: "plan-declared", specPlanned: false });
  assert.equal(s.specPlanned, false);
});

test("stage-started / stage-completed / stage-skipped は stageStatus を遷移させる", () => {
  let s = baseState();
  s = applyReport(s, { type: "stage-started", stage: "3+4" });
  assert.equal(s.stageStatus["3+4"], "active");
  s = applyReport(s, { type: "stage-completed", stage: "3+4" });
  assert.equal(s.stageStatus["3+4"], "done");
  s = applyReport(s, { type: "stage-skipped", stage: "2" });
  assert.equal(s.stageStatus["2"], "skipped");
});

test("gate-approved / gate-rejected は gateStatus を遷移させる", () => {
  let s = baseState();
  s = applyReport(s, { type: "gate-approved", gate: "gate1" });
  assert.equal(s.gateStatus.gate1, "approved");
  s = applyReport(s, { type: "gate-rejected", gate: "gate1" });
  assert.equal(s.gateStatus.gate1, "pending"); // 却下は pending へ戻す
});

// --- auditLine: 監査行フォーマット ------------------------------------------

test("auditLine は event 種別ごとに正規化された 1 行を返す", () => {
  assert.equal(auditLine({ type: "tier-declared", tier: 2 }, TS), `${TS} TIER_DECLARED tier=2`);
  assert.equal(
    auditLine({ type: "plan-declared", specPlanned: true }, TS),
    `${TS} PLAN_DECLARED spec=true`,
  );
  assert.equal(auditLine({ type: "stage-started", stage: "6" }, TS), `${TS} STAGE_STARTED stage=6`);
  assert.equal(auditLine({ type: "stage-completed", stage: "6" }, TS), `${TS} STAGE_COMPLETED stage=6`);
  assert.equal(auditLine({ type: "stage-skipped", stage: "2" }, TS), `${TS} STAGE_SKIPPED stage=2`);
  assert.equal(auditLine({ type: "gate-approved", gate: "gate3" }, TS), `${TS} GATE_APPROVED gate=gate3`);
  assert.equal(auditLine({ type: "gate-rejected", gate: "gate2" }, TS), `${TS} GATE_REJECTED gate=gate2`);
});

// --- parse / serialize: state ファイル往復 ----------------------------------

test("serialize → parse は state と audit を round-trip する", () => {
  const doc: StateDocument = {
    ticket: "SAMPLE-1",
    state: { tier: 1, specPlanned: true, stageStatus: { "0+1": "done" }, gateStatus: { gate1: "approved" } },
    audit: [`${TS} TIER_DECLARED tier=1`, `${TS} GATE_APPROVED gate=gate1`],
  };
  const md = serializeStateFile(doc);
  const back = parseStateFile(md);
  assert.deepEqual(back.state, doc.state);
  assert.deepEqual(back.audit, doc.audit);
  assert.equal(back.ticket, doc.ticket);
});

test("parseStateFile は手書き progress 風の前後ノイズがあっても state ブロックを抽出する", () => {
  const md = [
    "# aidlc engine state: NOISE-1",
    "",
    "> 説明文（無視される）",
    "",
    "<!-- aidlc:state:begin -->",
    JSON.stringify({ tier: 3, specPlanned: false, stageStatus: {}, gateStatus: {} }, null, 2),
    "<!-- aidlc:state:end -->",
    "",
    "## audit log",
    `- ${TS} TIER_DECLARED tier=3`,
  ].join("\n");
  const doc = parseStateFile(md);
  assert.equal(doc.state.tier, 3);
  assert.equal(doc.audit.length, 1);
});

// --- applyReportToDocument: state遷移 + audit追記（idempotent） --------------

test("applyReportToDocument は state を遷移させ audit に 1 行追記する", () => {
  const doc = initialDocument("DOC-1", { tier: 2, specPlanned: true });
  const r = applyReportToDocument(doc, { type: "stage-completed", stage: "0+1" }, TS);
  assert.equal(r.skipped, false);
  assert.equal(r.doc.state.stageStatus["0+1"], "done");
  assert.equal(r.doc.audit.length, 1);
  assert.match(r.doc.audit[0], /STAGE_COMPLETED stage=0\+1$/);
});

test("同一 event の二重 report は idempotent（audit を重複追記しない）", () => {
  const doc = initialDocument("DOC-2", { tier: 2, specPlanned: true });
  const first = applyReportToDocument(doc, { type: "gate-approved", gate: "gate1" }, TS);
  const second = applyReportToDocument(first.doc, { type: "gate-approved", gate: "gate1" }, "2026-06-25T01:00:00.000Z");
  assert.equal(second.skipped, true);
  assert.equal(second.doc.audit.length, 1); // 重複追記なし
});

// --- parseReportEvent: CLI 引数 → ReportEvent --------------------------------

test("parseReportEvent は各 verb を ReportEvent に変換する", () => {
  assert.deepEqual(parseReportEvent(["tier", "2"]), { type: "tier-declared", tier: 2 });
  assert.deepEqual(parseReportEvent(["plan", "spec=false"]), {
    type: "plan-declared",
    specPlanned: false,
  });
  assert.deepEqual(parseReportEvent(["stage-start", "3+4"]), { type: "stage-started", stage: "3+4" });
  assert.deepEqual(parseReportEvent(["stage-done", "6"]), { type: "stage-completed", stage: "6" });
  assert.deepEqual(parseReportEvent(["stage-skip", "2"]), { type: "stage-skipped", stage: "2" });
  assert.deepEqual(parseReportEvent(["gate-approve", "gate1"]), { type: "gate-approved", gate: "gate1" });
  assert.deepEqual(parseReportEvent(["gate-reject", "gate2"]), { type: "gate-rejected", gate: "gate2" });
});

test("parseReportEvent は不正な verb / 引数で例外を投げる（fail fast）", () => {
  assert.throws(() => parseReportEvent(["bogus", "x"]), /unknown/i);
  assert.throws(() => parseReportEvent(["gate-approve", "gate9"]), /gate/i); // 値域外
  assert.throws(() => parseReportEvent(["stage-done"]), /stage/i); // 引数欠落
});

test("parseReportEvent: tier は値域 1|2|3 の境界とその前後で判定する", () => {
  // 有効クラス（境界値）
  assert.equal(parseReportEvent(["tier", "1"]).type, "tier-declared");
  assert.equal(parseReportEvent(["tier", "3"]).type, "tier-declared");
  // 無効クラス（境界の前後: 下限-1=0 / 上限+1=4 / さらに外=9）
  assert.throws(() => parseReportEvent(["tier", "0"]), /tier/i); // 下境界 -1
  assert.throws(() => parseReportEvent(["tier", "4"]), /tier/i); // 上境界 +1
  assert.throws(() => parseReportEvent(["tier", "9"]), /tier/i);
});

test("parseReportEvent: plan は spec 引数欠落・不正値で例外を投げる（fail fast）", () => {
  assert.throws(() => parseReportEvent(["plan"]), /spec/i); // spec 欠落
  assert.throws(() => parseReportEvent(["plan", "spec=maybe"]), /spec/i); // 不正値
});

// --- parseInitArgs: init 引数（fail fast）------------------------------------

test("parseInitArgs は tier / spec を厳格に解釈する", () => {
  assert.deepEqual(parseInitArgs(["tier=2", "spec=true"]), {
    tier: 2,
    specPlanned: true,
  });
});

test("parseInitArgs は欠落・不正値で例外を投げる（init のサイレントフォールバック禁止）", () => {
  assert.throws(() => parseInitArgs(["spec=true"]), /tier/i); // tier 欠落
  assert.throws(() => parseInitArgs(["tier=9", "spec=true"]), /tier/i); // tier 値域外
  assert.throws(() => parseInitArgs(["tier=2"]), /spec/i); // spec 欠落
  assert.throws(() => parseInitArgs(["tier=2", "spec=yes"]), /spec/i); // spec 不正値
});

// --- parseStateFile: エラーパス / audit 空 -----------------------------------

test("parseStateFile は state ブロックが無いと例外を投げる（fail fast）", () => {
  assert.throws(() => parseStateFile("# 壊れたファイル\nマーカー無し"), /state ブロック/);
});

test("serialize → parse は audit 0 件（init 直後）でも round-trip する", () => {
  const doc = initialDocument("EMPTY-1", { tier: 2, specPlanned: true });
  const back = parseStateFile(serializeStateFile(doc));
  assert.deepEqual(back.audit, []);
  assert.deepEqual(back.state, doc.state);
});

// --- park / unpark（Stop guard の正規中断） -------------------------

test("park → parked=true / unpark → parked=false（状態遷移・immutable）", () => {
  const base = initialDocument("PARK-1", { tier: 2, specPlanned: false }).state;
  const parked = applyReport(base, { type: "workflow-parked" });
  assert.equal(parked.parked, true);
  assert.equal(base.parked, undefined); // 元 state を破壊しない
  const resumed = applyReport(parked, { type: "workflow-unparked" });
  assert.equal(resumed.parked, false);
});

test("park / unpark の audit シグネチャは WORKFLOW_PARKED / WORKFLOW_UNPARKED", () => {
  assert.equal(auditLine({ type: "workflow-parked" }, TS), `${TS} WORKFLOW_PARKED`);
  assert.equal(auditLine({ type: "workflow-unparked" }, TS), `${TS} WORKFLOW_UNPARKED`);
});

test("parseReportEvent: park / unpark verb を解釈する", () => {
  assert.deepEqual(parseReportEvent(["park"]), { type: "workflow-parked" });
  assert.deepEqual(parseReportEvent(["unpark"]), { type: "workflow-unparked" });
});

// --- gate-delegated / gate-undelegated（Gate 2 委任・gate2 限定） --

test("[状態遷移] gate-delegated → gate2Delegated=true / gate-undelegated → false（immutable）", () => {
  const base = baseState();
  const delegated = applyReport(base, { type: "gate-delegated", gate: "gate2" });
  assert.equal(delegated.gate2Delegated, true);
  assert.equal(base.gate2Delegated, undefined); // 元 state を破壊しない
  const undelegated = applyReport(delegated, { type: "gate-undelegated", gate: "gate2" });
  assert.equal(undelegated.gate2Delegated, false);
});

test("[代表値] auditLine は GATE_DELEGATED / GATE_UNDELEGATED gate=gate2 を返す", () => {
  assert.equal(auditLine({ type: "gate-delegated", gate: "gate2" }, TS), `${TS} GATE_DELEGATED gate=gate2`);
  assert.equal(auditLine({ type: "gate-undelegated", gate: "gate2" }, TS), `${TS} GATE_UNDELEGATED gate=gate2`);
});

test("[代表値] parseReportEvent: gate-delegate / gate-undelegate verb を解釈する", () => {
  assert.deepEqual(parseReportEvent(["gate-delegate", "gate2"]), { type: "gate-delegated", gate: "gate2" });
  assert.deepEqual(parseReportEvent(["gate-undelegate", "gate2"]), { type: "gate-undelegated", gate: "gate2" });
});

test("[値域外] gate-delegate / gate-undelegate は gate2 以外・引数欠落で例外（gate1/gate3 の委任禁止・fail fast）", () => {
  assert.throws(() => parseReportEvent(["gate-delegate", "gate1"]), /gate2/);
  assert.throws(() => parseReportEvent(["gate-delegate", "gate3"]), /gate2/);
  assert.throws(() => parseReportEvent(["gate-delegate"]), /gate2/);
  assert.throws(() => parseReportEvent(["gate-undelegate", "gate1"]), /gate2/);
});

test("[往復] gate2Delegated=true 込み state の serialize → parse round-trip", () => {
  const doc: StateDocument = {
    ticket: "DELEG-1",
    state: { tier: 1, specPlanned: true, gate2Delegated: true, stageStatus: {}, gateStatus: {} },
    audit: [`${TS} GATE_DELEGATED gate=gate2`],
  };
  const back = parseStateFile(serializeStateFile(doc));
  assert.equal(back.state.gate2Delegated, true);
  assert.deepEqual(back.state, doc.state);
});

test("[後方互換] 旧形式 state（gate2Delegated フィールド無し）の parse → undefined ＝ 非委任", () => {
  const md = serializeStateFile(initialDocument("OLD-1", { tier: 2, specPlanned: true }));
  const doc = parseStateFile(md);
  assert.equal(doc.state.gate2Delegated, undefined);
});

test("[冪等] 同一 gate-delegate の二重 report → skipped・audit 1 行のみ", () => {
  const doc = initialDocument("DELEG-2", { tier: 2, specPlanned: true });
  const first = applyReportToDocument(doc, { type: "gate-delegated", gate: "gate2" }, TS);
  assert.equal(first.skipped, false);
  assert.equal(first.doc.state.gate2Delegated, true);
  const second = applyReportToDocument(first.doc, { type: "gate-delegated", gate: "gate2" }, "2026-07-02T01:00:00.000Z");
  assert.equal(second.skipped, true);
  assert.equal(second.doc.audit.length, 1);
});
