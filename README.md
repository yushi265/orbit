# orbit

Linearライクな個人用プロジェクト管理アプリです。要件定義は
[`docs/requirements/index.md`](./docs/requirements/index.md) にまとめています。

MVPの主要なIssue / Cycle / Project / View / Search / Inbox / Settings / Background Runと、TanStack Start + Cloudflare Workersの実行基盤を実装しています。

## ローカルのみで使う

Node 24と`package.json`指定のpnpmを用意し、初回に依存関係を導入します。

```bash
pnpm install --frozen-lockfile
pnpm local:setup
pnpm local:start
```

`http://127.0.0.1:3000`を開きます。ローカル専用モードはCloudflareへのログインなしで固定Ownerを使い、データを`.orbit/local`のローカルD1へ保存します。初回はデモIssueを作りません。停止は起動したターミナルでCtrl+Cを押します。

既存の`.dev.vars` / `.dev.vars.*`がある場合はリポジトリ外へ退避してください。ローカル専用コマンドはこれらの暗黙読込を拒否します。

保存先の変更、バックアップ・復元、更新時の手順と確認範囲は[ローカル利用手順](./docs/local-development.md)を参照してください。依存導入にはネットワークが必要です。通常は同じPC内限定です。同じLANの端末から利用する場合は`pnpm local:start -- --lan`で起動し、表示されたLAN URLを開きます。LANの利用者も同じ固定Ownerのデータを操作します。

## 開発・クラウド運用

画面開発用の`pnpm dev`は従来どおりMemory Storeと開発Owner（既定値`dev-owner`）を使います。再起動でデータが消えるため、継続利用には`pnpm local:start`を使ってください。

クラウド運用は`APP_ENV=production`でCloudflare Access JWTとDB Ownerを照合し、D1 Snapshotへ保存します。必要なSecret、Migration、Owner登録は[本番デプロイ手順](./docs/deployment.md)を参照してください。

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
| [`docs/local-development.md`](./docs/local-development.md) | ローカル専用の初期化・起動・停止・バックアップ・復元 |
| [`docs/requirements/index.md`](./docs/requirements/index.md) | プロダクト要件・受入条件・技術選定の入口 |
| [`.claude/README.md`](./.claude/README.md) | ハーネス取扱説明書（運用・構成・機械強制・導入手順） |
| [`docs/ai-dlc-flow-guide.md`](./docs/ai-dlc-flow-guide.md) | AI-DLC フローの解説（承認ゲート・KPT・FAQ） |
| [`docs/ai-dlc/codex-adapter.md`](./docs/ai-dlc/codex-adapter.md) | CodexでのStage・Gate・worker・検証の運用 |
| [`docs/ai-dlc/glossary.md`](./docs/ai-dlc/glossary.md) | 用語の正本（ビジネスインテント / BC / ユニット / ボルト / ステージ / ゲート / Tier / SSoT） |
| [`docs/harness-design-decisions.md`](./docs/harness-design-decisions.md) | ハーネスの設計判断・代替案・やらないこと |
