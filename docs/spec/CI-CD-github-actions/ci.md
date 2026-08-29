# CI-CD: CI / 運用詳細

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: PR作成・更新時と`main`へのpush時にGitHub ActionsのCIが起動し、`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm run build:production`の全品質ゲートを実行する。
- **AC-2**: CIはリポジトリの`packageManager`に定義されたpnpm 11.18.0とNode.js 24を使用し、`pnpm install --frozen-lockfile`で依存関係を再現可能に導入する。依存キャッシュは`pnpm-lock.yaml`の変更をキーに無効化される。
- **AC-3**: CIはGitleaks v3でGit履歴全体を検査し、検出時にジョブを失敗させる。GitHub Actionsの権限は`contents: read`に限定し、Secret値・検出結果ファイルを外部コメントやArtifactへアップロードしない。
- **AC-4**: CDの正本は既存のCloudflare Workers Buildsとし、`main`へのpushを本番ビルド・デプロイへ接続する。Cloudflare側のビルドは`pnpm run build:production`、デプロイは`npx wrangler deploy`とし、非本番ブランチのBuildはstaging用D1を用意するまで無効とする。
- **AC-5**: CIワークフローのトリガー、権限、品質ゲート、Secret検知、Cloudflareデプロイ非実行がローカルの契約テストで検査できる。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|------|------------|-------------------|-------------------|------|
| CI起動 | `.github/workflows/ci.yml` `pull_request` | PRの作成・更新で起動 | GitHub Actions `contents: read` | 変更検証 |
| CI起動 | `.github/workflows/ci.yml` `push.branches: [main]` | `main`へのpushで起動 | GitHub Actions `contents: read` | 本番候補検証 |
| 品質ゲート | `quality` job | Node.js 24、pnpm 11.18.0、frozen install後に5コマンドを順番に実行。checkoutのcredentialsは永続化しない | Cloudflare資格情報なし | アプリ品質検証 |
| Secret検知 | `secrets` job | checkoutは`fetch-depth: 0`、credentialsを永続化せず、Gitleaks v3の補助スキャン後に`gitleaks git --no-banner --redact`で全履歴を走査 | `contents: read`、コメント/Artifact/Summaryなし | 履歴を含むSecret検知 |
| CD | Cloudflare Workers Builds | `main` push、Build=`pnpm run build:production`、Deploy=`npx wrangler deploy` | Cloudflare側のWorkers Builds token | production Workerデプロイ |

## このレイヤーが依存する下位の契約

- `package.json`の`packageManager`、`scripts`、`pnpm-lock.yaml`に依存する。
- Cloudflare Workers Buildsの設定（Worker名`orbit`、root `/`、production branch `main`、非本番Build無効）を外部運用契約として参照する。
- D1 migrationは`pnpm run db:migrate:production`等の既存手動手順に依存し、CIワークフローからは呼び出さない。

## 実装配置

- `.github/workflows/ci.yml`: GitHub ActionsのCI定義。
- `scripts/ci-workflow.test.mjs`: CI定義の契約テスト。既存の`pnpm test`で実行する。
- `docs/deployment.md`: GitHub Actions CIとWorkers Builds CDの責務分担を記載する。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| PR / main push以外 | workflowを起動しない。Cloudflare Workers Buildsの非本番Buildも現状無効とする |
| frozen install失敗 | `pnpm install --frozen-lockfile`を失敗させ、品質ゲートへ進まない。依存更新はCIで行わない |
| 品質ゲート失敗 | `format:check`、`lint`、`typecheck`、`test`、production buildの非0終了をそのままCI failureにする |
| Secret検出 | Gitleaksの非0終了で`secrets` jobをfailureにする。コメントとArtifactを無効化し、Secret値をログへ出さない |
| Cloudflare側のデプロイ失敗 | GitHub ActionsのCI failureとは別にWorkers Buildsで確認する。GitHub Actionsは再デプロイやmigrationを行わない |

## テストケース（技法注記付き）

- [代表値] `.github/workflows/ci.yml`が存在し、`pull_request`と`main`向け`push` triggerを持つ → 契約テスト成功。
- [代表値] quality jobが`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm run build:production`をすべて含む → 契約テスト成功。
- [代表値] Node.js 24、pnpm 11.18.0、`pnpm install --frozen-lockfile`、`pnpm-lock.yaml`キャッシュ契約を含む → 契約テスト成功。
- [デシジョンテーブル] `pull_request` / `push main` = 起動、その他のpush = workflow定義上の対象外 → trigger契約を検査。
- [代表値] Gitleaks v3、`fetch-depth: 0`、`gitleaks git --no-banner --redact`、`GITLEAKS_ENABLE_COMMENTS=false`、`GITLEAKS_ENABLE_UPLOAD_ARTIFACT=false`、`contents: read` → Secret検知契約を検査。
- [禁止条件] CI workflowに`wrangler deploy`、D1 migration、Cloudflare token参照が存在しない → CD二重化・本番副作用を防止。
- [異常系] 必須契約文字列を削除したworkflow → 契約テストが失敗。
