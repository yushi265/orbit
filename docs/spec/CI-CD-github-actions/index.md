# CI-CD: CI/CDパイプライン整備

> GitHub Actions の CI と Cloudflare Workers Builds の CD の責務を明確にし、PR と本番ブランチの変更を同じ品質ゲートで検証できるようにする。

## 概要

GitHub Actions でアプリケーションの品質ゲートと Secret 検知を自動実行する。
本番デプロイは既存の Cloudflare Workers Builds に委ね、GitHub Actions からの二重デプロイは行わない。

## 対象範囲

- 対象レイヤー: [CI / 運用詳細](./ci.md)
- 対象ドメイン: 開発者向け品質ゲート、Workers のリリース運用
- 対象外（やらないこと）: GitHub Actions からの本番デプロイ、GitHub のBranch protection変更、D1 remote migrationの自動実行、本番Secretの作成・移送、staging用D1・非本番Preview環境の新設、コミット・push

## ユニット計画

単一ユニット（GitHub Actions CI と Cloudflare Workers Builds CD の責務分担）。

| # | ユニット | 含む AC | 依存 | 状態 |
|---|---------|--------|------|------|
| 1 | CI/CDパイプライン整備 | AC-1〜AC-5 | — | 完了 |

## 受け入れ基準（AC）

- [x] **AC-1**: PR作成・更新時と`main`へのpush時にGitHub ActionsのCIが起動し、`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm run build:production`の全品質ゲートを実行する。
- [x] **AC-2**: CIはリポジトリの`packageManager`に定義されたpnpm 11.18.0とNode.js 24を使用し、`pnpm install --frozen-lockfile`で依存関係を再現可能に導入する。依存キャッシュは`pnpm-lock.yaml`の変更をキーに無効化される。
- [x] **AC-3**: CIはGitleaks v3でGit履歴全体を検査し、検出時にジョブを失敗させる。GitHub Actionsの権限は`contents: read`に限定し、Secret値・検出結果ファイルを外部コメントやArtifactへアップロードしない。
- [x] **AC-4**: CDの正本は既存のCloudflare Workers Buildsとし、`main`へのpushを本番ビルド・デプロイへ接続する。Cloudflare側のビルドは`pnpm run build:production`、デプロイは`npx wrangler deploy`とし、非本番ブランチのBuildはstaging用D1を用意するまで無効とする。
- [x] **AC-5**: CIワークフローのトリガー、権限、品質ゲート、Secret検知、Cloudflareデプロイ非実行がローカルの契約テストで検査できる。

## アーキテクチャ / レイヤー間フロー

```text
PR / main push
      │
      ├── GitHub Actions CI
      │     ├── checkout
      │     ├── pnpm 11.18.0 + Node.js 24
      │     ├── frozen install
      │     ├── format / lint / typecheck / test / production build
      │     └── Gitleaks（履歴全体）
      │
      └── main push のみ: Cloudflare Workers Builds CD
            ├── pnpm run build:production
            └── npx wrangler deploy
```

GitHub Actions は品質検証だけを担い、Cloudflare Workers Builds が本番Workerのビルド・デプロイを担う。D1 migrationは本番データを変更するため、既存の手動手順で実施する。

## エラー・ログ方針（横断サマリ）

| シナリオ | CI / 運用レイヤー | 表示層の挙動 |
|---|---|---|
| 依存導入失敗 | `pnpm install --frozen-lockfile`の非0終了でCI失敗。lockfile更新を要求 | GitHub Actionsの失敗ログを表示 |
| 品質ゲート失敗 | 該当コマンドの非0終了でCI失敗。後続の同一job stepは実行しない | GitHubのチェックを失敗表示 |
| Secret検出 | Gitleaksが非0終了。Secret値・SARIF/Artifactは外部へ出さない | GitHubのSecret scanジョブを失敗表示 |
| Workers Buildsの失敗 | GitHub Actionsとは別のCloudflare Build結果として扱う。D1 migrationは自動再試行しない | Cloudflare Buildログで原因確認 |
| 外部サービス停止 | GitHub Actions / Cloudflareの実行結果を失敗として扱い、ローカルの成功とは分離 | 再実行または手動手順へ誘導 |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|----|------|--------------|
| AC-1 | `scripts/ci-workflow.test.mjs`でworkflowのトリガーとコマンドを検査 | GitHub Actions実行は外部環境のためローカル対象外 |
| AC-2 | `scripts/ci-workflow.test.mjs`でNode/pnpm/frozen install/cache契約を検査 | GitHub runner上の実行はpush後に確認 |
| AC-3 | `scripts/ci-workflow.test.mjs`でGitleaks設定・権限・出力抑止を検査 | Gitleaks実行はGitHub runner上で確認 |
| AC-4 | `scripts/ci-workflow.test.mjs`と`docs/deployment.md`の契約を検査 | Workers Buildsの実デプロイは外部環境で確認 |
| AC-5 | `scripts/ci-workflow.test.mjs` | — |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `package.json`の既存品質ゲート、`pnpm-lock.yaml`、`wrangler.jsonc`、`docs/deployment.md`、`.claude/aidlc/referee.config.json`、`lefthook.yml`。
- 差分: GitHub ActionsのCIワークフローと、その契約を検査する`scripts/ci-workflow.test.mjs`を新設する。
- 衝突回避: Cloudflare Workers Buildsが既に`main`のCDを担うため、GitHub Actionsには`wrangler deploy`とD1 migrationを追加しない。
- 既存の作業ツリー変更（`CLAUDE.md`）は対象外として保持する。

## 実装に効く制約

- GitHub Actionsの権限は最小権限の`contents: read`にする。
- checkoutでGitHub tokenをgit設定へ永続化しない。
- CIでは本番Secret、Cloudflare API token、D1データを扱わない。
- `pnpm-lock.yaml`を無視した依存導入や、CI内での依存関係更新を行わない。
- Cloudflare Vite Pluginのproduction環境選択はビルド時の`CLOUDFLARE_ENV=production`に依存するため、CIとWorkers Buildsのproduction buildコマンドを`pnpm run build:production`へ統一する。
- 非本番ブランチPreviewは、本番D1を参照する構成を避けるため有効化しない。
- 既存のD1 migration・Owner bootstrap・Access Secret登録の順序は変更しない。

## 判断根拠 / 未決事項

- CIとCDを分離する。Cloudflare Workers Buildsの接続・API token・本番デプロイは既に設定済みであり、GitHub Actionsにもデプロイ権限を持たせるとSecretと実行経路が二重化するため。
- `build:production`をCIとWorkers Buildsで共有する。通常の`pnpm run build`はトップレベルの開発環境を選択し得るため、実際にデプロイされるproduction artifactをCIで検査する。
- GitleaksはGitHub公式Actionの現行v3を補助スキャンに使い、後段の`gitleaks git --no-banner --redact`を最終判定にする。Actionはイベント差分を補助的に確認し、後段を必ず実行するため`continue-on-error: true`とする。コメント・Artifact・Summaryを無効化し、Secret値の外部露出を避けつつ既存のpre-commit Gitleaks方針をCIへ移すため。
- D1 migrationの自動化は採用しない。migrationは本番データへ副作用があり、Workers BuildsのBuild tokenとアプリデプロイの責務を拡張するため。
- Branch protectionはこのユニットの対象外とした。したがって、保護設定を後から有効にするまで、`main`への直接pushではGitHub Actions CIとWorkers Builds CDが独立して起動するというトレードオフを受け入れる。
- 未決事項はない。Gate 1で「Workers BuildsをCDの正本とする」「非本番Previewを現状無効とする」「D1 migrationをCI/CDから除外する」を承認済みで、Gate 2は委任された。
