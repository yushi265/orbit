# codekb: MVP 初回実装

## 公開インターフェース

- `/api/v1/bootstrap`、`/api/v1/issues`、`/api/v1/projects`、`/api/v1/cycles`、`/api/v1/search`、`/api/v1/views`、`/api/v1/notifications`、`/api/v1/preferences`、`/api/v1/background-runs/*` をTanStack Start Server Routeで公開する（参照: `src/server/api.ts`、`src/routes/api/v1/`）。
- Issue detailは `GET /api/v1/issues/:issueId` で `issue / notes / relations / activity` を返し、Notes / RelationsのMutationはIssue配下のnested Routeを使う（参照: `src/server/api.ts`、`src/routes/api/v1/issues/$issueId/`）。
- Cycle workspaceは既存BootstrapのCycle / Issueを使い、`PATCH /api/v1/cycles/:cycleId` でmetadataを更新する。Cycle closeのPOSTとIssue PATCHのCycle割当は既存Routeを再利用する（参照: `src/server/api.ts`、`src/routes/api/v1/cycles/`）。
- Project workspaceはBootstrapのProject / Issueを使い、既存`PATCH /api/v1/projects/:projectId`をmetadata更新に再利用する。Saved Viewは`POST/PATCH/DELETE /api/v1/views*`でOwner scopedに管理する（参照: `src/server/api.ts`、`src/routes/api/v1/projects/`、`src/routes/api/v1/views/`）。
- 共通wire契約は `src/shared/contracts/` のZod Schemaを正本とする（参照: `src/shared/contracts/index.ts`）。

## 主要データ構造

- D1 / Drizzleの25テーブルとOwner scopeは `src/db/schema.ts`、初期DDLは `drizzle/0000_initial.sql` を正本とする。
- Preview未接続のローカルMVPは `OrbitStore` のOwner別Memory Storeを使う（参照: `src/server/store.ts`）。
- Notes / Relationsは既存D1テーブルを再利用し、Memory Storeでは `notes` / `relations` MapとOwner / Lock / Receipt / Activity / Outboxを同じ境界で適用する（参照: `src/server/store.ts`）。

## 再利用可能な部品

- Canonical JSON / request hash: `src/shared/canonical-json.ts`
- HTTP ErrorEnvelope / Owner boundary: `src/server/http.ts`, `src/server/auth.ts`
- QueryClient / same-origin fetch: `src/lib/query.ts`, `src/lib/api-client.ts`

## 既知の罠

- `pnpm format:check` はハーネス配下の既存ソースまで対象にするとoxfmtのバージョン差で失敗するため、root scriptはアプリ実装（`src public drizzle` と設定ファイル）だけを対象にする（出典: `package.json`）。
- Cloudflare Vite pluginのSSR buildはWranglerログをユーザープリファレンスへ書こうとするため、制限環境では `WRANGLER_LOG_PATH` を明示して検証する（出典: Stage 5実行ログ）。
- `pnpm` はnode_modulesの再構成を非TTYで確認すると停止するため、CI / 自動実行では `.npmrc` の `confirmModulesPurge=false` を使う（参照: `.npmrc`）。

## 最終更新

MVP初回実装 / FEAT-issue-detail-workspace / FEAT-cycle-workspace作業中 / 2026-08-24
