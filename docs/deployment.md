# Orbit デプロイ準備

## 現在の判定

2026-10-02に既存本番構成を読み取り専用で確認しました。

- D1: `orbit`（`53d2ce53-5326-47da-95b6-386732c50a9b`）。バックアップのコピーでOwner関連行とOwner Snapshotの存在を確認済みです。値はこの文書や検証ログに記載しません。
- Worker: `orbit`、URLは `https://orbit.ae265-1108.workers.dev`、`APP_ENV=production`、上記D1 bindingを使用します。
- 確認時の稼働Versionは `c9ba19fc-a647-46d6-ac95-ab731d536338`（2026-10-01作成）、GitHubの`15eb0eb`のWorkers Builds checkが同じVersion IDを返すことを照合しました。
- `OWNER_USER_ID` / `OWNER_EMAIL` / `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` の4つのSecret名がVersion bindingに存在します。秘密値や認証後の動作をこの確認だけで保証するものではありません。
- 未認証のルートはCloudflare Accessへ`302`になります。認証後のBootstrap `200`と主要操作は、この確認時点では未確認です。
- 本番の業務データはD1 Snapshot Adapterで永続化します。正規化Repositoryへの段階移行はRelease hardeningの残課題です。

以下のCloudflare作成・Secret登録・Owner初期化は初回構築用です。既存本番への更新時は、現在の構成を確認した上で、バックアップ検証とデプロイ手順へ進みます。

`pnpm run deploy:preflight` は、Worker名・production環境・D1 IDを検査します。開発用設定のまま本番へ送る事故を防ぐため、D1 IDが未設定の場合は失敗します。

## 1. Cloudflare側の準備

WranglerはJSONC設定を正本として扱い、Workerには`name`、`main`、`compatibility_date`が必要です。[Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)

```bash
pnpm exec wrangler login
pnpm exec wrangler whoami
pnpm exec wrangler d1 create orbit
```

`d1 create`で得た本番D1 IDを、`wrangler.jsonc`のtop-levelと`env.production.d1_databases`の両方へ設定します。IDやAccessの秘密値はGitへ保存しません。現在のD1 IDは設定済みです。

## 2. Access Secretの登録

```bash
pnpm exec wrangler secret put OWNER_USER_ID --env production
pnpm exec wrangler secret put OWNER_EMAIL --env production
pnpm exec wrangler secret put ACCESS_TEAM_DOMAIN --env production
pnpm exec wrangler secret put ACCESS_AUD --env production
```

Access Secretを登録した後、`OWNER_USER_ID`と`OWNER_EMAIL`を環境変数へ設定してOwner行を初期化します。既存行は上書きされず、必須値が不正な場合はリモートD1を実行しません。

```bash
OWNER_USER_ID=... OWNER_EMAIL=... pnpm run db:bootstrap:production
```

表示名も指定する場合は`ORBIT_OWNER_NAME`を追加します。値はshell履歴やリポジトリへ保存しないでください。

Cloudflare AccessはOriginへ`Cf-Access-Jwt-Assertion`を渡します。Worker側でもJWTの署名・issuer・audienceを検証する必要があります。[Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

## 3. PWA静的AssetのAccess設定

PWAのインストール判定はManifestとアイコンをブラウザが直接取得するため、AccessでWorker全体を保護している場合は、次の静的Assetだけを対象に、対象HostnameのAccess application pathとして`Bypass / Everyone`を設定します。

- `/manifest.webmanifest`
- `/sw.js`
- `/icon-192.png`
- `/icon-512.png`
- `/icon.svg`

`/`、`/api/*`、アプリのHTMLや個人データは引き続きAllow policyで保護します。Access application pathはより具体的なパスが優先されるため、静的Assetだけを公開できます。Bypassは認証・ログを無効化するため、個人データを返すパスには設定しません。

設定後は、未認証状態で静的Assetが`200`になり、ルートHTMLはAccessへ`302`になることを確認します。

## 4. Migration / dry-run

```bash
pnpm run deploy:preflight
pnpm run db:migrate:production
pnpm run deploy:dry-run
```

D1 Migrationは失敗時にロールバックされるため、先にMigration結果を確認してからWorkerをデプロイします。[Wrangler D1 migrations](https://developers.cloudflare.com/d1/operations/migrations/)

## 5. 本番更新前の確認

1. 本番D1への読み取り認証が有効なことを確認し、直前の稼働Worker Versionと対象commitを記録する。認証不足のまま更新しない。
2. Manual Runが終了しており、Snapshotに実行中Runがないことを確認する。Run途中では旧版への切替を行わない。
3. 下記のバックアップを取得し、コピー復元と旧新版の読込を検証する。`main`へのpushはWorkers Buildsの本番CDを起動するため、この確認より先にpush/mergeしない。
4. Access認証後のBootstrapと主要Routeを確認する。業務データを使った検証では、利用者が保存していないテスト変更を加えない。

### D1バックアップのコピー検証

バックアップはprivateな作業ディレクトリへ保存し、SQL内容・Owner値・業務データをログやGitへ出さない。例えば次のように、公開しないファイルと別SQLiteコピーを作る。

```bash
umask 077
mkdir -p /private/tmp/orbit-production-check
pnpm exec wrangler d1 export orbit --remote --config wrangler.jsonc --env production --output /private/tmp/orbit-production-check/orbit.sql
shasum -a 256 /private/tmp/orbit-production-check/orbit.sql
sqlite3 /private/tmp/orbit-production-check/restored.sqlite < /private/tmp/orbit-production-check/orbit.sql
sqlite3 /private/tmp/orbit-production-check/restored.sqlite 'PRAGMA integrity_check;'
```

コピーの`integrity_check`が`ok`になり、Owner Snapshotを現在版の`decodeStoreSnapshot`→`OrbitStore.fromSnapshot`→`toSnapshot`で読み込めることを確認する。旧互換保存を`encodeStoreSnapshot`で作り、基準commit `15eb0eb`の実Storeでも同じ往復を行う。配列件数、Owner scope、数値`dueAt`、業務データを比較し、新版→旧版の通常編集→新版の往復で両方の更新が残ることもコピー上で検証する。SQLやSnapshotの原本を本番へrestoreしない。

## 6. デプロイ

Snapshot Migration、Owner行、Access確認が終わった後に実行します。

```bash
pnpm deploy
```

`pnpm deploy`はproduction build（`CLOUDFLARE_ENV=production`）→ preflight → production D1 migration → `wrangler deploy --keep-vars`の順で実行します。失敗した場合はWorkerを公開せず、エラー原因を解消して再実行してください。

通常の`main`へのpushは、下記のWorkers Builds経路を使用します。`pnpm deploy`はWorkers Buildsを使えない場合の手動・緊急経路であり、D1 migrationを含むため、通常のCIからは呼び出しません。

## 6.1 CI/CDの責務分担

- GitHub ActionsはCI専用です。PRと`main`へのpushで、依存導入、品質ゲート、GitleaksによるSecret検知だけを実行します。
- 本番CDの正本はCloudflare Workers Buildsです。`main`のpushを契機に`pnpm run build:production`と`npx wrangler deploy`をWorkers Buildsで実行します。
- D1 migration（`pnpm run db:migrate:production`）は本番データへ副作用があるため、手動手順で実施します。GitHub Actionsからは実行しません。
- staging用D1を準備するまで、非本番ブランチのPreview Buildは無効とします。本番D1を非本番Previewから参照させません。
- Branch protectionは本ユニットでは変更していません。設定前は`main`への直接pushでCIとCDが独立して起動するため、保護ブランチ運用を導入する場合は別途GitHub側で設定してください。

## 7. ロールバック・確認

デプロイ後はAccess経由で主要Routeを確認する。異常時はWranglerのVersions画面／`wrangler versions list`で切替先を特定する。確認済みの基準は`15eb0eb`に対応するVersion `c9ba19fc-a647-46d6-ac95-ab731d536338`であり、実行前に現Versionと切替先を再確認する。

今回の保存codecはProject表示設定・Recent検索・Saved View・関連Receiptの新enumを旧互換値へ投影し、元値を各レコードの`__orbitRollback`へ保存する。SQL migrationや`dueAt`変換は行わない。旧版へ戻す間、6つの追加並び順は対応する従来方向へ、`next7`は`upcoming`へ表示が縮退する。旧版の通常業務編集後も、新版は未変更の新設定を復元し、旧版で明示保存した設定を優先する。互換メタデータは新版ではD1保存境界だけに存在し、不正な形式は読込を拒否する。

rollbackはRunが終了した境界で**Worker Versionだけ**を切り替え、D1は更新後の最新データをそのまま使用する。バックアップを本番DBへ復元すると、取得後の利用者の更新を失うため、通常rollbackではDB復元やresetを行わない。旧版へ戻している間はMaintenance Runを実行しない。同一ミリ秒・同じ旧投影値の明示保存は関連Receiptを根拠に区別するため、そのReceiptが残っていることが旧設定優先の前提となる。

切替後はブラウザをrefreshして旧版のUIへ揃える。新旧のタブが混在すると旧APIが追加enumを拒否するため、旧UIで新機能を操作し続けない。過去の新request keyを旧fallback内容で再利用した場合の`409 IDEMPOTENCY_KEY_REUSED`は既存の競合検出であり、異なる内容を同じkeyへ上書きしない。

D1の復元期限・Time Travelはアプリの30日Trash期限とは別管理である。障害でDB自体の復旧が必要な場合は、利用者の更新を保持できる復旧対象と手順を別途確認する。
