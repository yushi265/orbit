# codekb: MVP 初回実装

## 公開インターフェース

- `/api/v1/bootstrap`、`/api/v1/issues`、`/api/v1/projects`、`/api/v1/cycles`、`/api/v1/search`、`/api/v1/views`、`/api/v1/notifications`、`/api/v1/preferences`、`/api/v1/background-runs/*` をTanStack Start Server Routeで公開する（参照: `src/server/api.ts`、`src/routes/api/v1/`）。
- Issue detailは `GET /api/v1/issues/:issueId` で `issue / notes / relations / activity` を返し、Notes / RelationsのMutationはIssue配下のnested Routeを使う（参照: `src/server/api.ts`、`src/routes/api/v1/issues/$issueId/`）。
- Cycle workspaceは既存BootstrapのCycle / Issueを使い、`PATCH /api/v1/cycles/:cycleId` でmetadataを更新する。Cycle closeのPOSTとIssue PATCHのCycle割当は既存Routeを再利用する（参照: `src/server/api.ts`、`src/routes/api/v1/cycles/`）。
- Cycle start schedule: `OrbitStore.ensureUpcomingCycles`がBootstrap / production session開始時に`CycleSettings.futureCount`件の後続Upcomingを補充し、成功GETのSnapshot persistで既存Ownerへ保存する。Current画面の「次のCycleを開始」は既存`POST /api/v1/cycles/:cycleId/start`を呼ぶ（参照: `src/server/store.ts`、`src/server/store-session.ts`、`src/components/OrbitApp.tsx`）。
- Upcoming Cycleの即時開始は`POST /api/v1/cycles/:cycleId/start`へJSONの`idempotencyKey`を渡し、Storeが現在Cycleのclose・次Cycleのactive化・後続日付再計算を行う（参照: `src/server/api.ts`、`src/server/store.ts`、`src/routes/api/v1/cycles/$cycleId/start.ts`）。
- Project workspaceはBootstrapのProject / Issueを使い、既存`PATCH /api/v1/projects/:projectId`をmetadata更新に再利用する。Saved Viewは`POST/PATCH/DELETE /api/v1/views*`でOwner scopedに管理する（参照: `src/server/api.ts`、`src/routes/api/v1/projects/`、`src/routes/api/v1/views/`）。
- Label / Bulk workspaceはBootstrapの`labels`とIssueの`labelIds`を使い、Label CRUDを`/api/v1/labels*`、複数Issue更新を`POST /api/v1/issues/bulk`で公開する。現段階はMemory StoreのOwner / Lock / Receipt / Activity / Outbox境界を正本とする（参照: `src/server/api.ts`、`src/server/store.ts`、`src/routes/api/v1/labels/`、`src/routes/api/v1/issues/bulk.ts`）。
- 本番APIは`withOwner`でOwner単位のD1 Snapshot Sessionを開き、成功Response後だけVersion CAS保存する。ローカルはMemory Storeを維持し、本番でD1 Bindingが無い場合はフォールバックしない（参照: `src/server/http.ts`、`src/server/store-session.ts`、`src/db/repositories/store-snapshot.ts`）。
- Inbox / NotificationはBootstrapの`notifications`と既存`PATCH /api/v1/notifications/:notificationId`を再利用し、strict `NotificationReadMutation`で個別既読・全件既読・Issue / Project / Cycle遷移を行う。通知生成は別スコープとする（参照: `src/components/OrbitApp.tsx`、`src/server/api.ts`、`src/shared/contracts/notifications.ts`）。
- 共通wire契約は `src/shared/contracts/` のZod Schemaを正本とする（参照: `src/shared/contracts/index.ts`）。
- Issue Listの手動順は `POST /api/v1/issues/reorder` の `{ idempotencyKey, issueId, version, beforeIssueId }` で保存し、Boardは共通Orderを表示するがDnDはListに限定する（参照: `src/server/api.ts`、`src/routes/api/v1/issues/reorder.ts`、`src/shared/contracts/issues.ts`）。
- Preferencesの表示モード`theme`とは別に`colorTheme`（`coral / ocean / violet / forest / amber`）を`PATCH /api/v1/preferences`で保存する（参照: `src/shared/contracts/enums.ts`、`src/db/schema.ts`、`src/components/theme.ts`）。
- Phase 1 Preferencesは`PATCH /api/v1/preferences`で`timezone`（IANA）、`locale`、`theme`、`colorTheme`、`estimateEnabled`をstrict検証し、Workflowは`GET/POST /api/v1/workflow-states`と`PATCH/DELETE /api/v1/workflow-states/:workflowStateId`でOwner scopedに管理する（参照: `src/shared/contracts/preferences.ts`、`src/shared/contracts/workflow.ts`、`src/server/api.ts`、`src/routes/api/v1/workflow-states/`）。
- Production Ownerの初期化は`pnpm run db:bootstrap:production`で行い、`OWNER_USER_ID` / `OWNER_EMAIL` / 任意の`ORBIT_OWNER_NAME`をローカル検証してからWranglerのproduction D1へ3つのOwner関連行を`ON CONFLICT DO NOTHING`で投入する（参照: `scripts/bootstrap-owner.mjs`、`docs/deployment.md`）。
- Phase 2 Issue coreは`GET /api/v1/issues?scope=active|archived|trash`、属性Filter付き`GET /api/v1/search`、`GET /api/v1/recent`、Recent記録の`POST /api/v1/recent-issue-views` / `POST /api/v1/recent-searches`を公開する。Issue detailは`parent` / `children` / `childProgress`を返し、Search / RecentはOwner scopedでArchived / Trashを検索結果から除外する（参照: `src/server/api.ts`、`src/routes/api/v1/recent.ts`、`src/shared/contracts/issue-core.ts`、`src/shared/contracts/issue-detail.ts`）。

## 主要データ構造

- D1 / Drizzleの26テーブルとOwner scopeは `src/db/schema.ts`、初期DDLは `drizzle/0000_initial.sql`、Snapshot bridgeは `drizzle/0001_*.sql` を正本とする。
- Preview未接続のローカルMVPは `OrbitStore` のOwner別Memory Storeを使う（参照: `src/server/store.ts`）。
- Recent issue view / searchは`OrbitStoreSnapshot`の`recentIssueViews` / `recentSearches`配列へ保持し、旧Snapshotの配列欠落は空配列へ補完する。正規化D1 tableは既存Schemaを維持し、MVPの実運用境界はOwner単位Snapshot CASとする（参照: `src/server/store.ts`、`src/server/store-session.ts`）。
- Notes / Relationsは既存D1テーブルを再利用し、Memory Storeでは `notes` / `relations` MapとOwner / Lock / Receipt / Activity / Outboxを同じ境界で適用する（参照: `src/server/store.ts`）。

## 再利用可能な部品

- Canonical JSON / request hash: `src/shared/canonical-json.ts`
- HTTP ErrorEnvelope / Owner boundary: `src/server/http.ts`, `src/server/auth.ts`
- QueryClient / same-origin fetch: `src/lib/query.ts`, `src/lib/api-client.ts`
- Issue Bulk UI: `IssuesView`のselection / Bulk bar、Label管理は`SettingsView`のLabelsカードでBootstrapを共有する（参照: `src/components/OrbitApp.tsx`）。
- Issue Project割当UI: 一覧のインライン選択・詳細保存・新規作成でBootstrapの`projects`と既存Issue PATCH / POSTの`projectId`契約を共有し、`src/components/issue-project.ts`でProjectなしを`null`へ正規化する（参照: `src/components/OrbitApp.tsx`）。
- Issue Priority / Theme / PWA UI: Issue Priorityは既存Issue POST/PATCHへ共有enumを渡し、Themeは`document[data-theme]`へ解決し、PWAはversioned Manifest・Service Worker・`beforeinstallprompt`をSettingsへ集約する。Access保護下ではManifest / SW / アイコンのspecific path Bypassが必要（参照: `src/components/OrbitApp.tsx`、`src/components/issue-priority.ts`、`src/components/theme.ts`、`public/manifest.webmanifest`、`public/sw.js`、`public/_headers`）。
- Issue controls UI: Issue詳細のStatusは既存Issue PATCHへ`version`と`patch.statusId`を渡し、一覧の完了表示切替・5種のソートは`src/components/issue-list.ts`の純粋関数でList / Boardへ共通適用する（参照: `src/components/OrbitApp.tsx`）。
- Issue controls follow-up UI: 完了表示は`orbit.issues.showCompleted`へlocalStorage保存し、Issue PATCH成功Toastは`src/components/issue-undo.ts`の逆Patchで「元に戻す」を提供する。ソート選択はIssues toolbarに置き、Status / Priority / Due等の並び替えを`src/components/issue-list.ts`で統一する（参照: `src/components/OrbitApp.tsx`）。
- Issue experience polish: PriorityはListで`PriorityIcon`へ変換し、IME変換中のEnterは`isComposing` / `keyCode 229`でsubmitを抑止する。ColorThemeは`data-color-theme`とCSS変数へ反映し、旧Snapshotの欠落値はCoralへ補完する（参照: `src/components/issue-priority.ts`、`src/components/issue-composer.ts`、`src/components/OrbitApp.tsx`、`src/server/store.ts`）。

## 既知の罠

- `pnpm format:check` はハーネス配下の既存ソースまで対象にするとoxfmtのバージョン差で失敗するため、root scriptはアプリ実装（`src public drizzle` と設定ファイル）だけを対象にする（出典: `package.json`）。
- Cloudflare Vite pluginのSSR buildはWranglerログをユーザープリファレンスへ書こうとするため、制限環境では `WRANGLER_LOG_PATH` を明示して検証する（出典: Stage 5実行ログ）。
- `pnpm` はnode_modulesの再構成を非TTYで確認すると停止するため、CI / 自動実行では `.npmrc` の `confirmModulesPurge=false` を使う（参照: `.npmrc`）。
- Bulkはpatchを1属性に限定し、参照先を全件検証してから適用する。Activity mutation keyはIssueごとにsuffixを付け、全体Receiptとは分離する（参照: `src/shared/contracts/bulk.ts`、`src/server/store.ts`）。
- SnapshotのVersion CASは既存Snapshotの読み取りではVersionを進めず、成功したMutationまたはSnapshot未作成時の初回成功GETだけがD1行を初期化・更新する。既存Versionとの不一致は`D1_WRITE_CONFLICT`になる（参照: `src/server/store-session.ts`、`src/db/repositories/store-snapshot.ts`）。
- Drizzleの既存`user_preferences`へ列を追加する再作成migrationでは、旧テーブルに存在しない新列をSELECTせず、固定default（今回の`color_theme`は`'coral'`）をSELECTする（参照: `drizzle/0002_known_scarlet_spider.sql`）。
- GETでLease期限切れを検出した場合だけ`OrbitStore`のbackground dirty flagを立て、任意のGET内業務変更を保存せず、Runの`paused`とLock解放だけを次のSnapshotへ永続化する（参照: `src/server/store.ts`、`src/server/store-session.ts`）。
- Workflowの順序変更はサーバー側で0始まりの連続positionへ正規化し、既定stateまたはIssue参照中stateの削除を先に拒否する。UIのRetryは操作signatureが同じ場合だけ同じidempotencyKeyを再利用する（参照: `src/server/store.ts`、`src/components/OrbitApp.tsx`）。
- Parent/Sub-issueの更新は同一Owner・未削除・未Archivedの親だけを受け付け、自己参照と子孫参照を`VALIDATION_ERROR` + field errorで拒否する。Detailの子進捗は直下の未削除Issueだけを対象にし、Canceledを分母から除外する（参照: `src/server/store.ts`、`src/shared/cycle-workspace.ts`）。
- Command / Shortcutは新規Menuライブラリを使わず、`nextCommandIndex`、`shortcutActionFor`、`shortcutModifierLabel`を使ってArrow選択・入力フォーカス除外・OS別modifier表示を実装する（参照: `src/components/issue-core-ui.ts`、`src/components/OrbitApp.tsx`）。

## 最終更新

MVP初回実装 / FEAT-issue-detail-workspace / FEAT-cycle-workspace / FEAT-project-view-workspace / FEAT-label-bulk-workspace / REL-d1-persistence作業中 / FEAT-feedback-polish / FEAT-issue-controls / FEAT-issue-experience-polish / PHASE1-foundation / PHASE2-issue-core / 2026-08-27
