# sensors — 編集時の決定論検証（advisory）

`.claude/rules/` の Verification 節にある grep/diff チェックを、**テスト付きの決定論 sensor** に昇格したもの。
レビュー時（観点別 3 体）・コミット時（lefthook）に偏っている検証を、より早い段階に寄せる（shift-left）。

> **advisory（非強制）**。hard stop は従来どおり lefthook + CI。sensor は早期警告。

## 同梱 sensor（発火条件の正本は `sensors.manifest.json`）

| id | glob | 検出 |
|---|---|---|
| `tier-tripwire` | `**`（実条件は tier-triggers.json） | Tier 1 要素への新規追加行 × 宣言 tier 2/3 → 昇格再宣言の勧告 |
| `codekb-refs` | `docs/ai-dlc/codekb/**.md` | codekb の `参照:` パス切れ |
| `spec-sections` | `docs/spec/**.md` | spec 必須節の充足: index = AC 番号 / テスト戦略 / 対象外・レイヤー .md = 担保 AC / テストケース / 異常系・表示層（`ui.md`）= レスポンシブ節（_TEMPLATE / progress / questions は対象外） |
| `learnings-format` | `docs/ai-dlc/learnings.md` | 学びセクション entry 行の書式（日付 / カテゴリ / 還流先 / 出典の欠落） |
| `secret-scan` | `**/*` | commit 時 lefthook gitleaks に**委譲**（`delegate` エントリ = 機械処理の対象外） |

- **manifest 駆動**: dispatch は `sensors.manifest.json` の glob で発火 sensor を解決する。
  manifest の id ↔ dispatch 実装レジストリは**起動時に双方向突合**され、未知 id・宣言漏れ・重複は
  loud error（非 0 exit）で落ちる（設定破損を silent skip しない）。sensor 実行の失敗（読込不可等）は
  無音スキップ（fail-open・advisory）。

各 sensor は誤検知を避ける工夫（文字列/コメント除外・抑制コメント等）を実装内に持つ。詳細は各 sensor 実装と `sensors.manifest.json` の knownGaps。

## 使い方

```bash
# 単一/複数のファイルを走査（advisory・exit 0）
pnpm -C .claude/aidlc sensor path/to/migration.sql

# staged なファイルを一括（self-review / コミット前の手動チェックに）
pnpm -C .claude/aidlc sensor $(git diff --cached --name-only -- '*.sql')

# 指摘があれば exit 1（CI やフックでゲートしたい時）
pnpm -C .claude/aidlc sensor --strict <file>

# テスト（検出器の決定論検証）
pnpm -C .claude/aidlc test
```

## 自分の sensor を足す

プロジェクト固有のルールを機械化したい場合は、`src/sensors/` に純粋関数（テキスト → Finding[]）を実装し、
`sensors.manifest.json` に id + glob を登録して dispatch のレジストリに追加する（双方向突合が通ること）。
同梱の汎用 sensor（`spec-sections` / `codekb-refs` / `learnings-format` / `tier-tripwire`）が「純粋関数 → Finding[]」の実装例。各 sensor の既知の限界は `sensors.manifest.json` の knownGaps に記す。
