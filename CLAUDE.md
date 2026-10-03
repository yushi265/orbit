# CLAUDE.md

## 目的

このファイルは `orbit` プロジェクト向けの Claude Code アダプタ（オーケストレーター）です。
詳細ルールはここに重複転記せず、`.claude/rules/*.md` と `docs/` で辿ります。

プロジェクトの要件は [`docs/requirements/index.md`](./docs/requirements/index.md)、実装予定の構成は
[`docs/architecture.md`](./docs/architecture.md)、Codex での運用差分は
[`docs/ai-dlc/codex-adapter.md`](./docs/ai-dlc/codex-adapter.md) を参照してください。

ハーネスの全体像と使い方は [`.claude/README.md`](./.claude/README.md) を参照してください。
機能実装・修正は AI-DLC フロー（[`.claude/skills/ai-dlc-flow/SKILL.md`](./.claude/skills/ai-dlc-flow/SKILL.md)）に従います。

## クイックリファレンス

セットアップ手順・想定スタックの詳細は [`README.md`](./README.md) を参照。以下は `package.json` の scripts（正本）から頻用するもの。

```bash
pnpm install && pnpm dev              # 開発サーバー
pnpm test                             # 全テスト（vitest run）
pnpm exec vitest run <path>           # 単一ファイルのテスト
pnpm exec vitest run -t "<name>"      # テスト名で絞り込み
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build  # コミット前の品質ゲート
```

D1/Drizzle 関連コマンド（`db:generate` / `db:migrate` 等）は `package.json` の scripts を参照。

レイヤーと配置（詳細・依存方向は [`docs/architecture.md`](./docs/architecture.md)）:

| レイヤー | 配置 | 責務 |
|---|---|---|
| ui | `src/routes/` `src/components/` | 画面描画・入力受付・URL 状態。D1 Binding へ直接アクセスしない |
| service | `src/server/` | Server Functions・API Routes・認証/認可・ドメイン処理 |
| data | `src/db/` `drizzle/` | Drizzle Schema・Migration・Repository |
| shared | `src/shared/` | ui/service 間の共有契約（Zod スキーマ・エラー Envelope・公開型） |

## 参照順序

実装着手前に、関連する範囲を次の順で参照する。

1. [`docs/index.md`](./docs/index.md)（ドキュメント目次）
2. [`docs/requirements/index.md`](./docs/requirements/index.md)（プロダクト要件・受入条件）
3. [`docs/architecture.md`](./docs/architecture.md)（全体構成・レイヤー責務・依存方向）／[`docs/ai-dlc/glossary.md`](./docs/ai-dlc/glossary.md)（AI-DLC 用語の正本）
4. 対象レイヤーの入口ドキュメントと docs（実装開始後に整備）
5. タスクにチケット番号が紐づく場合は `docs/spec/<TICKET>-*/`（薄い実装 spec）

## 作業ルール（`.claude/rules/` が正）

実装着手前に、関連するルールを読むこと。

- [`risk-tiers.md`](./.claude/rules/risk-tiers.md) — リスクティア判定。人間ゲートの深さと spec 要否を決める
- [`spec-driven.md`](./.claude/rules/spec-driven.md) — 実装前に spec を必読。不足/曖昧なら人間へ確認
- [`simplicity.md`](./.claude/rules/simplicity.md) — シンプルさ最優先（KISS/YAGNI・Rule of Three）
- [`testing.md`](./.claude/rules/testing.md) — TDD・カバレッジ 80%+・技法マッピング
- [`task-and-pr.md`](./.claude/rules/task-and-pr.md) — タスク分割・品質ゲート・PR/コミット規約

> 設計規約（レイヤー境界・セキュリティ・エラー/ログ・非同期など）はプロジェクト固有。必要なら各プロジェクトが `.claude/rules/` に追加する（このハーネスは AI-DLC のフロー機構のみを同梱する）。

## 基本姿勢

- このファイルは薄く保つ。詳細ルールを重複記載しない。
- 仕様が不足・曖昧な場合は、実装前に必ず人間へ確認する。
- 推測でドキュメント/実装を書かない。既存コード・関連ドキュメントで裏付けを取る。
- 「将来のため」だけで複雑さを足さない（YAGNI）。
- 変更コストが高い判断（スキーマ・API 仕様・認証フロー・ロール体系・データ境界）は、実装前に人間と合意する。

> レイヤー名（例: `data` / `service` / `ui`）はスタック非依存の例です。プロジェクトのレイヤー構成に合わせて置き換えてください。

## 役割分担

- AI（Claude Code / Codex 等）: 依頼に応じて調査/設計、実装、テスト、レビュー、PR 作成、指摘修正を担う。共通遵守事項は本書と [`AGENTS.md`](./AGENTS.md)。
- AI 内部は**オーケストレーター型**: 上位モデル（メインループ）が割り振り・契約確定・監査を担い、下位モデル（worker 層）が実装・調査・レビュー実働を実行して返す。レビュー報告もオーケストレーターが監査してから採用する（正本は [ai-dlc-flow](./.claude/skills/ai-dlc-flow/SKILL.md) の「モデル階層」節）。
- 人間: ゲート承認（Gate 1 / Gate 2 / Gate 3）とレビュー。
