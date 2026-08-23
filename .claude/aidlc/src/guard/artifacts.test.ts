import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchGlob,
  isExempt,
  countTestDeltaLines,
  verifyStage,
  verifyAllStages,
  formatGate3Checklist,
  type GuardEvidence,
} from "./artifacts";
import type { StageGraph, StageNode, WorkflowState } from "../types";

function state(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    tier: 2,
    specPlanned: true,
    stageStatus: {},
    gateStatus: {},
    ...overrides,
  };
}

function evidence(overrides: Partial<GuardEvidence> = {}): GuardEvidence {
  return { files: [], diffNumstat: "", ...overrides };
}

const specStage: StageNode = {
  id: "2",
  name: "design doc作成",
  required: false,
  skill: "create-spec",
  gate: "gate2",
  planKey: "specPlanned",
  skipCondition: null,
  produces: [
    { glob: "docs/spec/<TICKET>-*/index.md", kind: "exists" },
    { glob: "docs/spec/<TICKET>-*/progress.md", kind: "exists" },
  ],
};

const tddStage: StageNode = {
  id: "3+4",
  name: "TDD",
  required: true,
  skill: "tdd-cycle",
  gate: null,
  planKey: null,
  skipCondition: null,
  produces: [{ kind: "test-delta", exemptWhen: "behaviorChange=false" }],
};

const finalStage: StageNode = {
  id: "8",
  name: "成果提示＋コミット",
  required: true,
  skill: null,
  gate: "gate3",
  planKey: null,
  skipCondition: null,
  produces: [
    { glob: "docs/ai-dlc/retro/<TICKET>.md", kind: "exists", exemptWhen: "specPlanned=false" },
    { glob: "docs/spec/<TICKET>-*/progress.md", kind: "progress-removed" },
  ],
};

// --- matchGlob ---

test("matchGlob: <TICKET> 置換後の * がセグメント内にマッチ", () => {
  assert.equal(matchGlob("docs/spec/PROJ-1-*/index.md", "docs/spec/PROJ-1-foo/index.md"), true);
});

test("matchGlob: * はパス区切りを跨がない（境界値）", () => {
  assert.equal(matchGlob("docs/spec/*/index.md", "docs/spec/a/b/index.md"), false);
});

test("matchGlob: ** は任意階層を跨ぐ", () => {
  assert.equal(matchGlob("service/**/x_test.go", "service/a/b/x_test.go"), true);
});

// --- isExempt（デシジョンテーブル: key の値 true/false/undefined × 条件） ---

test("isExempt: specPlanned=false 条件は state.specPlanned=false でのみ免除", () => {
  assert.equal(isExempt("specPlanned=false", state({ specPlanned: false })), true);
  assert.equal(isExempt("specPlanned=false", state({ specPlanned: true })), false);
});

test("isExempt: behaviorChange 未定義（undefined）は免除しない（安全側）", () => {
  assert.equal(isExempt("behaviorChange=false", state()), false);
  assert.equal(isExempt("behaviorChange=false", state({ behaviorChange: false })), true);
  assert.equal(isExempt("behaviorChange=false", state({ behaviorChange: true })), false);
});

test("isExempt: exemptWhen 未指定は免除しない", () => {
  assert.equal(isExempt(undefined, state()), false);
});

// --- countTestDeltaLines ---

test("countTestDeltaLines: numstat のテストファイル追加行を合算", () => {
  const numstat = [
    "10\t2\tservice/foo_test.go",
    "5\t0\tapi/src/x.test.ts",
    "3\t1\tui/src/y.spec.tsx",
    "100\t0\tservice/main.go",
  ].join("\n");
  assert.equal(countTestDeltaLines(numstat), 18);
});

test("countTestDeltaLines: テスト増分なし・binary（-）は 0（境界値）", () => {
  assert.equal(countTestDeltaLines("100\t0\tservice/main.go"), 0);
  assert.equal(countTestDeltaLines("-\t-\timg_test.go.png"), 0);
  assert.equal(countTestDeltaLines(""), 0);
});

// --- verifyStage: exists ---

test("verifyStage exists: glob ヒットあり → finding なし", () => {
  const ev = evidence({
    files: ["docs/spec/PROJ-1-foo/index.md", "docs/spec/PROJ-1-foo/progress.md"],
  });
  assert.deepEqual(verifyStage(specStage, { ticket: "PROJ-1", state: state(), evidence: ev }), []);
});

test("verifyStage exists: ヒット 0 件 → 不足 glob を返す（境界値）", () => {
  const findings = verifyStage(specStage, { ticket: "PROJ-1", state: state(), evidence: evidence() });
  assert.equal(findings.length, 2);
  assert.equal(findings[0].kind, "exists");
  assert.ok(findings[0].detail.includes("docs/spec/PROJ-1-*/index.md"));
});

// --- verifyStage: test-delta ---

test("verifyStage test-delta: テスト追加行 > 0 → finding なし", () => {
  const ev = evidence({ diffNumstat: "10\t0\tservice/foo_test.go" });
  assert.deepEqual(verifyStage(tddStage, { ticket: "PROJ-1", state: state(), evidence: ev }), []);
});

test("verifyStage test-delta: 増分 0 行 → finding / behaviorChange=false は exempt", () => {
  const noDelta = evidence({ diffNumstat: "100\t0\tservice/main.go" });
  const findings = verifyStage(tddStage, { ticket: "PROJ-1", state: state(), evidence: noDelta });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "test-delta");

  const exempt = verifyStage(tddStage, {
    ticket: "PROJ-1",
    state: state({ behaviorChange: false }),
    evidence: noDelta,
  });
  assert.deepEqual(exempt, []);
});

// --- verifyStage: progress-removed ---

test("verifyStage progress-removed: progress.md が残存 → finding / 除去済み → なし", () => {
  const remaining = evidence({ files: ["docs/spec/PROJ-1-foo/progress.md", "docs/ai-dlc/retro/PROJ-1.md"] });
  const findings = verifyStage(finalStage, { ticket: "PROJ-1", state: state(), evidence: remaining });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "progress-removed");

  const removed = evidence({ files: ["docs/ai-dlc/retro/PROJ-1.md"] });
  assert.deepEqual(verifyStage(finalStage, { ticket: "PROJ-1", state: state(), evidence: removed }), []);
});

test("verifyStage: retro note は specPlanned=false なら exempt", () => {
  const findings = verifyStage(finalStage, {
    ticket: "PROJ-1",
    state: state({ specPlanned: false }),
    evidence: evidence(),
  });
  assert.deepEqual(findings, []);
});

// --- verifyStage: 後方互換・skip ---

test("verifyStage: produces 未定義 stage → finding なし（後方互換）", () => {
  const bare: StageNode = { ...tddStage, id: "5", produces: undefined };
  assert.deepEqual(verifyStage(bare, { ticket: "PROJ-1", state: state(), evidence: evidence() }), []);
});

test("verifyStage: skip された stage（planKey=false / stageStatus=skipped）→ finding なし", () => {
  const byPlan = verifyStage(specStage, { ticket: "PROJ-1", state: state({ specPlanned: false }), evidence: evidence() });
  assert.deepEqual(byPlan, []);
  const byStatus = verifyStage(tddStage, {
    ticket: "PROJ-1",
    state: state({ stageStatus: { "3+4": "skipped" } }),
    evidence: evidence(),
  });
  assert.deepEqual(byStatus, []);
});

// --- verifyAllStages / formatGate3Checklist ---

const miniGraph: StageGraph = { version: 1, source: "test", stages: [specStage, tddStage, finalStage] };

test("verifyAllStages: 全 stage の findings を集約", () => {
  const findings = verifyAllStages(miniGraph, { ticket: "PROJ-1", state: state(), evidence: evidence() });
  assert.ok(findings.some((f) => f.stage === "2"));
  assert.ok(findings.some((f) => f.stage === "3+4"));
  assert.ok(findings.some((f) => f.stage === "8" && f.kind === "exists"));
});

test("formatGate3Checklist: 全 stage を表で出し、除去対象 glob の exists 行は後段優先で N/A", () => {
  const ev = evidence({
    files: ["docs/spec/PROJ-1-foo/index.md", "docs/ai-dlc/retro/PROJ-1.md"],
    diffNumstat: "12\t0\tservice/foo_test.go",
  });
  const out = formatGate3Checklist(miniGraph, { ticket: "PROJ-1", state: state(), evidence: ev });
  assert.ok(out.includes("PROJ-1"));
  assert.ok(out.includes("✓"));
  // progress.md は stage 8 の progress-removed が正で、stage 2 の exists 行は誤検知させない
  const progressExistsLine = out
    .split("\n")
    .find((l) => l.includes("2") && l.includes("progress.md"));
  assert.ok(progressExistsLine === undefined || progressExistsLine.includes("除去対象"));
  // 除去済みなので progress-removed は ✓
  const removedLine = out.split("\n").find((l) => l.includes("progress-removed"));
  assert.ok(removedLine?.includes("✓"));
});

test("formatGate3Checklist: skip された stage は N/A 表示（誤検知させない）", () => {
  const out = formatGate3Checklist(miniGraph, {
    ticket: "PROJ-1",
    state: state({ specPlanned: false, behaviorChange: false }),
    evidence: evidence(),
  });
  assert.ok(!out.includes("✗"));
});
