// learnings persist の TDD。
// 採用 Try を docs/ai-dlc/learnings.md（機械追記専用・旧 _learnings.md）へ dedup 追記する決定論部分。
// conflict-check（既存 rules との LLM 照合）は純ツールに入れず orchestrator が code-reviewer 委譲する（advisory）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { observationOf, isDuplicate, appendLearning } from "./persist";

const HEADER = [
  "# _learnings — 未昇格の経験則",
  "",
  "## 学び（採用済み・未昇格）",
  "",
].join("\n");
const NOTE = "\n> 昇格・剪定したら該当行を除去する。\n";

const ENTRY_A =
  "- [2026-06-25] サブエージェント完了後は独立ゲート再実行してから次 Stage へ進む。 `[review]` → 還流先候補: `ai-dlc-flow` （出典: X retro）";
const ENTRY_B =
  "- [2026-06-25] aidlc CLI のパスは `.claude/aidlc` 相対で渡す。 `[tooling]` → 還流先候補: `README` （出典: X retro）";

function withEntries(): string {
  return HEADER + ENTRY_A + "\n" + ENTRY_B + "\n" + NOTE;
}
function emptySection(): string {
  return HEADER + NOTE;
}

// --- observationOf: dedup 用の内容キー（観察文・date/category/還流先/出典を除く）---

test("observationOf は date/category/還流先/出典を落として観察文だけを正規化して返す", () => {
  const key = observationOf(ENTRY_A);
  assert.equal(key, "サブエージェント完了後は独立ゲート再実行してから次 Stage へ進む。");
});

test("observationOf は日付や出典が違っても同じ観察文なら同じキーを返す（dedup の核）", () => {
  const a = observationOf("- [2026-06-25] 同じ観察。 `[tooling]` → 還流先候補: `A` （出典: P）");
  const b = observationOf("- [2026-07-01] 同じ観察。 `[tooling]` → 還流先候補: `B` （出典: Q）");
  assert.equal(a, b);
});

// --- isDuplicate ---

test("isDuplicate: 既存と同じ観察文（日付違い）は重複と判定", () => {
  const dup = "- [2026-07-09] サブエージェント完了後は独立ゲート再実行してから次 Stage へ進む。 `[review]` → 還流先候補: `Y` （出典: Z）";
  assert.equal(isDuplicate(withEntries(), dup), true);
});

test("isDuplicate: 新規観察文は重複でない", () => {
  const fresh = "- [2026-07-09] 新しい学び。 `[spec]` → 還流先候補: `W` （出典: V）";
  assert.equal(isDuplicate(withEntries(), fresh), false);
});

// --- appendLearning ---

test("appendLearning: 新規 entry は最後の既存 entry の直後に追記される", () => {
  const fresh = "- [2026-07-09] 新しい学び。 `[spec]` → 還流先候補: `W` （出典: V）";
  const r = appendLearning(withEntries(), fresh);
  assert.equal(r.appended, true);
  const lines = r.md.split("\n");
  const idxB = lines.indexOf(ENTRY_B);
  const idxFresh = lines.indexOf(fresh);
  assert.equal(idxFresh, idxB + 1, "新 entry は最後の既存 entry(ENTRY_B)の直後（隣接行）");
  // 末尾の注記より前に入る
  const idxNote = lines.findIndex((l) => l.startsWith("> 昇格"));
  assert.ok(idxFresh < idxNote, "新 entry は注記より前");
});

test("appendLearning: 重複 entry は追記せず appended=false", () => {
  const dup = "- [2026-07-09] aidlc CLI のパスは `.claude/aidlc` 相対で渡す。 `[tooling]` → 還流先候補: `R` （出典: S）";
  const r = appendLearning(withEntries(), dup);
  assert.equal(r.appended, false);
  assert.equal(r.md, withEntries(), "本文は不変");
});

test("appendLearning: 空セクションでも注記の前に追記できる", () => {
  const fresh = "- [2026-07-09] 最初の学び。 `[gate]` → 還流先候補: `W` （出典: V）";
  const r = appendLearning(emptySection(), fresh);
  assert.equal(r.appended, true);
  const lines = r.md.split("\n");
  const idxHeading = lines.findIndex((l) => l.startsWith("## 学び"));
  const idxFresh = lines.indexOf(fresh);
  const idxNote = lines.findIndex((l) => l.startsWith("> 昇格"));
  assert.ok(idxHeading < idxFresh && idxFresh < idxNote, "見出しと注記の間に入る");
  assert.equal(lines[idxFresh + 1], "", "entry と注記の間に空行が入る（見た目の分離）");
});

test("observationOf: カテゴリタグ無し entry は『→ 還流先』手前で切る／区切り無しは全文をキーに", () => {
  // カテゴリタグ無し・還流先あり
  assert.equal(observationOf("- [2026-07-09] タグ無しの観察。 → 還流先候補: `X`"), "タグ無しの観察。");
  // 区切り無し（フォーマット最小）→ 観察文全体がキー
  assert.equal(observationOf("- [2026-07-09] 区切り無しの観察"), "区切り無しの観察");
});

test("appendLearning: セクションが無い md は例外（機械追記先が壊れている）", () => {
  assert.throws(() => appendLearning("# 何か別のファイル\n", "- [2026-07-09] x `[spec]`"), /学び/);
});
