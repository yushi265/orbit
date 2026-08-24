# orbit

Linearライクな個人用プロジェクト管理アプリです。要件定義は
[`docs/requirements/index.md`](./docs/requirements/index.md) にまとめています。

MVPの主要なIssue / Cycle / Project / View / Search / Inbox / Settings / Background Runと、TanStack Start + Cloudflare Workersの実行基盤を実装しています。

## MVPを動かす

依存関係を導入して開発サーバーを起動します。

```bash
pnpm install
pnpm dev
```

ローカル開発では `DEV_OWNER_USER_ID`（既定値 `dev-owner`）を使った明示的な開発Ownerへフォールバックします。Cloudflare Access環境では `APP_ENV=production`、`OWNER_USER_ID`、`OWNER_EMAIL`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` をWorker Secret / Environmentへ設定してください。JWTは `jose` とAccess JWKSで署名・issuer・audience・emailを検証し、失敗時はfail-closedになります。

MVPのローカルデータはWorkerの開発Storeで保持されます。D1用の正規化Schemaと初期Migration、Owner / Issue Repositoryの基盤は `src/db/` と `drizzle/` に含まれています。本番デプロイの進捗と残タスクは [`docs/deployment.md`](./docs/deployment.md) を参照してください。現時点では、本番Data adapter、Cloudflare AccessのSecret、Owner行の準備が必要です。

品質ゲート:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm build
```

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
- pnpm（Package manager）
- oxlint（Lint）
- oxfmt（Formatter）

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

ルートのアプリ実装が始まるまでは、アプリの依存関係とscriptは未設定です。実装開始時はpnpmで依存を導入し、次のscriptを`package.json`へ定義します。

```bash
pnpm add -D oxlint oxfmt
pnpm lint          # oxlint
pnpm format        # oxfmt
pnpm format:check  # oxfmt --check
pnpm test
```

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
