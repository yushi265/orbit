import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRetroNote, aggregateLearnings } from "./parse";

// 実 retro note（login-prototype.md）の形を模した fixture。プレースホルダ混在。
const note1 = `# login-prototype retro note
## メタ
- ticket: login-prototype（チケットレス）
- 機能概要: ログイン
## 各 Stage の気づき（材料・軽量）
| Stage | 気づき（摩擦・想定外・判断） |
|-------|------------------------------|
| 1 要件整理＋Stage 宣言 | 環境変数1つで切替は経路が異なり非自明 |
| 5 静的解析 | mise 未導入で golangci-lint が使えず CI 任せ |
## 振り返り（KPT）
### Keep
- <...>
### Problem
- \`[spec]\` 異常系を曖昧に書きルート間で非対称になった
- \`[tooling]\` mise が無いと品質ゲートを完結できない
### Try
- <...>
## フロー改善アクション
| Try | 還流先 | ステータス |
|-----|--------|-----------|
| <改善案> | <還流先> | 未対応 |
`;

const note2 = `## メタ
- ticket: PROJ-100
## 振り返り（KPT）
### Problem
- \`[spec]\` AC の引用が曖昧
### Try
## フロー改善アクション
| Try | 還流先 | ステータス |
|-----|--------|-----------|
| spec に AC 引用を必須化 | create-spec | 未対応 |
| テスト命名規約を追加 | .claude/rules/testing.md | 反映済み(PR#42) |
`;

test("ticket をメタから抽出", () => {
  assert.equal(parseRetroNote(note1).ticket, "login-prototype（チケットレス）");
});

// --- #24 効果測定: メタ日付 + タグ無し Problem（measure の入力） ---

test("[代表値] メタの「着手日 / 完了日」から completedDate（完了日）を抽出", () => {
  const md = "## メタ\n- ticket: X\n- 着手日 / 完了日: 2026-06-17 / 2026-06-18\n";
  assert.equal(parseRetroNote(md).completedDate, "2026-06-18");
});

test("[境界値] 完了日がプレースホルダ → 着手日へフォールバック・両方プレースホルダ → null", () => {
  const half = "## メタ\n- 着手日 / 完了日: 2026-06-17 / <YYYY-MM-DD>\n";
  assert.equal(parseRetroNote(half).completedDate, "2026-06-17");
  const none = "## メタ\n- 着手日 / 完了日: <YYYY-MM-DD> / <YYYY-MM-DD>\n";
  assert.equal(parseRetroNote(none).completedDate, null);
});

test("[代表値] 日付行の無いメタ（phaseb-effectiveness 型）→ completedDate は null", () => {
  const md = "## メタ\n- 対象: 複数施策の実地採用率\n- 測定日: 2026-06-25\n";
  assert.equal(parseRetroNote(md).completedDate, null);
});

test("[代表値] タグ無し Problem 行は untaggedProblems に入る（プレースホルダは無視・既存 problems は不変）", () => {
  const md = "### Problem\n- `[spec]` タグ付きの問題\n- タグの無い問題行\n- <...>\n";
  const p = parseRetroNote(md);
  assert.deepEqual(p.problems, [{ category: "spec", text: "タグ付きの問題" }]);
  assert.deepEqual(p.untaggedProblems, ["タグの無い問題行"]);
});

test("Problem をカテゴリ付きで抽出・プレースホルダは無視", () => {
  assert.deepEqual(parseRetroNote(note1).problems, [
    { category: "spec", text: "異常系を曖昧に書きルート間で非対称になった" },
    { category: "tooling", text: "mise が無いと品質ゲートを完結できない" },
  ]);
});

test("各 Stage の気づきを抽出・<あれば> プレースホルダは無視", () => {
  const ins = parseRetroNote(note1).insights;
  assert.equal(ins.length, 2);
  assert.deepEqual(ins[0], {
    stage: "1 要件整理＋Stage 宣言",
    note: "環境変数1つで切替は経路が異なり非自明",
  });
});

test("フロー改善アクションのプレースホルダ行（<改善案>）は抽出しない", () => {
  assert.deepEqual(parseRetroNote(note1).actions, []);
});

test("実アクション行（Try / 還流先 / ステータス）を抽出", () => {
  const a = parseRetroNote(note2).actions;
  assert.equal(a.length, 2);
  assert.deepEqual(a[0], {
    improvement: "spec に AC 引用を必須化",
    refluxTarget: "create-spec",
    status: "未対応",
  });
  assert.deepEqual(a[1], {
    improvement: "テスト命名規約を追加",
    refluxTarget: ".claude/rules/testing.md",
    status: "反映済み(PR#42)",
  });
});

test("aggregate: 未対応アクション集約 + カテゴリ再発カウント（効果測定キー）", () => {
  const agg = aggregateLearnings([parseRetroNote(note1), parseRetroNote(note2)]);
  // 未対応のみ集約（note2 の「反映済み」は除外、note1 のプレースホルダも除外）
  assert.equal(agg.openActions.length, 1);
  assert.equal(agg.openActions[0].refluxTarget, "create-spec");
  // spec が 2 件（note1 + note2）= カテゴリ再発の機械検出
  assert.equal(agg.categoryCounts.spec, 2);
  assert.equal(agg.categoryCounts.tooling, 1);
});

test("テンプレ未記入・空 note でも例外を投げず空を返す", () => {
  const empty = parseRetroNote("# 見出しだけ\n## メタ\n## フロー改善アクション\n");
  assert.deepEqual(empty.problems, []);
  assert.deepEqual(empty.actions, []);
  assert.deepEqual(empty.insights, []);
  assert.equal(empty.ticket, null);
});

// --- 堅牢化（Stage 6 レビュー反映） ---

test("ステータスは完全一致で判定（「見送り(未対応…)」を open に誤計上しない）", () => {
  const note = `## フロー改善アクション
| Try | 還流先 | ステータス |
|-----|--------|-----------|
| A 案 | x | 未対応 |
| B 案 | y | 見送り(未対応だった理由) |`;
  const agg = aggregateLearnings([parseRetroNote(note)]);
  assert.equal(agg.openActions.length, 1);
  assert.equal(agg.openActions[0].improvement, "A 案");
});

test("ヘッダが「工程」でも insight として漏らさない（次行＝区切りで判定）", () => {
  const note = `## 各 Stage の気づき
| 工程 | 気づき（摩擦・想定外・判断） |
|------|------------------------------|
| 1 要件整理 | 実ログイン検証で気づいた |`;
  const ins = parseRetroNote(note).insights;
  assert.equal(ins.length, 1);
  assert.deepEqual(ins[0], { stage: "1 要件整理", note: "実ログイン検証で気づいた" });
});

test("気づきセル内の `[category]` タグも categoryCounts に算入", () => {
  const note = `## 各 Stage の気づき
| 工程 | 気づき |
|------|--------|
| 2 spec 作成 | MUST/SHOULD を明示推奨。\`[spec]\` |
| 6 レビュー | クロスチェック観点を追加。\`[spec]\` |`;
  const agg = aggregateLearnings([parseRetroNote(note)]);
  assert.equal(agg.categoryCounts.spec, 2);
});

test("openActions は同一 Try（improvement+還流先）を重複除去する", () => {
  const n = `## フロー改善アクション
| Try | 還流先 | ステータス |
|-----|--------|-----------|
| 同じ案 | create-spec | 未対応 |`;
  const agg = aggregateLearnings([parseRetroNote(n), parseRetroNote(n)]);
  assert.equal(agg.openActions.length, 1);
});

// --- 実 retro note 較正（#1/#2 同様に実物で検証） ---

const retroDir = fileURLToPath(new URL("../../../../docs/ai-dlc/retro/", import.meta.url));
const VOCAB = new Set(["spec", "tdd", "review", "gate", "boundary", "security", "tooling", "other"]);

test("実 retro note 全件: 例外なくパースでき構造が妥当（較正）", () => {
  const files = readdirSync(retroDir).filter(
    (f) => f.endsWith(".md") && f !== "_TEMPLATE.md" && f !== "README.md",
  );
  // テンプレートには実 retro note が無い（各プロジェクトが運用で増やす）。
  // 実 note があるプロジェクトでは、その全件が例外なくパースでき構造が妥当なことを較正する。
  for (const f of files) {
    const parsed = parseRetroNote(readFileSync(`${retroDir}/${f}`, "utf8"));
    for (const p of parsed.problems) {
      assert.ok(VOCAB.has(p.category), `${f}: 未知カテゴリ ${p.category}`);
    }
    for (const ins of parsed.insights) {
      assert.notEqual(ins.stage, "Stage");
      assert.notEqual(ins.stage, "工程");
      assert.ok(!ins.note.startsWith("気づき"), `${f}: ヘッダが insight に漏洩: ${ins.note}`);
    }
    for (const a of parsed.actions) {
      assert.ok(a.improvement.length > 0 && a.status.length > 0, `${f}: 不完全な action`);
    }
  }
});
