# codekb: MVP 初回実装

## 公開インターフェース

- Homeの追加FilterはIssues URLの`open=true`（Completed/Canceled除外、UIのみ）と`due=next7`（本人Timezoneの今日より後〜7暦日後、検索/保存契約も共通）、Projectsの`active=true`。旧completed=false/upcomingの意味は維持する。Project表示Orderは13選択肢で、DueはUTC日key比較・null常に最後（参照: `src/lib/url-state/issues.ts`、`src/shared/contracts/project-display.ts`、`src/shared/issue-dates.ts`、`src/components/issue-list.ts`）。
- Bootstrap.background.lastRunは本人の最新requested_atのPublicRunを返し、同msは最新挿入順を優先する。background.run/currentは復旧可能Runだけのまま。Receipt purgeはexpiresAt<nowであり、期限から追加30日待たない（参照: `src/server/store.ts`、`src/server/review-followup-service.test.ts`）。
- Mutation Receiptの保持は作成から24時間（`RECEIPT_TTL`）。D1 Sessionの`persist()`が`toSnapshot()`直前に`OrbitStore.pruneExpiredReceipts(userId)`を呼び、`min(expiresAt, createdAt+24h) < now`の同Owner Receiptを削除する。Memory Storeと保存を伴わないGETでは削除しない。Issue並び替えのActivity / Outboxは移動した対象Issueの1件ずつだけ（ずれたIssueはposition / versionのみ更新）。Issue PurgeはそのIssueを`entityId`とするActivityも削除する。rollback互換の「根拠Receipt残存」前提とは両立する（旧版は自動削除せず、新版はSession開始時のdecodeで旧変更を判定した後、成功Mutationの保存時にだけ削除する）。D1 SessionテストのFake D1は`src/server/store-session.test-fixtures.ts`を使う（参照: `src/server/store.ts`、`src/server/store-session.ts`、`src/server/snapshot-growth.test.ts`、`docs/spec/FIX-snapshot-growth/`）。
- Run controllerはcurrent=nullでも既知の終端を保持する。Bootstrap再取得の失敗はCache内容と非blockingError/Retryを維持し、初回CacheなしだけをErrorScreenにする。Reorder FocusはKeyboardで実際に移動した場合だけ記録し、境界No-op/Dragstart/他入力で残存intentを解除する（参照: `src/components/background-run.ts`、`src/components/OrbitApp.tsx`、`src/components/followup-shell-runtime.test.ts`、`src/components/followup-reorder-runtime.test.ts`）。
- `/api/v1/bootstrap`、`/api/v1/issues`、`/api/v1/projects`、`/api/v1/cycles`、`/api/v1/search`、`/api/v1/views`、`/api/v1/notifications`、`/api/v1/preferences`、`/api/v1/background-runs/*` をTanStack Start Server Routeで公開する（参照: `src/server/api.ts`、`src/routes/api/v1/`）。
- Issue detailは `GET /api/v1/issues/:issueId` で `issue / notes / relations / activity` を返し、Notes / RelationsのMutationはIssue配下のnested Routeを使う（参照: `src/server/api.ts`、`src/routes/api/v1/issues/$issueId/`）。
- CYC-11のCycle繰越履歴は新規endpointを作らず、Issue detailの`GET /api/v1/issues/:issueId`へ`cycleHistory`（`movedAt`降順）と`carryoverCount`、Bootstrapの`GET /api/v1/bootstrap`へOwner scopedな`cycleHistory`を追加する。投影はSnapshotの既存`cycleHistory`から行い、Cycle画面は`toCycle.id`でincoming件数、Issue detail / Cycle詳細は`fromCycle`を表示する（参照: `src/shared/view-models.ts`、`src/shared/contracts/issue-detail.ts`、`src/server/store.ts`、`src/components/OrbitApp.tsx`、`docs/spec/CYC-11-cycle-history/`）。
- CYC-14のCycle詳細reorderは新規endpoint / Migrationを作らず、既存`POST /api/v1/issues/reorder`へ任意の`cycleId`（List）と`statusId`（Board同一Status列）を追加する。`Issue.position`のCycle内slotを置換し、Cycle外の相対順序・Cycle / Status所属を保持する。scopeなしの既存global reorderは後方互換で維持する（参照: `src/shared/contracts/issues.ts`、`src/server/store.ts`、`src/components/OrbitApp.tsx`、`docs/spec/CYC-14-cycle-reorder/`）。
- CYC-17のCycle詳細内訳は新規API / D1変更なしで、既存BootstrapのOwner scopedなIssue・Workflow・ProjectをUIレイヤーの純粋関数でStatus / Priority / Project別に集計する。StatusはWorkflow順で0件を含め、Priorityは5種を固定表示、未割当・解決不能Projectは`Projectなし`へ集約する（参照: `src/components/cycle-breakdown.ts`、`src/components/OrbitApp.tsx`、`docs/requirements/02-functional.md`）。
- Cycle workspaceは既存BootstrapのCycle / Issueを使い、`PATCH /api/v1/cycles/:cycleId` でmetadataを更新する。Cycle closeのPOSTとIssue PATCHのCycle割当は既存Routeを再利用する（参照: `src/server/api.ts`、`src/routes/api/v1/cycles/`）。
- Cycle設定はBootstrapの`cycleSettings`で取得し、`PATCH /api/v1/cycle-settings`で`durationWeeks`（1..8）、`startWeekday`（0=日曜..6=土曜）、`cooldownWeeks`（0..4）、`futureCount`（1..15）を更新する。更新時は未調整UpcomingだけをOwnerのIANA timezoneの00:00へ再計算し、CooldownはDSTをまたぐ暦週として次の指定曜日境界へ適用する（参照: `src/shared/contracts/cycles.ts`、`src/server/cycle-schedule.ts`、`src/server/api.ts`、`src/components/OrbitApp.tsx`）。
- Cycle start schedule: `OrbitStore.ensureUpcomingCycles`がBootstrap / production session開始時に`CycleSettings.futureCount`件の後続Upcomingを補充し、成功GETのSnapshot persistで既存Ownerへ保存する。Current画面の「次のCycleを開始」は既存`POST /api/v1/cycles/:cycleId/start`を呼ぶ（参照: `src/server/store.ts`、`src/server/store-session.ts`、`src/components/OrbitApp.tsx`）。
- Cycle boundary transition: Maintenance Runの`cycle_transition`は`endsAt <= now`のActiveを`closeCycle`へ渡し、Activeがなく最も番号の小さいUpcomingの`startsAt <= now`なら予定日時を保持したままActive化する。Cooldown中はActiveを作らず、`CyclesView`が次回開始日時とUpcoming導線を表示する（参照: `src/server/store.ts`、`src/components/OrbitApp.tsx`）。
- Cycle schedule override: Upcomingの日付個別調整は`PATCH /api/v1/cycles/:cycleId/schedule`へ`startDate` / `endDate`（`YYYY-MM-DD`）を送り、OwnerのIANA timezone 00:00へ変換して`scheduleOverridden = true`にする。期間重複は適用前に拒否し、後続の未調整Upcomingだけを新しい終了日時から再計算する（参照: `src/shared/contracts/cycles.ts`、`src/server/cycle-schedule.ts`、`src/server/store.ts`、`src/components/OrbitApp.tsx`）。
- Cycle auto-add: `PATCH /api/v1/cycle-settings`の`autoAddToCurrentCycle`をONにすると、未所属IssueがStarted / Completedへstatus遷移したcreate / PATCH / bulk MutationでActive Cycleへ自動割当する。割当はIssue versionを1回だけ進め、`cycle.auto_assigned` / `system:automation`のActivityと`issue.cycle.auto_assigned` Outboxを一意化して記録する（参照: `src/shared/contracts/cycles.ts`、`src/server/model.ts`、`src/server/store.ts`、`src/components/OrbitApp.tsx`、`drizzle/0003_white_swordsman.sql`）。
- Upcoming Cycleの即時開始は`POST /api/v1/cycles/:cycleId/start`へJSONの`idempotencyKey`を渡し、Storeが現在Cycleのclose・次Cycleのactive化・後続日付再計算を行う（参照: `src/server/api.ts`、`src/server/store.ts`、`src/routes/api/v1/cycles/$cycleId/start.ts`）。
- Project workspaceはBootstrapのProject / Issueを使い、既存`PATCH /api/v1/projects/:projectId`をmetadata更新に再利用する。Saved Viewは`POST/PATCH/DELETE /api/v1/views*`でOwner scopedに管理する（参照: `src/server/api.ts`、`src/routes/api/v1/projects/`、`src/routes/api/v1/views/`）。
- Project detailのIssue表示設定はBootstrapの`projectDisplayPreferences`へOwner scopedで投影し、既存`PATCH /api/v1/projects/:projectId`の`displayPreferences` strict branchで保存する。List / Board、検索、Status / Priority / Label / Due、並び順、完了表示をSnapshotへ保存し、別端末のBootstrap再取得で復元する（参照: `src/shared/contracts/project-display.ts`、`src/server/store.ts`、`src/server/api.ts`、`src/components/OrbitApp.tsx`）。
- Label / Bulk workspaceはBootstrapの`labels`とIssueの`labelIds`を使い、Label CRUDを`/api/v1/labels*`、複数Issue更新を`POST /api/v1/issues/bulk`で公開する。現段階はMemory StoreのOwner / Lock / Receipt / Activity / Outbox境界を正本とする（参照: `src/server/api.ts`、`src/server/store.ts`、`src/routes/api/v1/labels/`、`src/routes/api/v1/issues/bulk.ts`）。
- 本番APIは`withOwner`でOwner単位のD1 Snapshot Sessionを開き、成功Response後だけVersion CAS保存する。ローカルはMemory Storeを維持し、本番でD1 Bindingが無い場合はフォールバックしない（参照: `src/server/http.ts`、`src/server/store-session.ts`、`src/db/repositories/store-snapshot.ts`）。
- Inbox / NotificationはBootstrapの`notifications`と既存`PATCH /api/v1/notifications/:notificationId`を再利用し、strict `NotificationReadMutation`で個別既読・全件既読・Issue / Project / Cycle遷移を行う。通知生成は別スコープとする（参照: `src/components/OrbitApp.tsx`、`src/server/api.ts`、`src/shared/contracts/notifications.ts`）。
- 共通wire契約は `src/shared/contracts/` のZod Schemaを正本とする（参照: `src/shared/contracts/index.ts`）。
- Issue Listの手動順は `POST /api/v1/issues/reorder` の `{ idempotencyKey, issueId, version, beforeIssueId }` で保存し、Boardは共通Orderを表示するがDnDはListに限定する（参照: `src/server/api.ts`、`src/routes/api/v1/issues/reorder.ts`、`src/shared/contracts/issues.ts`）。
- Project detailの手動順は同じreorder契約へ任意の`projectId`を渡し、対象Project内だけを並べ替える。UIのselection / bulk / inline mutationもProject scopeを共有し、Canceledは完了Issue扱いにしない（参照: `src/components/issue-list.ts`、`src/components/OrbitApp.tsx`、`src/server/store.ts`）。
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

- 画面の幅/高さはstyles.cssで制約する。DetailはDesktop90vw/Mobilegutter内、Dueは小幅でも2行目に表示、Sidebarは100dvh内でnavをscrollする。長いProject名は自然折返し、操作はnowrap。Darkのdetail-countとuser-card strongはテーマ変数を使う（参照: `src/styles.css`、`docs/spec/FEAT-review-followup/`）。
- URLを含むメモ/説明は`LinkifiedText`を使い、http/httpsとReact text escaping/blank noopener noreferrerを共通化する。説明textareaの原文保存を維持し、安全URLがある場合だけPreviewを併設する（参照: `src/components/LinkifiedText.tsx`、`src/components/linkified-text.ts`）。
- Issue期限は`src/shared/issue-dates.ts`で保存値のUTC暦日を維持し、todayだけ本人Timezoneの現在暦日へ変換する。UI/service共通FilterとHome集計を使う。数値dueAtは日付carrierであり、Timezoneへ変換するtimestampではない（参照: `src/shared/issue-dates.ts`、`src/server/issue-date-filter.test.ts`、`src/components/issue-dates-runtime.test.ts`）。
- BootstrapのIssueは`OrbitStore.matchingIssues`のOwner/scope/filter/order抽出を使って全件取得する。公開`listIssues`の既定100・上限500は表示用として維持し、全件を扱う業務処理へ流用しない（参照: `src/server/store.ts`、`src/server/bootstrap-completeness.test.ts`）。
- Maintenanceは25対象で残件がある間同じStepを継続する。opaque cursorは成功Chunkごとに更新し、失敗Chunkは既存deep Snapshotで全業務変更を復元してRun/Lockを取り直す。公開continueはOwnerを確認してから実行中だけtokenを取得し、完了再送を200 No-opへ通す（参照: `src/server/store.ts`、`src/server/api.ts`、`src/server/maintenance-integrity.test.ts`、`src/server/api-maintenance-integrity.test.ts`）。
- Run作成で競合拒否された終端だけ、POST `/api/v1/background-runs`・423・専用dirty flagの一致時にSnapshotへ保存する。一般的な失敗Mutationの非保存は維持する。PurgeはIssue FK cascade依存を除去し、生存子の親参照を解除する（参照: `src/server/http.ts`、`src/server/store-session.ts`、`src/server/store.ts`）。
- Runの復旧は`useBackgroundRun`がcurrent/start/resume/continueを直列化し、30秒・focus・online・表示復帰（visibilitychange）でServer truthを取得する。30秒周期は、タブが非表示かつ把握しているRunが無い／終端の間はスキップし、非終端Run（pending / running / paused / failed）の間は非表示でも続ける。jsdomは既定で`document.hidden`がtrueなので、30秒周期を検証するテストは表示中を明示する。Bootstrapは初回seedのみとして古い再取得結果でcursorを戻さない（参照: `src/components/background-run.ts`）。
- Issues一覧と詳細は同じURL validatorを使い、Route.useSearchをFilter/Mode/Orderの正本とする。参照ID補正はBootstrap取得後に一括replaceし、詳細/親子切替と閉じるでsearchを保持する（参照: `src/lib/url-state/issues.ts`、`src/routes/issues/`、`src/components/issues-url-runtime.test.ts`）。
- Dialog境界はDocumentごとのregistryで初期Focus/Tab/Escape/復帰とinertを管理し、blocking Runを最前面にする。検索は旧応答を破棄し、Projectは即時guard/同じretryKey/IMEを扱う。Detail保存はBootstrapと既存3scope Cacheの所属まで同期する（参照: `src/components/dialog-boundary.ts`、`src/components/OrbitApp.tsx`、`src/components/review-ui-runtime.test.ts`）。
- Canonical JSON / request hash: `src/shared/canonical-json.ts`
- HTTP ErrorEnvelope / Owner boundary: `src/server/http.ts`, `src/server/auth.ts`
- QueryClient / same-origin fetch: `src/lib/query.ts`, `src/lib/api-client.ts`
- Issue Bulk UI: `IssuesView`のselection / Bulk bar、Label管理は`SettingsView`のLabelsカードでBootstrapを共有する（参照: `src/components/OrbitApp.tsx`）。
- Issue Project割当UI: 一覧のインライン選択・詳細保存・新規作成でBootstrapの`projects`と既存Issue PATCH / POSTの`projectId`契約を共有し、`src/components/issue-project.ts`でProjectなしを`null`へ正規化する（参照: `src/components/OrbitApp.tsx`）。
- Issue Priority / Theme / PWA UI: Issue Priorityは既存Issue POST/PATCHへ共有enumを渡し、Themeは`document[data-theme]`へ解決し、PWAはversioned Manifest・Service Worker・`beforeinstallprompt`をSettingsへ集約する。Access保護下ではManifest / SW / アイコンのspecific path Bypassが必要（参照: `src/components/OrbitApp.tsx`、`src/components/issue-priority.ts`、`src/components/theme.ts`、`public/manifest.webmanifest`、`public/sw.js`、`public/_headers`）。
- Issue controls UI: Issue詳細のStatusは既存Issue PATCHへ`version`と`patch.statusId`を渡し、一覧の完了表示切替・5種のソートは`src/components/issue-list.ts`の純粋関数でList / Boardへ共通適用する（参照: `src/components/OrbitApp.tsx`）。
- Issue controls follow-up UI: 完了表示は`orbit.issues.showCompleted`へlocalStorage保存し、Issue PATCH成功Toastは`src/components/issue-undo.ts`の逆Patchで「元に戻す」を提供する。ソート選択はIssues toolbarに置き、Status / Priority / Due等の並び替えを`src/components/issue-list.ts`で統一する（参照: `src/components/OrbitApp.tsx`）。
- Issue experience polish: PriorityはListで`PriorityIcon`へ変換し、IME変換中のEnterは`isComposing` / `keyCode 229`でsubmitを抑止する。ColorThemeは`data-color-theme`とCSS変数へ反映し、旧Snapshotの欠落値はCoralへ補完する（参照: `src/components/issue-priority.ts`、`src/components/issue-composer.ts`、`src/components/OrbitApp.tsx`、`src/server/store.ts`）。
- Home actionable dashboard: Home専用APIを増やさず、BootstrapのTimezone・Cycle・Project・Issueから期限超過 / 今日 / 7日以内 / Current Cycle / 最近更新を導出する。各カードは既存Issue / Cycle / Project routeへ遷移し、空状態には次の操作を示す（参照: `src/components/home.ts`、`src/components/OrbitApp.tsx`）。

## Snapshotの旧版互換保存

- D1 Sessionのread/write直前に`decodeStoreSnapshot` / `encodeStoreSnapshot`を挟む。domainの`OrbitStore.toSnapshot/fromSnapshot`やRun chunk復元は元のSnapshotを扱い、UI/APIへ互換metaを出さない（参照: `src/server/store-snapshot-compat.ts`、`src/server/store-session.ts`）。
- 新Project sortと`next7`は旧enumへ投影する。`__orbitRollback`は各record siblingへ元値・投影anchor・同Owner/record/operationのReceipt keyを保存し、旧Storeの通常serializationで保持する。top-level metaやstrict settings/query内のmetaは使用しない。
- Project/Recentのanchorまたは関連Receipt key追加は旧明示編集を優先する。Viewはqueryのlayoutを除いて比較し、rename/layout編集では新queryと現在layoutを両方維持する。queryを含むview.updateの新Receiptだけを明示query変更と数える。
- Receipt自体のsidecarだけが元retry応答を復元する。旧Storeがresponseへcloneしたrecord sidecarは既知形式を検証してstripし、旧応答を維持する。未知version/Owner/id/schema/投影不一致は固定Errorでsessionを拒否し、D1を上書きしない。
- 同msの同fallback再保存はReceipt追加で判断する。旧rollback中はMaintenanceを実行せず、根拠Receiptが残存する前提を守る。通常rollbackは終了Run境界でWorker Versionだけを戻し、更新後のD1をDB復元で巻き戻さない（参照: `docs/deployment.md`、`docs/spec/FIX-rollback-compatibility/service.md`）。

## 既知の罠

- Vite開発stylesheetはreserved `v` queryを付けない。query付きはViteが1年immutableを付けて古いCSSを保持する。本番のhash付きasset/versionは維持する。toolbar/Composer/hierarchyは幅・高さ・themeに合わせ、blocking Runのz-indexはDialogより高くする（参照: `src/routes/__root.tsx`、`src/pwa.test.ts`、`src/styles.css`）。
- `pnpm format:check` はハーネス配下の既存ソースまで対象にするとoxfmtのバージョン差で失敗するため、root scriptはアプリ実装（`src public drizzle` と設定ファイル）だけを対象にする（出典: `package.json`）。
- Cloudflare Vite pluginのSSR buildはWranglerログをユーザープリファレンスへ書こうとするため、制限環境では `WRANGLER_LOG_PATH` を明示して検証する（出典: Stage 5実行ログ）。
- TanStack Startのproduction配信用生成物は`CLOUDFLARE_ENV=production pnpm build`で作る。通常の`pnpm build`後にWrangler dry-runを実行すると、生成された`dist/server/wrangler.json`の`APP_ENV`が`development`になる（参照: `package.json`、`dist/server/wrangler.json`）。
- `pnpm` はnode_modulesの再構成を非TTYで確認すると停止するため、CI / 自動実行では `.npmrc` の `confirmModulesPurge=false` を使う（参照: `.npmrc`）。
- GitHub ActionsのGitleaks Action v3はイベント差分向けの`log-opts`を内部付与するため、`fetch-depth: 0`だけではGit履歴全体を検査しない。履歴全体のSecret検知が必要な場合は、Actionを補助スキャンとして使い、後段で`gitleaks git --no-banner --redact`を実行する（参照: `.github/workflows/ci.yml`）。
- Productionの初回Owner SnapshotはCycle 0件で保存され得るため、`ensureUpcomingCycles`は既存Active / Upcomingがない初回状態も初期Active Cycle 1へ収束させる。初回生成後はproduction Sessionの成功GET保存でバックフィルされる（参照: `src/server/store.ts`、`src/server/store-session.ts`）。
- Cycle開始曜日の計算は固定UTCオフセットではなく`Intl.DateTimeFormat`でIANA timezoneの現地00:00へ変換し、DST境界では暦日加算を使う（参照: `src/server/cycle-schedule.ts`）。
- CycleのCooldownはUTCミリ秒を単純加算せず、Timezoneのローカル暦日へ週数を加えてから指定曜日00:00へ正規化する。これによりDST境界で開始日を1週余計に飛ばさない（参照: `src/server/cycle-schedule.ts`）。
- Bulkはpatchを1属性に限定し、参照先を全件検証してから適用する。Activity mutation keyはIssueごとにsuffixを付け、全体Receiptとは分離する（参照: `src/shared/contracts/bulk.ts`、`src/server/store.ts`）。
- SnapshotのVersion CASは既存Snapshotの読み取りではVersionを進めず、成功したMutationまたはSnapshot未作成時の初回成功GETだけがD1行を初期化・更新する。既存Versionとの不一致は`D1_WRITE_CONFLICT`になる（参照: `src/server/store-session.ts`、`src/db/repositories/store-snapshot.ts`）。
- Drizzleの既存`user_preferences`へ列を追加する再作成migrationでは、旧テーブルに存在しない新列をSELECTせず、固定default（今回の`color_theme`は`'coral'`）をSELECTする（参照: `drizzle/0002_known_scarlet_spider.sql`）。
- GETでLease期限切れを検出した場合だけ`OrbitStore`のbackground dirty flagを立て、任意のGET内業務変更を保存せず、Runの`paused`とLock解放だけを次のSnapshotへ永続化する（参照: `src/server/store.ts`、`src/server/store-session.ts`）。
- Workflowの順序変更はサーバー側で0始まりの連続positionへ正規化し、既定stateまたはIssue参照中stateの削除を先に拒否する。UIのRetryは操作signatureが同じ場合だけ同じidempotencyKeyを再利用する（参照: `src/server/store.ts`、`src/components/OrbitApp.tsx`）。
- Parent/Sub-issueの更新は同一Owner・未削除・未Archivedの親だけを受け付け、自己参照と子孫参照を`VALIDATION_ERROR` + field errorで拒否する。Detailの子進捗は直下の未削除Issueだけを対象にし、Canceledを分母から除外する（参照: `src/server/store.ts`、`src/shared/cycle-workspace.ts`）。
- Command / Shortcutは新規Menuライブラリを使わず、`nextCommandIndex`、`shortcutActionFor`、`shortcutModifierLabel`を使ってArrow選択・入力フォーカス除外・OS別modifier表示を実装する（参照: `src/components/issue-core-ui.ts`、`src/components/OrbitApp.tsx`）。
- Inbox guidance: 既存通知の既読化・対象遷移を維持しつつ、通知の役割、未読の読み方、通知がない場合の次の行動をInbox内のGuide / Tab / Empty stateで説明する。通知生成・Push・削除APIは追加しない（参照: `src/components/OrbitApp.tsx`、`docs/spec/FEAT-home-project-inbox-ux/`）。

## ローカル専用モード

- `pnpm local:setup` / `local:start`は`APP_ENV=local` + `ORBIT_STORAGE=d1`、固定`local-owner`とローカルD1を使う。従来`pnpm dev`はMemory Store、productionはAccess + D1を維持。不正な環境・保存先の組合せは拒否する（参照: `src/server/runtime-config.ts`、`src/server/auth.ts`、`src/server/store-session.ts`）。
- 通常localの正規Originは`http://127.0.0.1:3000`。明示`local:start -- --lan`では起動時に検出したRFC1918 IPv4も許可し、MutationはそのRequest URLと同一Originを要求する（追加契約: `docs/spec/FEAT-local-only/lan.md`）。ViteのHostガードは403 text、API到達後のHost / Mutation Origin不一致は400。非所有Runのcontinueはlock取得より先にgetRunで404にする（参照: `vite.config.ts`、`src/server/http.ts`、`src/server/api.ts`）。
- CLIは同一絶対保存先・専用Wrangler設定・loopback・Node通信防壁を使用する。backup/restoreではコピー元・先と双方の`.lock`領域の重複も拒否する。ロックのfinally削除による成果物消失を避けるため、本体パスの親子比較だけに戻さない（参照: `scripts/local.mjs`、`scripts/local-network.mjs`）。
- 実D1テストは公開Snapshot Repositoryを使う。テスト内の手書きCAS SQLでは本番RepositoryのWHERE条件の回帰を捕捉できない。全Snapshot配列非空と中断Runの再開は`local-repository.integration.mjs`で確認する。Notification fixtureは保存専用で通常Ownerの通知生成を意味しない（参照: `scripts/local-repository.integration.mjs`、`docs/spec/FEAT-local-only/verification.md`）。
- Node防壁・ブラウザログとnative全プロセスの通信試行監査は別物。OS遮断下の機能動作は確認済みだが、全native試行監査は現環境で陽性対照が成立せずAC-7未完了（参照: `docs/spec/FEAT-local-only/verification.md`）。

## Mobile / Saved Views UI (2026-10-03)

- `useDialogBoundary` は背景scroll lockを同Documentの重なり全体で保持し、最後の解除で元style/scroll位置を復元する。Mobile詳細/ComposerはvisualViewportのheight/offsetTopで下端sheetを追従。caret末尾は初回だけ、async ready後に適用しユーザー操作/IME後は触らない（参照: `src/components/dialog-boundary.ts`）。
- Searchの6選択UIは`OrbitSelect`を使用する。body portal/fixed listboxをviewport内に配置し、44px候補、Keyboard/Escape/Tab/outside dismissalを持つ。OS native select候補の不可視を避ける（参照: `src/components/orbit-select.tsx`）。
- Saved Viewsは`/views?view=id`で選択を復元し、既存IssueQueryをclientでfilter/sort/group実行する。未知layout/created/limit/cursorは編集時保持、cursor pagingはStore同様未実行。Label条件はAND、他array条件はOR（参照: `src/components/saved-views.ts`、`src/routes/views.tsx`）。
- Inbox通知生成はdev seedのみ。UIは既存通知read:true/falseを処理し、期限/Cycle自動配信を約束しない。日付formatterの第2引数はlocaleでありtimezoneを渡さない（参照: `src/shared/issue-dates.ts`）。

- Mobile下部タブはHome / Inbox / Create / Search / Menuの5つ。`MobileMenuSheet`からIssues / Cycles / Projects / Views / Settingsへ移動する。Issue一覧のフィルター欄は1組だけ描画し、`div.filter-fields-wrap > div.filter-fields`を〜767pxでは下端シート、768px以上では`display: contents`でツールバーに並べる。`useDialogBoundary`はダイアログの兄弟を`inert`にするため、押下で閉じる背景はダイアログの祖先に置く（兄弟に置くと実ブラウザで押せない。jsdomでは検出できない）。常時マウントで`enabled`を切り替える場合、hookのフォーカス復帰先は初回描画時の要素になるので、閉じたときの復帰は明示的に行う（参照: `src/components/OrbitApp.tsx`、`src/components/issue-list.ts`、`src/styles.css`、`docs/spec/FIX-mobile-nav-filter-sheet/`）。

- iOSのSafe Areaはviewport metaの`viewport-fit=cover`が無いと`env(safe-area-inset-*)`が0になり効かない。横方向は`.app-shell`の左右paddingで非fixedの内容へ1回だけ適用し、fixed要素（`.mobile-nav`、`.toast`、各シート、モーダル背景）は各自で`max(既存値, env())`を持つ。上方向は`apple-mobile-web-app-status-bar-style`が`default`の間は0のため追加していない（`black-translucent`へ変える場合は上方向の対応が要る）。jsdomは`env()`を評価しないので、見た目はiPhone実機で確認する（参照: `src/routes/__root.tsx`、`src/styles.css`、`src/components/mobile-layout.test.ts`）。

- Issue一覧（`IssuesView`のList）は`buildIssueHierarchyRows`（`src/components/issue-hierarchy.ts`）で、子を親の直下に字下げして並べる。並び順は兄弟どうしに適用され、親が一覧に無い子は最上位に親名つきで出る。子の完了数バッジはIssue詳細と同じ`calculateCycleMetrics`の`completed / total`（totalはCanceledを含む）。開閉はlocalStorage `orbit.issues.collapsedParents`。位置（`position`）は平坦なままで、手動並べ替えは同じ表示上の親を持つ兄弟の間だけ（`beforeIssueIdForDrop`を全Issueの手動順に対して使う）。全選択と選択は表示中の行だけ。`IssueRow`の開くボタンは`button`なので、開閉ボタンは入れ子にせず`div.issue-title-cell`で並べる（参照: `src/components/OrbitApp.tsx`、`src/styles.css`、`docs/spec/FEAT-issue-hierarchy-list/`）。
- `PATCH /api/v1/issues/:id`の更新内容は`patch`オブジェクトの中に入れる（`{ version, idempotencyKey, patch: { parentId } }`）。最上位に置いた未知の項目は無視され、空の更新でもversionが1進む。

- Projectは`position`（整数）を持ち、`OrbitStore.listProjects`は`position` → `createdAt` → `id`の昇順で返す（Bootstrapも同じ。クライアント側でProjectを並べ替える処理は無いので、この1か所の順が全画面に効く）。新規は未削除の最大+1。並べ替えは`POST /api/v1/projects/reorder`（`{ idempotencyKey, projectId, beforeProjectId | null }`）で、未削除の全件を連番に振り直し、Activity / Outboxは対象1件だけ、`updatedAt`は変えない。旧Snapshot（`position`なし）は`fromSnapshot`内の`fillProjectPositions`が`isSnapshot`の検証前に補う（Ownerごと・既存の最大+1から`createdAt` → `id`順）。補完は決定的で、`store-session`は補完後の値を初期状態として扱うため、読み込みだけでは保存しない。旧版のStoreは`hasTypes`で既知の項目だけを検証しレコードをそのまま保持するので、`position`があっても読める（旧版で作ったProjectは`position`を持たず、新版が補う）。D1の正規化テーブル`projects`には`position`を足していない（参照: `src/server/store.ts`、`src/server/api.ts`、`src/routes/api/v1/projects/reorder.ts`、`src/shared/contracts/projects.ts`、`docs/spec/FEAT-project-manual-order/`）。
- ProjectsViewのカードは`Link`（アンカー）なので、中にボタンを置けない。`div.project-card-item`で包み、`Link.project-card`と`div.project-order-actions`を兄弟として並べて、見た目だけカードに重ねる（参照: `src/components/OrbitApp.tsx`、`src/components/project-workspace.ts`、`src/styles.css`）。

## a11y / 確認ダイアログ（FIX-ux-a11y-high・2026-10-06）

- 色は `styles.css` のトークンを使う。ライトのミュート文字は `--orbit-muted`（#647184・#f7f8fa に対して 4.66:1）、アクセント地の白文字と、アクセント色の文字は `--orbit-accent-solid`（5 テーマそれぞれ。`--orbit-accent` / `-strong` は白文字で 4.5:1 に届かない）、フォーカスは `--orbit-focus`（ダークは `:root[data-theme="dark"]` で上書き）。`a11y-contrast.test.ts` が styles.css を読んでコントラスト比を計算するので、色を足すときはこのテストを通す（参照: `src/styles.css`、`src/components/a11y-contrast.test.ts`）。
- トーストは `useToast()` と `ToastRegion`。`role="status"` と `role="alert"` のライブリージョンが常に DOM にあるため、「エラーが出ていない」の判定は `[role="alert"]:not(:empty)` を使う。アクションなしの成功だけが 3.5 秒で消える（参照: `src/components/OrbitApp.tsx`）。
- Background Run は pending / running だけがブロッキングのダイアログ。paused / failed は `.run-banner`（閉じられる。run_id と status の組で再表示を判定）（参照: `src/components/OrbitApp.tsx`）。
- 1 文字ショートカットは localStorage `orbit.singleKeyShortcuts`（`"off"` のときだけ OFF）。`shortcutActionFor` に `singleKeyEnabled` と `onSelectControl`（SELECT / `[role=combobox]` / `[role=listbox]`）を渡す（参照: `src/components/issue-core-ui.ts`）。
- `html lang` は翻訳が入るまで `ja` に固定。保存済みの `locale: "en"` はサーバーの値を変えずに残す。
- Cycle の完了 API は次の Cycle が無ければ作ってから繰り越すので、「次の Cycle が無い」場合の分岐は UI に不要。繰越の件数は category が `unstarted` / `started` の Issue（参照: `src/server/store.ts` の `closeCycle`）。

- WCAG の残り（FIX-a11y-aa-remaining）: 入力欄の枠線は `--orbit-input-border`（ダークは `:root[data-theme="dark"] <sel>:not(:focus)` で上書き）。`document.title` は `OrbitApp` の effect で「<画面名> — Orbit」（`src/routes/**` の `head()` は使わない）。Settings の select は見出しの `<strong id="setting-*-label">` を `aria-labelledby` で参照する。Inbox の切替は `aria-pressed` のトグル、Cycle のタブは roving tabindex の tab パターン。Issue 一覧は div のまま `role="table"` などを付けている。
- 罠: `styles.css` の末尾にトップレベルのルールを足すと、前にある `@media (max-width: 767px)` 内の同じ詳細度のルール（モバイルの 44px など）を後勝ちで上書きする。デスクトップだけの値は `@media (min-width: 768px)` に入れる（`a11y-contrast.test.ts` に検出テストあり）。
- Cron Trigger（FEAT-cycle-cron）: Worker entryは`src/server.ts`（`fetch`はTanStack Startのまま + `scheduled`）。`wrangler.jsonc`トップレベルの`triggers.crons`（毎時0分UTC）は`env.production`へ継承される。`scheduled`は`runScheduledCycles(env)`を呼び、Ownerをenv（`OWNER_USER_ID` / `OWNER_EMAIL`、localは`LOCAL_OWNER`）と`users`行で確認してから、`OrbitStore.runScheduledCycleTransitions`でCycleの終了・繰越・予定どおりの開始だけを行う。Background RunもLockも作らず、PurgeとOutbox再送は実行しない。保存は処理があった時か`needsInitialPersist`の時だけで、`D1_WRITE_CONFLICT`は読み直して合計3回まで試行する。自動開始のActivityは`system:automation` / `scheduled-<cycleId>-start`（参照: `src/server.ts`、`src/server/scheduled-cycles.ts`、`src/server/store.ts`、`docs/spec/FEAT-cycle-cron/`）。
- 罠: `createServerEntry`は`fetch`以外のハンドラを落とすので、entryは素のオブジェクトで書く。`wrangler.jsonc`の`main`を`src/server.ts`にしないと独自entryは使われない。`package.json`の`format` / `format:check`は対象を列挙しているため、`src/`直下に足したファイルは追記しないと検査されない。Background Runは3ステップ固定かつブラウザが`continue`を呼んで進める方式で、Cycleだけを処理するRunは作れない。Inbox通知（`cycle_started`など）を生成するコードは無い（参照: `src/server.ts`、`src/server/store.ts`、`src/components/background-run.ts`）。

## 最終更新

FIX-ux-a11y-high / FIX-a11y-aa-remaining / FEAT-cycle-cron / 2026-10-06

FEAT-project-manual-order / FEAT-issue-hierarchy-list / FIX-mobile-nav-filter-sheet / FIX-snapshot-growth / FIX-mobile-workspace-ux / FIX-main-review / FEAT-review-followup修正 / FIX-rollback-compatibility / 2026-10-05

MVP初回実装 / FEAT-issue-detail-workspace / FEAT-cycle-workspace / FEAT-project-view-workspace / FEAT-label-bulk-workspace / REL-d1-persistence作業中 / FEAT-feedback-polish / FEAT-issue-controls / FEAT-issue-experience-polish / PHASE1-foundation / PHASE2-issue-core / FIX-cycle-initial-bootstrap / FEAT-cycle-settings / CYC-11 / CYC-14 / CYC-17 / CI-CD-github-actions / FEAT-home-project-inbox-ux / FEAT-local-only・LAN拡張 / 2026-09-12
