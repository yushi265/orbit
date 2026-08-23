# learnings — 未昇格の経験則（機械追記専用・advisory）

> **これは正式ルールではない。** `.claude/rules/*.md`（手書き正本）と違い、本ファイルは
> **Gate 3 の `retro-surface` で採用された学びを溜める staging** であり、**実装中の拘束力を持たない**。
> CLAUDE.md / AGENTS.md からも参照しない（自動ロードされる正本ルールに混ぜない）。
> `.claude/rules/` は毎セッション・全サブエージェントに自動注入されるため、拘束力を持たない staging を
> 常時コンテキストに混ぜない（読むのは retro-surface / retro-triage の実行時だけ）。

## 位置づけ（なぜ rules 正本と分けるか）

本リポは `.claude/rules/*.md` を**手書き正本**として運用する（機械が直接書き換えない安全設計）。
一方で retro note の学びは毎ボルト出る。そこで **二段昇格** で両立させる:

1. **機械追記（本ファイル）**: Gate 3 の `retro-surface`（[ai-dlc-flow](../../.claude/skills/ai-dlc-flow/SKILL.md) Stage 8）で
   surface した候補を人間が採否し、採用分だけを下記フォーマットで append する。
   → 「観察された経験則」の蓄積。まだ**正式ルールではない**。
2. **人間昇格（正本へ）**: 定期 triage（[retro-triage](../../.claude/skills/retro-triage/SKILL.md)・人間トリガ）で本ファイルを棚卸しし、
   - 繰り返し効く判断・方針 → 該当 `.claude/rules/*.md` へ**正式昇格**（昇格したら本ファイルから除去）。
   - grep/lint/型で機械判定できる不変条件 → **sensor 化**（`.claude/aidlc/src/sensors/`）。
   - 効かない / 陳腐化 → **剪定（削除）**。

> 二段にする理由: per-bolt の surface は**機械化**して着火ラグを潰す（月→毎ボルト）。
> だが正本への昇格は**人間の戦略判断**なので triage に残す。

## エントリ・フォーマット

採用 1 件 = 1 行（または短い箇条書き）。**日付・カテゴリタグ・還流先候補・出典 note** を含める。

```markdown
- [YYYY-MM-DD] <観察された経験則（次ボルト以降も効く粒度で）> `[category]` → 還流先候補: <rules/skills/sensor のどれか> （出典: <TICKET> retro）
```

- `category`: `spec` | `tdd` | `review` | `gate` | `boundary` | `security` | `tooling` | `other`
  （retro note の Problem タグと同一語彙。再発カウントの集計キー＝効果測定）。
- **idempotency（persist ツール化済み）**: `pnpm -C .claude/aidlc learnings persist "<entry>"` が
  観察文の内容キーで dedup 追記する（同一観察は日付/出典が違っても 1 件）。手書き追記も可だが二重登録に注意。
- **conflict 時**: 既存正本ルールと矛盾する学びは append せず人間にエスカレーション（「既存ルール X と衝突。どちらを採るか」）。
  persist の**前に** orchestrator が `code-reviewer` で新 learning と既存 `.claude/rules/*.md` を照合する（矛盾なら persist しない）。迷ったらエスカレーション（安全側）。

## surface コマンド（候補抽出・advisory）

```bash
pnpm -C .claude/aidlc learnings   # docs/ai-dlc/retro/ を集約 → 未対応 Try + カテゴリ再発を提示
```

---

## 学び（採用済み・未昇格）

> （まだ無し）採用された学びをここに追記する。

> 昇格・剪定したら該当行を除去し、その旨を triage 実施記録（[retro/README.md](./retro/README.md)）に残す。
