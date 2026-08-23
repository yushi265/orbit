# learnings — retro note の surface（advisory）

retro note（`docs/ai-dlc/retro/`）を**機械パースして集約**し、
`retro-triage` が手作業でやっている「**未対応 Try 集約**」「**Problem カテゴリ再発チェック（効果測定）**」を機械化する。

> **advisory（非強制・観測）**。retro note のフォーマットは**変更しない**（既存の per-Stage 気づき表 + KPT + フロー改善アクション表をそのまま読む）。

## できること

| 関数 | 役割 |
|---|---|
| `parseRetroNote(md)` | 1 note を構造化（ticket / problems[カテゴリ] / actions[Try・還流先・status] / insights / 気づき内タグ） |
| `aggregateLearnings(notes)` | 横断集約：未対応 Try（重複除去）+ カテゴリ別出現回数（再発＝効果測定キー） |
| `appendLearning(md, line)` | **persist**: 採用 Try を `docs/ai-dlc/learnings.md` へ dedup 追記（観察文の内容キーで重複防止・冪等） |
| `observationOf` / `isDuplicate` | dedup の内容キー抽出・重複判定（日付/出典が違っても同じ観察は1件） |
| `parseAdoptedTries` / `parseSensorLog` / `buildMatrix` / `formatMeasure` | **measure（効果測定）**: learnings.md の採用 Try 日付で期間を区切り、カテゴリ × 期間の再発マトリクス（出典 note 付き）+ sensor FAIL 推移を出す。**判定はしない**（効いた/未達は retro-triage 手順で人間） |

- Problem の `` `[category]` `` タグ（spec/tdd/review/gate/boundary/security/tooling/other）と、**気づきセルに埋め込まれたタグ**の両方を再発カウントに算入。
- フロー改善アクション表の **status=未対応** だけを「棚卸し候補」として集約（完全一致判定）。
- プレースホルダ（`<...>`/`<あれば>`/`<改善案>`）・テーブルヘッダ（次行が `|---|` で判定）は除外。

## 使い方

```bash
# 採用 Try を docs/ai-dlc/learnings.md へ dedup 追記（persist）
#   ※ orchestrator は persist の前に conflict-check（新 learning vs 既存 .claude/rules/*.md）を
#     code-reviewer へ委譲し、矛盾なら persist せず human escalation する（advisory）。
pnpm -C .claude/aidlc learnings persist "- [YYYY-MM-DD] <観察> \`[tooling]\` → 還流先候補: ... （出典: <TICKET> retro）"

# docs/ai-dlc/retro/ 全 note を集約して surface（advisory）
pnpm -C .claude/aidlc learnings

# 別ディレクトリを指定
pnpm -C .claude/aidlc learnings <retro-dir>

# 再発マトリクス + sensor FAIL 推移（measure。retro-triage 手順の材料・判定は人間）
pnpm -C .claude/aidlc learnings measure

# テスト（実 note 較正を含む）
pnpm -C .claude/aidlc test
```

出力例:
```
## 未対応 Try（N 件）— 棚卸し候補
- [還流先: create-spec] spec のマッピング表と AC 本文のクロスチェック観点を追加（未対応）
...
## Problem カテゴリ再発（効果測定キー）
- spec: N 件  ← 再発（剪定 / 機械化の検討候補）
```

正式昇格・剪定は [retro-triage](../../../skills/retro-triage/SKILL.md) の二段昇格。
retro note の書き方・カテゴリ・還流先の正本は [`docs/ai-dlc/retro/README.md`](../../../../docs/ai-dlc/retro/README.md)。
