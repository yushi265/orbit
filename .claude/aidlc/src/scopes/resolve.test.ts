import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveScope, plannedStages, scopeToInitialState, type ScopesData } from "./resolve";
import type { StageGraph } from "../types";

const scopes: ScopesData = JSON.parse(
  readFileSync(new URL("../../scopes.json", import.meta.url), "utf8"),
);
const graph: StageGraph = JSON.parse(
  readFileSync(new URL("../../stage-graph.json", import.meta.url), "utf8"),
);

test("feature: Tier2・spec 実行・挙動変更あり", () => {
  const s = resolveScope("feature", scopes);
  assert.equal(s.tier, 2);
  assert.equal(s.specPlanned, true);
  assert.equal(s.behaviorChange, true);
});

test("bugfix: Tier2・spec 省略・挙動変更あり", () => {
  const s = resolveScope("bugfix", scopes);
  assert.equal(s.tier, 2);
  assert.equal(s.specPlanned, false);
  assert.equal(s.behaviorChange, true);
});

test("security-patch: Tier1（spec 必須・sensors はプロジェクトが登録）", () => {
  const s = resolveScope("security-patch", scopes);
  assert.equal(s.tier, 1);
  assert.equal(s.specPlanned, true);
  assert.deepEqual(s.sensors, []); // 同梱 sensor なし・プロジェクトが自分のセキュリティ sensor を登録する
});

test("doc-only: Tier3・挙動変更なし（TDD 不要）", () => {
  const s = resolveScope("doc-only", scopes);
  assert.equal(s.tier, 3);
  assert.equal(s.behaviorChange, false);
});

test("未知 scope は例外", () => {
  assert.throws(() => resolveScope("nope", scopes), /unknown scope/);
});

test("plannedStages: feature は全 6 Stage（2 を含む・E2E なし）", () => {
  const ids = plannedStages(resolveScope("feature", scopes), graph).map((s) => s.id);
  assert.deepEqual(ids, ["0+1", "2", "3+4", "5", "6", "8"]);
});

test("plannedStages: bugfix は spec(2) を除く", () => {
  const ids = plannedStages(resolveScope("bugfix", scopes), graph).map((s) => s.id);
  assert.deepEqual(ids, ["0+1", "3+4", "5", "6", "8"]);
});

test("plannedStages: doc-only は TDD(3+4)/spec(2) を除く", () => {
  const ids = plannedStages(resolveScope("doc-only", scopes), graph).map((s) => s.id);
  assert.deepEqual(ids, ["0+1", "5", "6", "8"]);
});

test("plannedStages: security-patch は spec 実行", () => {
  const ids = plannedStages(resolveScope("security-patch", scopes), graph).map((s) => s.id);
  assert.deepEqual(ids, ["0+1", "2", "3+4", "5", "6", "8"]);
});

// --- scopeToInitialState: scope → #1 engine state の初期種（seed）---------------

test("scopeToInitialState: feature → Tier2・spec 実行の engine state 種を作る", () => {
  const seed = scopeToInitialState(resolveScope("feature", scopes));
  assert.equal(seed.tier, 2);
  assert.equal(seed.specPlanned, true);
  // 初期種は遷移前なので stageStatus / gateStatus は空（next() が planKey で skip 判定する）
  assert.deepEqual(seed.stageStatus, {});
  assert.deepEqual(seed.gateStatus, {});
});

test("scopeToInitialState: bugfix → Tier2・spec 省略の種（feature と区別される）", () => {
  const seed = scopeToInitialState(resolveScope("bugfix", scopes));
  assert.equal(seed.tier, 2);
  assert.equal(seed.specPlanned, false);
});

test("scopeToInitialState: doc-only → Tier3・spec 省略の種", () => {
  const seed = scopeToInitialState(resolveScope("doc-only", scopes));
  assert.equal(seed.tier, 3);
  assert.equal(seed.specPlanned, false);
});

test("scopeToInitialState: behaviorChange を seed する（doc-only=false / feature=true。#6 guard の免除判定に使う）", () => {
  assert.equal(scopeToInitialState(resolveScope("doc-only", scopes)).behaviorChange, false);
  assert.equal(scopeToInitialState(resolveScope("feature", scopes)).behaviorChange, true);
});

test("scopeToInitialState: security-patch → Tier1・spec 実行の種", () => {
  const seed = scopeToInitialState(resolveScope("security-patch", scopes));
  assert.equal(seed.tier, 1);
  assert.equal(seed.specPlanned, true);
});

test("scopeToInitialState は ScopeProfile を破壊しない（immutability）", () => {
  const profile = resolveScope("feature", scopes);
  const before = JSON.stringify(profile);
  scopeToInitialState(profile);
  assert.equal(JSON.stringify(profile), before);
});
