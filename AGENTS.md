# AGENTS.md

このファイルは `orbit` プロジェクト向けの Codex 等（Claude Code 以外の AI）の入口です。

## プロジェクトの現在地

`orbit` は、Cloudflare Workers 上で動かす個人用プロジェクト管理アプリです。現在は
要件定義（[`REQUIREMENTS.md`](./REQUIREMENTS.md)）と AI-DLC 開発ハーネスの導入段階であり、
アプリ本体の実装・ルートのビルドコマンド・テストコマンドはまだ定義していません。

実装予定の技術構成とレイヤー境界は [`docs/architecture.md`](./docs/architecture.md) に、
AI-DLC を Codex で運用する際のホスト差分は [`docs/ai-dlc/codex-adapter.md`](./docs/ai-dlc/codex-adapter.md) にまとめています。

共通遵守事項は Claude Code 向けの [`CLAUDE.md`](./CLAUDE.md) と同一です。あわせて次を参照してください。

- ハーネスの全体像・使い方: [`.claude/README.md`](./.claude/README.md)
- Codex の実行アダプタ: [`docs/ai-dlc/codex-adapter.md`](./docs/ai-dlc/codex-adapter.md)
- AI-DLC フロー（実装の進め方）: [`.claude/skills/ai-dlc-flow/SKILL.md`](./.claude/skills/ai-dlc-flow/SKILL.md)
- 横断ルール（実装着手前に必読・`.claude/rules/` が正）: [`risk-tiers`](./.claude/rules/risk-tiers.md) / [`spec-driven`](./.claude/rules/spec-driven.md) / [`simplicity`](./.claude/rules/simplicity.md) / [`testing`](./.claude/rules/testing.md) / [`task-and-pr`](./.claude/rules/task-and-pr.md) の 5 本
- 用語の正本: [`docs/ai-dlc/glossary.md`](./docs/ai-dlc/glossary.md)

> 設計規約（レイヤー境界・セキュリティ・エラー/ログ・非同期など）はプロジェクト固有。必要なら各プロジェクトが `.claude/rules/` に追加する（このハーネスは AI-DLC のフロー機構のみを同梱する）。

## 基本姿勢

- まず `REQUIREMENTS.md` と `docs/architecture.md` を読み、未確定の実装方針を推測で確定しない。
- 仕様が不足・曖昧な場合は、実装前に必ず人間へ確認する。推測で埋めない。
- 変更コストが高い判断（スキーマ・API 仕様・認証フロー・ロール体系・データ境界）は、実装前に人間と合意する。
- 人間ゲート（Gate 1 / Gate 2 / Gate 3）の承認とレビューは人間が担う。
