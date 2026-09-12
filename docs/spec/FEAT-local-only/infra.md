# ローカル専用動作: 起動・運用計画

本書は2026-09-08の実装指示に基づく契約。以下のコマンドは実装済み。検証結果と制約は[verification.md](./verification.md)を参照。

2026-09-12追加の`--lan`起動オプションと待受・接続URLは[LAN拡張契約](./lan.md)を優先する。通常起動のloopback制限は維持する。

## 担保 AC（引用文）

- **AC-1**: 依存導入後、Cloudflare資格情報と外部通信がなくても、ローカルDB初期化・起動・画面表示・Bootstrap取得が成功する。
- **AC-6**: 停止中に作成したバックアップから別の空の保存先へ復元でき、業務データとRun内部状態が一致する。
- **AC-7**: クリーンなブラウザと外部通信遮断環境で、主要画面・CRUD・検索・Inbox・Manual Runが動作し、アプリと起動ツールから外部通信を試みない。
- **AC-8**: ローカル用コマンドは明示した同一保存先だけを使い、remote操作を含まず、既存の開発Memory Storeとproduction認証・保存のテストが通る。

## 公開するコマンド・設定案

| コマンド | 用途 |
|---|---|
| `pnpm local:setup` | ローカルMigrationと固定Ownerの初期登録 |
| `pnpm local:start` | 初期化済みDBを使ってloopbackで起動 |
| `pnpm local:backup -- <新規バックアップ先>` | 停止中の状態全体と版情報を保存 |
| `pnpm local:restore -- <バックアップ元> <空の復元先>` | 上書きなしで復元 |
| `pnpm test:local` | 一時DBでCLI・実D1・再起動の結合テスト |

`local:start`は依存導入・DBリセット・remoteアクセスを暗黙実行しない。既存`pnpm dev`のMemory Storeモードは維持する。最初の利用者向け手順は`pnpm install --frozen-lockfile`→`pnpm local:setup`→`pnpm local:start`とする。初期実装の対応確認対象は現在のmacOS / Node 24 / packageManager指定pnpm。Windows / Linuxを未検証で対応済みとしない。

| 設定 | 設定値・責務 |
|---|---|
| `wrangler.local.jsonc` | 追加。クラウドDB ID・account ID・remote Bindingを含まない専用設定 |
| Worker名 / D1名 / Binding | `orbit-local` / `orbit-local` / `DB` |
| APP_ENV / ORBIT_STORAGE | `local` / `d1` |
| `ORBIT_LOCAL_DATA_DIR` | 既定はリポジトリルート基準`.orbit/local`。指定時は絶対パスを要求する |
| 永続化先 | 上記を絶対パスへ解決し、Plugin `persistState`とWrangler `--persist-to`に同じ値を渡す |
| HTTP | `127.0.0.1:3000`固定、strictPort。ポート変更は本計画の初期範囲外 |
| Inspector | localでPlugin `inspectorPort: false`。補助ポートも外部待受がないことを確認 |

保存先はbuild成果物・一時ディレクトリから分離する。`.gitignore`に`.orbit/`を追加する。内部SQLiteファイル名をアプリの公開契約にせず、保存ルート全体を管理する。

`scripts/local.mjs`からインストール済みCLIを`execFile` / `spawn`の引数配列で呼ぶ。local用Migration・Owner登録は必ず`--local`、専用`--config`、同一`--persist-to`を指定する。既存`db:migrate`とproduction bootstrapはremote固定のため流用しない。

Viteでは専用設定を`cloudflare({ configPath, persistState, inspectorPort: false, ... })`へ渡す。local用起動からproduction環境選択や資格情報を継承せず、`.dev.vars`等の暗黙読込と環境上書きも検査する。ローカルDBの設定形式は導入済みWrangler schemaで検証する。

local専用設定にはリモート接続指定・Service Binding・ログ転送・トンネルを含めない。CLIのメトリクス送信を無効にし、Vite / Wrangler / TanStackの更新確認など外向き通信の有無を実測する。停止操作は親プロセスだけでなく子プロセスを終了させる。

## 実装配置とドキュメント

- `scripts/local.mjs`、CLIテスト、`wrangler.local.jsonc`を追加。
- `vite.config.ts`、`package.json`、`.gitignore`にローカル経路を追加。
- `docs/local-development.md`を追加し、初期化、保存先、停止、バックアップ、復元、更新前バックアップ、障害時確認を説明。
- READMEとdocs目次へリンク。承認された要件・architectureの変更も同じ実装に含める。
- AGENTS / Codex adapter / READMEに残る「未実装」記述は別のハーネス整理対象として記録し、本計画文書だけで変更しない。

## 異常系挙動

未初期化、使用中port、設定矛盾、保存先権限不足は工程名を示して非ゼロ終了する。別portへ自動移動しない。バックアップ前に運用プロセスの停止を要求し、同じ保存先に対する並行setup / start / backup / restoreを専用CLIの排他で拒否する。CLI外で直接起動したDBプロセスも停止が必要であることを手順に明示する。

外部通信を抑止できないツール動作が見つかった場合、通信失敗を無視してAC合格にせず、設定・起動方法を修正する。対応不可能なら実装方式の未決事項として再提示する。

## テストケースと実測手順

- [デシジョンテーブル] 全CLIの引数にremoteが含まれず、setup / start / backupで同じ絶対保存先を使用する。production環境変数がある場合も専用設定を維持または明示拒否する。
- [同値分割] 別cwd / 絶対パス上書き / 不正な相対パス / 空白を含むパスで保存先解決を検証する。
- [状態遷移] setup→start→API書込→停止→start→API再取得。起動中に同一保存先の別CLI操作を拒否する。
- [同値分割] port使用中、未初期化、書込不可、バックアップ失敗、非空の復元先でデータを維持し非ゼロ終了する。
- [代表値] 空のWranglerユーザー設定と資格情報を除いた環境で、事前導入済みパッケージのみを使い初期化・起動できる。
- [代表値] OSレベルまたは隔離環境でloopbackを許可し外向き通信を拒否・記録する。アプリだけでなく子プロセス・DNSを対象にし、ブラウザ単独のoffline指定で代用しない。
- [状態遷移] 遮断前のキャッシュに依存しないよう、新しいブラウザプロファイル・未起動サーバーから開始する。setup、cold start、全主要画面、CRUD、Manual Run、再起動を実行する。
- [代表値] サーバーと子プロセスの通信ログ、およびブラウザのNetworkログに外部通信試行がないことを確認する。ブラウザ自身の更新・拡張機能通信とは切り分け、アプリ由来の通信を除外しない。
- [代表値] バックアップから空の別保存先へ復元し、コード / ツール版を揃えてデータ・Run状態・更新可能性を確認する。

証跡には実行コマンド、ツール版、遮断方式、対象画面・操作、再起動前後の比較、外部通信試行件数を記録する。環境上遮断や観測ができない場合は未検証とし、AC-1 / AC-7を完了扱いにしない。
