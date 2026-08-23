// drift guard: 散文正本 ↔ JSON ミラーの実ファイル突合
// このテストが fail した時: **正本を変えたならミラーを追随させる／ミラーだけ変えたなら差し戻す**。
// 表の書式変更で落ちるのは仕様（正本の構造変更をミラー担当へ知らせるシグナル）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  diffStageFacts,
  diffTierFacts,
  parseStageGates,
  parseStageTable,
  parseTierTable,
  tier1TargetCell,
} from "./parse-rules";
import type { StageGraph, TierGateMap } from "../types";
import type { ScopesData } from "../scopes/resolve";
import type { TriggersData } from "../sensors/tier-tripwire";

const aidlcRoot = fileURLToPath(new URL("../..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const read = (rel: string) => readFileSync(`${repoRoot}/${rel}`, "utf8");

const riskTiers = read(".claude/rules/risk-tiers.md");
const skillMd = read(".claude/skills/ai-dlc-flow/SKILL.md");
const tierMap: TierGateMap = JSON.parse(readFileSync(`${aidlcRoot}/tier-gate-map.json`, "utf8"));
const graph: StageGraph = JSON.parse(readFileSync(`${aidlcRoot}/stage-graph.json`, "utf8"));
const scopes: ScopesData = JSON.parse(readFileSync(`${aidlcRoot}/scopes.json`, "utf8"));
const triggers: TriggersData = JSON.parse(readFileSync(`${aidlcRoot}/tier-triggers.json`, "utf8"));

test("drift: risk-tiers.md のティア表 ↔ tier-gate-map.json が一致する", () => {
  const diffs = diffTierFacts(parseTierTable(riskTiers), tierMap.tiers);
  assert.deepEqual(
    diffs,
    [],
    `正本(.claude/rules/risk-tiers.md) ↔ ミラー(.claude/aidlc/tier-gate-map.json) が乖離:\n${diffs.join("\n")}\n正本を変えたならミラー追随・ミラーだけ変えたなら差し戻し`,
  );
});

test("drift 検出の負けテスト: ミラー側だけ変えると不一致が報告される（検出ロジック自体の検証）", () => {
  const rows = parseTierTable(riskTiers);
  // tier-gate-map.json の gate2 だけを書き換えた fixture（正本は不変）
  const mutated = structuredClone(tierMap.tiers) as typeof tierMap.tiers;
  mutated["2"] = { ...mutated["2"], gate2: "blocking" };
  const diffs = diffTierFacts(rows, mutated);
  assert.equal(diffs.length, 1);
  assert.ok(diffs[0].includes("Tier 2"));
  assert.ok(diffs[0].includes("gate2"));
  assert.ok(diffs[0].includes("正本=conditional"));
  assert.ok(diffs[0].includes("ミラー=blocking"));
});

test("drift: ai-dlc-flow SKILL.md の Stage 表（🔒/🔓）↔ stage-graph.json の required が一致する", () => {
  const diffs = diffStageFacts(parseStageTable(skillMd), graph.stages);
  assert.deepEqual(diffs, [], `正本(SKILL.md 表) ↔ ミラー(stage-graph.json) が乖離:\n${diffs.join("\n")}`);
});

test("drift 検出の負けテスト: SKILL.md の 🔓 を 🔒 に変えた正本 → required 不一致が報告される", () => {
  const mutatedSkill = skillMd.replace("| 2 spec 作成 | 🔓条件付き", "| 2 spec 作成 | 🔒必須");
  const diffs = diffStageFacts(parseStageTable(mutatedSkill), graph.stages);
  assert.equal(diffs.length, 1);
  assert.ok(diffs[0].includes("Stage 2"));
  assert.ok(diffs[0].includes("正本=true"));
});

test("drift: SKILL.md の Gate 見出し ↔ stage-graph.json の gate が一致する", () => {
  const gates = parseStageGates(skillMd);
  for (const node of graph.stages) {
    assert.equal(
      node.gate ?? undefined,
      gates[node.id],
      `Stage ${node.id} の gate が不一致: 正本(SKILL.md 見出し)=${gates[node.id] ?? "なし"} / ミラー(stage-graph.json)=${node.gate ?? "なし"}`,
    );
  }
});

test("drift: scopes.json の各 scope が tier-gate-map の spec 方針と矛盾しない（デシジョンテーブル全列）", () => {
  for (const [name, scope] of Object.entries(scopes.scopes)) {
    const policy = tierMap.tiers[String(scope.tier)];
    assert.ok(policy, `scope '${name}' の tier=${scope.tier} が tier-gate-map に無い`);
    if (policy.spec === "required") {
      assert.equal(scope.specPlanned, true, `scope '${name}'（Tier ${scope.tier}=spec 必須）が specPlanned=false`);
    }
    if (policy.spec === "none") {
      assert.equal(scope.specPlanned, false, `scope '${name}'（Tier ${scope.tier}=spec 不要）が specPlanned=true`);
    }
  }
});

test("drift: tier-triggers.json の各トリガーが risk-tiers.md の Tier 1 対象セルに対応語を持つ", () => {
  const cell = tier1TargetCell(riskTiers);
  // tier-triggers.json の各トリガー id → risk-tiers.md の Tier 1 対象セルに現れるべき対応語。
  // プロジェクトが tier-triggers.json を書き換えたら、ここも正本（risk-tiers.md）の文言に合わせる。
  const vocabulary: Record<string, string[]> = {
    "db-schema": ["データスキーマ", "スキーマ"],
    "auth-boundary": ["認証", "認可"],
    "api-contract": ["インターフェース", "API契約", "API 契約"],
    "cycle-automation": ["Cycle", "自動遷移", "繰越"],
  };
  for (const trigger of triggers.triggers) {
    const words = vocabulary[trigger.id];
    assert.ok(
      words,
      `tier-triggers.json の '${trigger.id}' の正本対応語が未登録（このテストの vocabulary に追加し、risk-tiers.md との対応を宣言する）`,
    );
    assert.ok(
      words.some((w) => cell.includes(w)),
      `トリガー '${trigger.id}' の対応語（${words.join("/")}）が risk-tiers.md の Tier 1 対象セルに見つからない: ${cell}`,
    );
  }
});

test("drift: rules 5 本の Verification 分離（#8 Phase B）が保たれている", () => {
  const rules = [
    "risk-tiers.md",
    "simplicity.md",
    "task-and-pr.md",
    "testing.md",
    "spec-driven.md",
  ];
  for (const name of rules) {
    const verification = `${repoRoot}/.claude/rules/verification/${name}`;
    assert.ok(existsSync(verification), `.claude/rules/verification/${name} が無い（#8 Phase B の分離が壊れた）`);
    const body = read(`.claude/rules/${name}`);
    assert.ok(
      body.includes(`verification/${name}`),
      `.claude/rules/${name} に verification/ への参照行が無い`,
    );
    assert.ok(
      !body.split("\n").some((l) => l.startsWith("- [ ]")),
      `.claude/rules/${name} 本文にチェックリスト項目が残っている（常時注入ダイエットが崩れた）`,
    );
  }
});
