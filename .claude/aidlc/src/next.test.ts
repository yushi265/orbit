import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { next } from "./next";
import type { StageGraph, TierGateMap, WorkflowState, StageStatus } from "./types";

const graph: StageGraph = JSON.parse(
  readFileSync(new URL("../stage-graph.json", import.meta.url), "utf8"),
);
const tierMap: TierGateMap = JSON.parse(
  readFileSync(new URL("../tier-gate-map.json", import.meta.url), "utf8"),
);

/** デフォルト Tier 2・spec 実行・全 pending の state を作り、差分を上書きする */
function state(p: Partial<WorkflowState> = {}): WorkflowState {
  return { tier: 2, specPlanned: true, stageStatus: {}, gateStatus: {}, ...p };
}
const doneStages = (...ids: string[]): Record<string, StageStatus> =>
  Object.fromEntries(ids.map((id) => [id, "done" as StageStatus]));

const run = (s: WorkflowState) => next(s, graph, tierMap);

// --- 開始・Stage 進行（状態遷移テスト） ---

test("初期状態（何も done でない）→ Stage 0+1 を実行", () => {
  assert.deepEqual(run(state()), {
    kind: "run-stage",
    stage: "0+1",
    name: "Stage宣言＋要件整理",
    skill: null,
  });
});

test("0+1 done・Tier2・gate1 未承認 → Gate 1 で停止（blocking）", () => {
  const d = run(state({ tier: 2, stageStatus: doneStages("0+1") }));
  assert.deepEqual(d, { kind: "gate", gate: "gate1", mode: "blocking", stage: "0+1", name: "Stage宣言＋要件整理" });
});

test("0+1 done・gate1 承認・Tier2・spec実行 → Stage 2（create-spec）を実行", () => {
  const d = run(state({ stageStatus: doneStages("0+1"), gateStatus: { gate1: "approved" } }));
  assert.deepEqual(d, { kind: "run-stage", stage: "2", name: "design doc作成", skill: "create-spec" });
});

test("Stage2 done・spec実行・gate2 未承認（Tier2=conditional）→ Gate 2 で停止", () => {
  const d = run(
    state({ stageStatus: doneStages("0+1", "2"), gateStatus: { gate1: "approved" } }),
  );
  assert.deepEqual(d, { kind: "gate", gate: "gate2", mode: "conditional", stage: "2", name: "design doc作成" });
});

test("gate2 承認 → Stage 3+4（TDD）を実行", () => {
  const d = run(
    state({
      stageStatus: doneStages("0+1", "2"),
      gateStatus: { gate1: "approved", gate2: "approved" },
    }),
  );
  assert.deepEqual(d, { kind: "run-stage", stage: "3+4", name: "TDD（RED→GREEN→REFACTOR）", skill: "tdd-cycle" });
});

// --- 条件付き Stage の skip（spec） ---

test("spec省略（specPlanned=false・Tier2 4条件）→ Stage2 と gate2 を飛ばして 3+4 へ", () => {
  const d = run(
    state({ specPlanned: false, stageStatus: doneStages("0+1"), gateStatus: { gate1: "approved" } }),
  );
  assert.deepEqual(d, { kind: "run-stage", stage: "3+4", name: "TDD（RED→GREEN→REFACTOR）", skill: "tdd-cycle" });
});

test("3+4 done → Stage 5（静的解析）", () => {
  const d = run(
    state({ specPlanned: false, stageStatus: doneStages("0+1", "3+4"), gateStatus: { gate1: "approved" } }),
  );
  assert.deepEqual(d, { kind: "run-stage", stage: "5", name: "静的解析・フォーマッター", skill: null });
});

test("5 done → Stage 6（セルフレビュー・self-review）", () => {
  const d = run(
    state({ specPlanned: false, stageStatus: doneStages("0+1", "3+4", "5"), gateStatus: { gate1: "approved" } }),
  );
  assert.deepEqual(d, { kind: "run-stage", stage: "6", name: "セルフレビュー", skill: "self-review" });
});

test("6 done → Stage 8（成果提示。E2E ステージは廃止済み）", () => {
  const d = run(
    state({ specPlanned: false, stageStatus: doneStages("0+1", "3+4", "5", "6"), gateStatus: { gate1: "approved" } }),
  );
  assert.deepEqual(d, { kind: "run-stage", stage: "8", name: "成果提示＋コミット", skill: null });
});

// --- Gate 3（全ティア共通ブロッキング）と完了 ---

test("8 done・gate3 未承認 → Gate 3 で停止（全ティア blocking）", () => {
  const d = run(
    state({
      specPlanned: false,
      stageStatus: doneStages("0+1", "3+4", "5", "6", "8"),
      gateStatus: { gate1: "approved" },
    }),
  );
  assert.deepEqual(d, { kind: "gate", gate: "gate3", mode: "blocking", stage: "8", name: "成果提示＋コミット" });
});

test("全 Stage done・gate3 承認 → done", () => {
  const d = run(
    state({
      specPlanned: false,
      stageStatus: doneStages("0+1", "3+4", "5", "6", "8"),
      gateStatus: { gate1: "approved", gate3: "approved" },
    }),
  );
  assert.deepEqual(d, { kind: "done" });
});

// --- ティア別ゲート挙動（決定表テスト） ---

test("Tier3：gate1 は declare-only ＝ 非ブロッキング・spec省略 → 0+1 done から直接 3+4 へ", () => {
  const d = run(
    state({ tier: 3, specPlanned: false, stageStatus: doneStages("0+1") }),
  );
  // gate1 未承認でも declare-only なので停止せず、spec も skip して 3+4 を実行
  assert.deepEqual(d, { kind: "run-stage", stage: "3+4", name: "TDD（RED→GREEN→REFACTOR）", skill: "tdd-cycle" });
});

test("Tier3 でも Gate 3 はブロッキング（事後承認）", () => {
  const d = run(
    state({
      tier: 3,
      specPlanned: false,
      stageStatus: doneStages("0+1", "3+4", "5", "6", "8"),
    }),
  );
  assert.deepEqual(d, { kind: "gate", gate: "gate3", mode: "blocking", stage: "8", name: "成果提示＋コミット" });
});

test("Tier1：gate2 は blocking（spec必須）", () => {
  const d = run(
    state({ tier: 1, stageStatus: doneStages("0+1", "2"), gateStatus: { gate1: "approved" } }),
  );
  assert.deepEqual(d, { kind: "gate", gate: "gate2", mode: "blocking", stage: "2", name: "design doc作成" });
});

// --- 決定表の補完（Tier1 行）・決定論・不変条件 ---

test("Tier1：0+1 done・gate1 未承認 → Gate 1 で停止（blocking・最高リスク）", () => {
  const d = run(state({ tier: 1, stageStatus: doneStages("0+1") }));
  assert.deepEqual(d, { kind: "gate", gate: "gate1", mode: "blocking", stage: "0+1", name: "Stage宣言＋要件整理" });
});

test("Tier1：全 Stage done・gate1/2 承認・gate3 未承認 → Gate 3 で停止（blocking）", () => {
  const d = run(
    state({
      tier: 1,
      stageStatus: doneStages("0+1", "2", "3+4", "5", "6", "8"),
      gateStatus: { gate1: "approved", gate2: "approved" },
    }),
  );
  assert.deepEqual(d, { kind: "gate", gate: "gate3", mode: "blocking", stage: "8", name: "成果提示＋コミット" });
});

test("決定論・冪等性：同じ state で next() を複数回呼んでも常に同一の Directive", () => {
  const s = state({ stageStatus: doneStages("0+1", "2"), gateStatus: { gate1: "approved" } });
  const d1 = run(s);
  const d2 = run(s);
  const d3 = run(s);
  assert.deepEqual(d1, d2);
  assert.deepEqual(d2, d3);
  assert.deepEqual(d1, { kind: "gate", gate: "gate2", mode: "conditional", stage: "2", name: "design doc作成" });
});

test("不変条件：specPlanned=false なら stageStatus['2']='done' でも Stage2 は skip・gate2 に到達しない（planKey 優先）", () => {
  const d = run(
    state({
      specPlanned: false,
      stageStatus: { "0+1": "done", "2": "done" },
      gateStatus: { gate1: "approved" },
    }),
  );
  // gate2 を返さず、Stage2 を飛ばして 3+4 を実行する
  assert.deepEqual(d, { kind: "run-stage", stage: "3+4", name: "TDD（RED→GREEN→REFACTOR）", skill: "tdd-cycle" });
});

// --- Gate 2 委任（Gate 1 での人間オプトインによる declare-only 降格） ---

test("[状態遷移] Tier2・0+1,2 done・gate1 承認・委任 → gate2 で停止せず 3+4 へ", () => {
  const d = run(
    state({
      gate2Delegated: true,
      stageStatus: doneStages("0+1", "2"),
      gateStatus: { gate1: "approved" },
    }),
  );
  assert.deepEqual(d, { kind: "run-stage", stage: "3+4", name: "TDD（RED→GREEN→REFACTOR）", skill: "tdd-cycle" });
});

test("[状態遷移] Tier1（gate2=blocking）でも委任で降格され 3+4 へ", () => {
  const d = run(
    state({
      tier: 1,
      gate2Delegated: true,
      stageStatus: doneStages("0+1", "2"),
      gateStatus: { gate1: "approved" },
    }),
  );
  assert.deepEqual(d, { kind: "run-stage", stage: "3+4", name: "TDD（RED→GREEN→REFACTOR）", skill: "tdd-cycle" });
});

test("[不変条件] 委任しても gate3 は blocking のまま（全 Stage done・gate2 未承認 → gate3 で停止）", () => {
  const d = run(
    state({
      gate2Delegated: true,
      stageStatus: doneStages("0+1", "2", "3+4", "5", "6", "8"),
      gateStatus: { gate1: "approved" },
    }),
  );
  assert.deepEqual(d, { kind: "gate", gate: "gate3", mode: "blocking", stage: "8", name: "成果提示＋コミット" });
});

test("[不変条件] specPlanned=false + 委任 → gate2 に到達しない（planKey skip が先に効き委任は no-op）", () => {
  const d = run(
    state({
      specPlanned: false,
      gate2Delegated: true,
      stageStatus: { "0+1": "done", "2": "done" },
      gateStatus: { gate1: "approved" },
    }),
  );
  assert.deepEqual(d, { kind: "run-stage", stage: "3+4", name: "TDD（RED→GREEN→REFACTOR）", skill: "tdd-cycle" });
});

test("[代表値] gate2Delegated=false 明示 → 従来どおり gate2 で停止（optional falsy の網羅）", () => {
  const d = run(
    state({
      gate2Delegated: false,
      stageStatus: doneStages("0+1", "2"),
      gateStatus: { gate1: "approved" },
    }),
  );
  assert.deepEqual(d, { kind: "gate", gate: "gate2", mode: "conditional", stage: "2", name: "design doc作成" });
});

// --- 異常系 ---

test("未知の Tier → error", () => {
  const d = run(state({ tier: 4 as unknown as WorkflowState["tier"] }));
  assert.equal(d.kind, "error");
});
