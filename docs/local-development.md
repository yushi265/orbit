# ローカル利用手順

OrbitをPC内で動かし、ブラウザから使うモードです。Cloudflareのローカル実行ツールとローカルD1を使います。CloudflareアカウントやAccessログインは不要です。通常は同じPC内限定です。`--lan`指定時は同じLANの端末から同じローカルデータを利用できます。クラウド版や端末ごとのDBとの同期は行いません。

## 初期化・起動・停止

Node 24と`package.json`の`packageManager`指定のpnpmを用意します。初回のパッケージ導入にはネットワークが必要です。初期実装の確認対象はmacOSで、Windows / Linuxは未検証です。

リポジトリルートで実行します。

```bash
pnpm install --frozen-lockfile
pnpm local:setup
pnpm local:start
```

ブラウザで`http://127.0.0.1:3000`を開きます。`localhost`や別ポートではなく、このURLを使ってください。初回は空のIssue / Projectから始まり、固定Owner `local-owner`（初期表示名`Orbit User`）と既定Workflow等が用意されます。`local:setup`の再実行は不足分だけを初期化し、既存データをリセットしません。

停止は起動したターミナルでCtrl+Cを押し、コマンドの終了を待ちます。Manual Runはサーバー停止中には進みません。再起動後はSettingsでRun状態を確認してください。

初期化・起動は専用の`wrangler.local.jsonc`を使い、Cloudflare資格情報やproduction環境選択を子プロセスへ引き継ぎません。`.env`の自動読込も無効です。リポジトリに`.dev.vars`または`.dev.vars.*`がある場合は初期化・起動を拒否するため、必要なファイルをリポジトリ外へ退避してから実行してください。

`pnpm dev`は画面開発用のMemory Storeです。再起動すると変更が消えるため、日常利用では`pnpm local:start`を使います。`APP_ENV=production`への変更はローカル永続化の設定方法ではありません。

## 同じネットワークの端末から使う

```bash
pnpm local:start -- --lan
```

起動ログに表示されるLAN URLを、同じWi-Fi / LANの端末で開きます。サーバーは0.0.0.0:3000で待ち受け、起動時に検出したRFC1918のIPv4アドレスだけをAPIの接続先として許可します。このPC自身からは従来の`http://127.0.0.1:3000`も使えます。

LANからの利用者もログインなしで同じ固定Ownerのデータを読み書きします。更新リクエストのOriginは、開いているURLと一致する必要があります。VPNのCGNATアドレス・public IP・IPv6・任意ホスト名は自動追加しません。

IPアドレスや接続ネットワークが変わったら停止して再起動し、新しいURLを使用してください。起動元PCのスリープ・停止中はアクセスできません。別端末から接続できない場合は、同じLANにいることと、ルーターの端末間通信制限・PCの受信設定を確認してください。専用CLIはそれらの設定を変更しません。

## 保存先

既定の保存先はリポジトリルートの`.orbit/local`です。Git管理対象外です。変更する場合、初期化・起動・バックアップのすべてで同じ絶対パスを指定します。相対パスは受け付けません。

```bash
export ORBIT_LOCAL_DATA_DIR="/absolute/path/to/orbit-data"
pnpm local:setup
pnpm local:start
```

保存先を変更すると、元の保存先のデータは自動移動されません。移す場合はバックアップ・復元を使ってください。DBファイル単体や内部ファイル名に依存せず、保存ルート全体を管理します。

## バックアップ・復元

先に`local:start`を停止します。専用CLIは同じ保存先への並行操作を拒否しますが、CLI外で直接起動したVite / WranglerやDB利用プロセスも利用者が停止してください。

まだ存在しないバックアップ先を指定します。保存先とバックアップ先・復元先を同一パスや親子関係にはできません。

```bash
pnpm local:backup -- /absolute/path/to/orbit-backup
```

バックアップ先には`state/`（永続状態全体）と`manifest.json`（作成日時・Git revision / 未コミット変更の有無・Node / pnpm / Wrangler / Pluginの版・lockfileハッシュ・状態のチェックサム）を保存します。復元時にはこのバックアップ先を指定してください。業務データが入っているため、自分で管理できる場所へ保存してください。

復元にはバックアップ時と同じコード・ツール版を用意し、空の別保存先を指定します。復元先は未作成でも構いません。CLIはGit revision、Node / pnpm / Wrangler / Pluginの版、lockfileハッシュと状態のチェックサムを照合し、不一致を拒否します。未コミットのコード差分自体はバックアップに含まれないため、変更がある場合は別途保管して同じ状態を用意してください。既存データへの上書きは行いません。

```bash
pnpm local:restore -- /absolute/path/to/orbit-backup /absolute/path/to/orbit-restored
export ORBIT_LOCAL_DATA_DIR="/absolute/path/to/orbit-restored"
pnpm local:start
```

復元後はIssue・Project・各設定とRun状態を確認し、更新・再読込ができることを確認します。元の保存先は復元確認が済むまで保持してください。

## 更新するとき

1. サーバーを停止し、更新前のバックアップを取得する。
2. コード・依存を更新する（`pnpm install --frozen-lockfile`）。
3. 同じ保存先を指定して`pnpm local:setup`でMigrationを適用する。
4. `pnpm local:start`で起動し、既存データとRun状態を確認する。

古いバックアップへMigrationを適用する場合は、まずバックアップ時のコード・ツール版で空の別保存先へ復元し、その後にコード・依存を更新してコピー側で実行してください。DBのdowngradeは行いません。

## 起動や保存に失敗したとき

| 状況 | 確認すること |
| --- | --- |
| 未初期化と表示される | `ORBIT_LOCAL_DATA_DIR`が初期化時と一致するか確認し、その保存先で`local:setup`を実行する |
| 3000番ポートが使用中 | 使用しているプロセスを確認し停止する。別ポートへの自動切り替えはしない |
| 保存先が使用中 | 同じ保存先を使うOrbit / DBプロセスを停止する。動作中の排他を解除しない |
| `.dev.vars`が検出される | リポジトリ直下の`.dev.vars` / `.dev.vars.*`をリポジトリ外へ退避する |
| バックアップの版・チェックサム不一致 | `manifest.json`を確認して同じコード・ツール版を用意する。破損時は別の正常なバックアップを使う |
| 設定矛盾・接続元エラー | 専用コマンドと`http://127.0.0.1:3000`または`--lan`起動ログのURLを使っているか、他環境の設定を混在させていないか確認する |
| 権限・空き容量・DBエラー | エラーの工程を確認し、保存先の権限と空き容量を確認する。DBを削除してやり直さず、停止後に既知のバックアップから別保存先へ復元する |
| 復元先が空でない | 新しい空のディレクトリを指定する |

異常終了後に「保存先は使用中です」が残る場合、排他用ディレクトリは実体パスに対する`<保存先>.lock`です。既定保存先なら`.orbit/local.lock`で、内部の`owner.json`にPIDと開始日時があります。該当操作とその子プロセスを含むOrbit / Vite / Wrangler / workerdがすべて停止済みと確認できた場合だけ、その残存lockディレクトリを削除して再実行します。操作中や停止を確認できない状態でlockを削除しないでください。バックアップ・復元はコピー元とコピー先にも同じ方式のlockを使います。

localではDB欠落・破損・保存失敗時にMemory Storeへ切り替えません。失敗した操作が保存済みとみなされないよう、エラー解消後に画面を再読込して状態を確認します。

## 開発時の検証

```bash
pnpm test:local
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm build
```

`test:local`は一時DBを使うローカル結合検証です。通信遮断・外部通信試行の有無・画面レイアウトの実測は、単体テストだけでは保証しません。受入条件と未確認範囲は[実装spec](./spec/FEAT-local-only/index.md)を参照してください。
