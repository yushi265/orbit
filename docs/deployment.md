# Orbit デプロイ準備

## 現在の判定

本番用D1 `orbit` の作成、Wrangler認証、productionビルド、preflight、dry-runまで完了しています。

- D1: `orbit`（APAC、`53d2ce53-5326-47da-95b6-386732c50a9b`）
- Worker: `orbit-project-manager-production` を生成する設定を確認済み
- `APP_ENV=production` とD1 bindingを含む最終設定をdry-runで確認済み
- アプリ本体の業務データは現在 `OrbitStore`（Memory Store）を使うPreview実装で、本番D1 Repositoryへの切替はRelease hardeningの残課題です。
- Cloudflare Accessの `OWNER_USER_ID` / `OWNER_EMAIL` / `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` はSecretとして未設定です。
- D1の初期Migration（`0000_initial.sql`）は適用済みです。Owner行の作成は未完了です。

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

Cloudflare AccessはOriginへ`Cf-Access-Jwt-Assertion`を渡します。Worker側でもJWTの署名・issuer・audienceを検証する必要があります。[Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

## 3. Migration / dry-run

```bash
pnpm run deploy:preflight
pnpm run db:migrate:production
pnpm run deploy:dry-run
```

D1 Migrationは失敗時にロールバックされるため、先にMigration結果を確認してからWorkerをデプロイします。[Wrangler D1 migrations](https://developers.cloudflare.com/d1/operations/migrations/)

## 4. 本番切替前の残タスク

1. `src/db/repositories/`を使う本番Data adapterを実装し、Memory Storeを本番経路から外す。
2. `OWNER_USER_ID`に対応する`users`行をD1へ作成し、Bootstrap / Owner lookupを実D1で確認する。
3. Accessで対象HostnameをSelf-hosted applicationとして保護し、許可メールを1件に限定する。
4. `GET /api/v1/bootstrap`の認証済み200、未認証401、他Owner 404をPreviewで確認する。
5. Issue / Cycle / Project / Label / Bulk / Inboxの主要操作とBackground Run中423を実D1でSmokeする。

## 5. デプロイ

本番Data adapter、Owner行、Access確認が終わった後に実行します。

```bash
pnpm deploy
```

`pnpm deploy`はproduction build（`CLOUDFLARE_ENV=production`）→ preflight → production D1 migration → `wrangler deploy --keep-vars`の順で実行します。失敗した場合はWorkerを公開せず、エラー原因を解消して再実行してください。

## 6. ロールバック・確認

デプロイ後はAccess経由で主要Routeを確認し、異常時はWranglerのVersions画面／`wrangler versions list`で直前Versionを特定してからロールバック方針を決めます。D1の復元期限・Time Travelはアプリの30日Trash期限とは別管理です。
