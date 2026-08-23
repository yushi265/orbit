// learnings-format sensor の TDD。
// 書式: 「`- [YYYY-MM-DD] … \`[category]\` → 還流先候補: …（出典: …）` 形式」。
// 出典は docs/ai-dlc/learnings.md 冒頭のエントリ・フォーマット規約（機械追記の書式検査）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanLearningsFormat } from "./learnings-format";

const OK_ENTRY =
  "- [2026-06-25] サブエージェント完了後は独立再実行してから次 Stage へ進む `[review]` → 還流先候補: `.claude/skills/ai-dlc-flow/SKILL.md` （出典: safety retro）";

const md = (entries: string[]): string =>
  ["# learnings", "", "## 学び（採用済み・未昇格）", "", ...entries, "", "> 注記行"].join("\n");

test("[代表値] 正形式 entry → findings 0", () => {
  assert.deepEqual(scanLearningsFormat(md([OK_ENTRY])), []);
});

test("[値域外] 日付なし → 行番号付き finding", () => {
  const bad = "- サブエージェントの学び `[review]` → 還流先候補: X （出典: Y retro）";
  const findings = scanLearningsFormat(md([bad]));
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /日付/);
  assert.equal(findings[0].line, 5); // md() の構造上 5 行目
});

test("[値域外] カテゴリタグなし / 還流先なし / 出典なし → 各 1 finding", () => {
  const noCat = "- [2026-06-25] 学び → 還流先候補: X （出典: Y retro）";
  const noReflux = "- [2026-06-25] 学び `[review]` （出典: Y retro）";
  const noSource = "- [2026-06-25] 学び `[review]` → 還流先候補: X";
  assert.match(scanLearningsFormat(md([noCat]))[0].message, /カテゴリ/);
  assert.match(scanLearningsFormat(md([noReflux]))[0].message, /還流先/);
  assert.match(scanLearningsFormat(md([noSource]))[0].message, /出典/);
});

test("[代表値] 複数欠落は 1 行 1 finding（欠落要素を列挙）", () => {
  const bad = "- 全部欠けとる行";
  const findings = scanLearningsFormat(md([bad]));
  assert.equal(findings.length, 1); // 行単位で 1 件（メッセージに全欠落を列挙）
  assert.match(findings[0].message, /日付/);
  assert.match(findings[0].message, /カテゴリ/);
});

test("[代表値] 学びセクション外の '- ' 行は検査対象外", () => {
  const text = ["# learnings", "- セクション外の箇条書き（自由記述）", "## 学び（採用済み・未昇格）", "", OK_ENTRY].join("\n");
  assert.deepEqual(scanLearningsFormat(text), []);
});

test("[境界値] 学びセクションが無い md → findings 0（検査対象なし・fail-open）", () => {
  assert.deepEqual(scanLearningsFormat("# 別のファイル\n- 何かの行\n"), []);
});
