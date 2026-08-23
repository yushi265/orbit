# ドキュメント

このプロジェクトの実装の進め方・規約・実装仕様を管理する。実装判断がこのリポジトリのドキュメントだけで完結するように整備する。

現在は要件定義と AI-DLC ハーネスの導入段階であり、アプリ本体の実装は未着手である。

## 読み始めガイド（読者別の入口）

- **新規参入者・チームメンバー（人間）**: まず [`../REQUIREMENTS.md`](../REQUIREMENTS.md) でプロダクト要件を把握 → [`architecture.md`](./architecture.md) で実装予定の構成を確認 → [`ai-dlc-flow-guide.md`](./ai-dlc-flow-guide.md) で開発フローを確認。
- **AI（Claude Code）**: ルートの [`../CLAUDE.md`](../CLAUDE.md) を入口に、必要に応じて [`../.claude/rules/`](../.claude/rules/) を参照。
- **AI（Codex）**: ルートの [`../AGENTS.md`](../AGENTS.md) と [`ai-dlc/codex-adapter.md`](./ai-dlc/codex-adapter.md) を入口にする。
- **ハーネスを見直す人・運用方法を確認する人**: [`../.claude/README.md`](../.claude/README.md)（取扱説明書・正本）と [`harness-design-decisions.md`](./harness-design-decisions.md)（設計判断の履歴）。
- **チケットに沿って実装中**: [`spec/<TICKET>-*/`](./spec/) を参照（実装の正本・契約）。

## このリポジトリのドキュメント

| ドキュメント | 概要 |
|------------|------|
| [../REQUIREMENTS.md](../REQUIREMENTS.md) | プロダクト要件・受入条件・技術選定 |
| [architecture.md](./architecture.md) | `orbit` の実装予定アーキテクチャ（レイヤー責務・依存方向） |
| [ai-dlc-flow-guide.md](./ai-dlc-flow-guide.md) | AI-DLC 開発フローの解説（チームメンバー・新規参入者向け。人間の承認ゲートの見方） |
| [ai-dlc/codex-adapter.md](./ai-dlc/codex-adapter.md) | CodexでAI-DLCを実行するためのホスト差分・委譲・検証手順 |
| [ai-dlc/glossary.md](./ai-dlc/glossary.md) | AI-DLC 用語集（ビジネスインテント / BC / ユニット / ボルト / ステージ / ゲート / Tier / SSoT）の**正本** |
| [harness-design-decisions.md](./harness-design-decisions.md) | ハーネス（`.claude/` / 各 `CLAUDE.md` / 各 `docs/`）の構成上の決定・代替案・「やらないこと」（履歴） |
| [spec/](./spec/) | チケット単位の薄い実装 spec（実装に必要な制約を要約） |
| [ai-dlc/retro/](./ai-dlc/retro/) | AI-DLC 各ユニットの振り返り学習ノート（KPT ＋ フロー改善の還流） |

## ハーネス（AI 開発のガードレール）

| 場所 | 役割 |
|------|------|
| `CLAUDE.md`（ルート・プロジェクトで用意） | Claude Code 向けアダプタ（入口・横断） |
| `AGENTS.md`（ルート・プロジェクトで用意） | Codex 等向け最小ルール |
| [`../.claude/README.md`](../.claude/README.md) | ハーネス取扱説明書 |
| [`../.claude/rules/`](../.claude/rules/) | 横断ルール（リスクティア / spec 駆動 / シンプルさ / テスト / タスク・PR） |
| [`../.claude/skills/`](../.claude/skills/) ・ [`../.claude/agents/`](../.claude/agents/) | 手順スキル ＋ 実装/評価サブエージェント |
| 各サブツリーの `CLAUDE.md` / `docs/`（プロジェクトで用意） | サブツリー分割する場合の各サブツリー入口。配下の作業はローカルルールを優先 |

## サブツリーのローカルドキュメント

プロジェクトがサブツリー（レイヤー別モジュール等）に分割する場合、各サブツリーは独自の入口（`<subtree>/CLAUDE.md`）とローカル docs（`<subtree>/docs/`）を持つ。**配下の作業はそのローカルルールを優先する。** 入口・docs はプロジェクトで用意する。
