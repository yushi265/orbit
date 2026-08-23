import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decideStop,
  hasOpenAnswerTag,
  EMPTY_MEMORY,
  type BoltSnapshot,
} from "./decide";
import type { StageGraph, TierGateMap, WorkflowState } from "../types";

const graph: StageGraph = JSON.parse(
  readFileSync(new URL("../../stage-graph.json", import.meta.url), "utf8"),
);
const tierMap: TierGateMap = JSON.parse(
  readFileSync(new URL("../../tier-gate-map.json", import.meta.url), "utf8"),
);

function state(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    tier: 2,
    specPlanned: false,
    stageStatus: {},
    gateStatus: {},
    ...overrides,
  };
}

function bolt(overrides: Partial<BoltSnapshot> = {}): BoltSnapshot {
  return { ticket: "PROJ-1", state: state(), auditLines: 3, ...overrides };
}

const decide = (bolts: BoltSnapshot[], memory = EMPTY_MEMORY, cap = 2) =>
  decideStop(bolts, memory, cap, graph, tierMap);

// --- allow 経路（邪魔しない側・fail-open） ---

test("ボルトなし → allow（非ボルト作業を邪魔しない）", () => {
  const d = decide([]);
  assert.equal(d.decision, "allow");
});

test("parked ボルトのみ → allow（正規中断を尊重）", () => {
  const d = decide([bolt({ state: state({ parked: true }) })]);
  assert.equal(d.decision, "allow");
});

test("blocking gate 待ち（Tier2 の gate1 pending）→ allow（人間待ち）", () => {
  const waiting = state({ stageStatus: { "0+1": "done" } }); // gate1 が pending
  const d = decide([bolt({ state: waiting })]);
  assert.equal(d.decision, "allow");
});

test("全 Stage 解決済み（done）→ allow", () => {
  const done = state({
    stageStatus: { "0+1": "done", "3+4": "done", "5": "done", "6": "done", "8": "done" },
    gateStatus: { gate1: "approved", gate3: "approved" },
  });
  const d = decide([bolt({ state: done })]);
  assert.equal(d.decision, "allow");
});

test("空 [Answer]: が残るボルト → allow（回答待ち・#16 連携）", () => {
  const d = decide([bolt({ hasOpenQuestions: true })]);
  assert.equal(d.decision, "allow");
});

test("state 不正（unknown tier → next が error）→ allow（fail-open）", () => {
  const broken = state({ tier: 9 as never });
  const d = decide([bolt({ state: broken })]);
  assert.equal(d.decision, "allow");
});

// --- block 経路（放置ターン終了の検出） ---

test("初回（memory 空）→ allow して signature を記録（基準点の確立）", () => {
  const d = decide([bolt()]);
  assert.equal(d.decision, "allow");
  assert.ok(d.memory.signature);
  assert.equal(d.memory.blockCount, 1);
});

test("同一 signature の 2 回目 → block（reason に ticket と次の一手）", () => {
  const first = decide([bolt()]);
  const second = decide([bolt()], first.memory);
  assert.equal(second.decision, "block");
  assert.ok(second.reason.includes("PROJ-1"));
  assert.ok(second.reason.includes("0+1")); // next の助言（Stage 0+1 が次）
  assert.ok(second.reason.includes("park")); // 正規中断の案内
});

test("blockCount が cap 到達までは block・cap 超えで allow（フェイルオープン・境界値）", () => {
  const cap = 2;
  const first = decide([bolt()], EMPTY_MEMORY, cap); // allow, blockCount=1
  const second = decide([bolt()], first.memory, cap); // block, blockCount=2 (= cap)
  assert.equal(second.decision, "block");
  const third = decide([bolt()], second.memory, cap); // blockCount=3 > cap → allow
  assert.equal(third.decision, "allow");
});

test("signature が変化（進捗あり）→ block せずカウンタリセット（状態遷移）", () => {
  const first = decide([bolt()]);
  const second = decide([bolt()], first.memory);
  assert.equal(second.decision, "block");
  // audit が進んだ（= このターンで report があった）
  const progressed = decide([bolt({ auditLines: 5 })], second.memory);
  assert.equal(progressed.decision, "allow");
  assert.equal(progressed.memory.blockCount, 1);
});

test("複数ボルト: 1 つでも Running が停滞していれば block 対象（当面仕様）", () => {
  const waiting = bolt({ ticket: "PROJ-2", state: state({ stageStatus: { "0+1": "done" } }) });
  const running = bolt({ ticket: "PROJ-1" });
  const first = decide([running, waiting]);
  const second = decide([running, waiting], first.memory);
  assert.equal(second.decision, "block");
  assert.ok(second.reason.includes("PROJ-1"));
  assert.ok(!second.reason.includes("PROJ-2")); // 人間待ちのボルトは対象外
});

// --- hasOpenAnswerTag（#16 質問ファイル連携） ---

test("hasOpenAnswerTag: 空 [Answer]: → true（回答待ち）", () => {
  const md = "## Q-1: どうする?\n- A. こう\n[Answer]:\n[根拠メモ]:";
  assert.equal(hasOpenAnswerTag(md), true);
});

test("hasOpenAnswerTag: 回答済み [Answer]: A → false（境界値）", () => {
  const md = "## Q-1: どうする?\n[Answer]: A\n## Q-2\n[Answer]: B 理由つき";
  assert.equal(hasOpenAnswerTag(md), false);
});

test("hasOpenAnswerTag: タグなし文書 → false", () => {
  assert.equal(hasOpenAnswerTag("# ただの文書"), false);
});
