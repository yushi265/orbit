# orbit

Linearライクな個人用プロジェクト管理アプリです。要件定義は
[`docs/requirements/index.md`](./docs/requirements/index.md) にまとめています。

現在は要件定義と AI-DLC 開発ハーネスの導入段階です。アプリ本体はこれから実装します。

## 想定スタック

要件定義で採用予定としている構成は次のとおりです。実装時に変更した場合は
[`docs/architecture.md`](./docs/architecture.md) と
[`docs/requirements/04-architecture.md`](./docs/requirements/04-architecture.md) を更新します。

- TanStack Start + React
- Cloudflare Workers / Vite Plugin
- Cloudflare D1 + Drizzle ORM
- Tailwind CSS + shadcn/ui
- TanStack Query / TanStack Form / Zod
- Vitest + Playwright

## AI 開発の入口

- Claude Code は [`CLAUDE.md`](./CLAUDE.md)、Codex は [`AGENTS.md`](./AGENTS.md) から開始してください。
- AI-DLC の正本は [`.claude/skills/ai-dlc-flow/SKILL.md`](./.claude/skills/ai-dlc-flow/SKILL.md) と [`.claude/rules/`](./.claude/rules/) です。
- Codex の hooks・agent 定義は [`.codex/`](./.codex/) にあります。
- Codex での Stage、Gate、レビュー、検証の扱いは [`docs/ai-dlc/codex-adapter.md`](./docs/ai-dlc/codex-adapter.md) を参照してください。

## AI-DLC エンジンのセットアップ

アプリ本体の依存関係とは独立した、AI-DLC の検査エンジンです。導入は任意ですが、
Codex で engine の状態・drift・referee を使う場合は実行してください。

```bash
pnpm -C .claude/aidlc install --ignore-workspace
pnpm -C .claude/aidlc run doctor -- --fast
pnpm -C .claude/aidlc test
pnpm -C .claude/aidlc typecheck
```

ルートのアプリ実装が始まるまでは、アプリの lint・format・test コマンドは未設定です。
設定後は `.claude/aidlc/referee.config.json` と `lefthook.yml` に反映します。

## ドキュメント

| ドキュメント | 内容 |
|------------|------|
| [`docs/requirements/index.md`](./docs/requirements/index.md) | プロダクト要件・受入条件・技術選定の入口 |
| [`.claude/README.md`](./.claude/README.md) | ハーネス取扱説明書（運用・構成・機械強制・導入手順） |
| [`docs/ai-dlc-flow-guide.md`](./docs/ai-dlc-flow-guide.md) | AI-DLC フローの解説（承認ゲート・KPT・FAQ） |
| [`docs/ai-dlc/codex-adapter.md`](./docs/ai-dlc/codex-adapter.md) | CodexでのStage・Gate・worker・検証の運用 |
| [`docs/ai-dlc/glossary.md`](./docs/ai-dlc/glossary.md) | 用語の正本（ビジネスインテント / BC / ユニット / ボルト / ステージ / ゲート / Tier / SSoT） |
| [`docs/harness-design-decisions.md`](./docs/harness-design-decisions.md) | ハーネスの設計判断・代替案・やらないこと |
