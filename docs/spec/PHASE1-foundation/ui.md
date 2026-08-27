# PHASE1: ui

## 担保 AC（[index.md](./index.md) の引用）

- **AC-3**: 本人のPreferencesは`timezone`、`locale`、`theme`、`colorTheme`、`estimateEnabled`を既存の`PATCH /api/v1/preferences`で更新でき、許可値・IANA timezone・Owner境界・idempotencyを検証し、成功値が再取得後も保持される。Settingsでは各項目の初期・保存中・成功・失敗状態を操作可能に表示する。
- **AC-5**: Background Runが`pending`または`running`の間、Preferences / Workflowを含む業務Mutationは423 `OPERATION_IN_PROGRESS`で拒否され、Issue・Activity・Outbox・Receipt・設定値を変更しない。`GET /api/v1/background-runs/current`とBootstrapは本人のRun状態だけを返し、`lock_token`と`admission_token`を公開しない。
- **AC-6**: FoundationのSettings / Background UIはDesktop・Tablet・390px幅のMobileで横overflowを発生させず、初期・ローディング・空・保存中・エラー・成功・再開可能状態を示し、主要操作をKeyboard / Pointerで実行できる。401は既存のTransport分類を経由して現在のDeep linkへのTop-level再認証へ進む。

## このレイヤーが公開する契約

| 画面 / 部品 | 使用契約 | 状態 |
|---|---|---|
| `/settings` | Bootstrapの`preferences` / `workflowStates` / `background.run`、Preferences API、Workflow API | 初期値、保存中、成功、400/404/409/423/500、空を表示 |
| Background Overlay | `PublicRunSummary`、`GET /api/v1/background-runs/current` | pending/runningは操作を遮断、paused/failedはResume、succeeded/rejectedは解除 |
| API client | `credentials: same-origin`、`X-Requested-With: XMLHttpRequest` | 401は現在のpath + search + hashを保持してTop-level navigation |

Settingsでは既存のAppearance / Background processingカードを再利用し、Preferencesのselect / checkboxとWorkflowの一覧・編集・追加・削除を同一ページへ配置する。保存中は対象操作をdisabledにし、失敗時は入力値を保持してRetryを表示する。

## UI/UX 方針

- **画面フロー / 導線**: SidebarまたはMobile NavigationからSettingsへ入り、AppearanceでPreferences、Workflowカードで状態設定、Background processingでRun起動・再開を行う。
- **主要操作とフィードバック**: Preferencesは変更時に即時保存し、成功時は現在値を確定する。Workflowは追加・編集・順序・default・削除を個別保存し、成功時にBootstrapを再取得する。423では入力と再試行Keyを保持する。
- **状態設計（出し分け）**: Bootstrap loadingは既存loading screen、API失敗はError / Retry、Workflow 0件は空状態、保存中は対象controlをdisabled、成功はToastと表示更新、paused / failedはResume Cardとする。
- **既存デザインシステムとの整合**: `.settings-card`、`.setting-row`、`.button`、`.text-button`、`.detail-live-error`、既存のToast / RunOverlayを再利用する。

### レスポンシブ / アクセシビリティ

- 対象はDesktop、Tablet、390px以上のMobile。主対象は390pxと1280px、Tabletは2列が崩れる場合に1列へ落とす。
- Workflowの編集行はMobileで1列または折返し、色入力とボタンが横にはみ出さない。タッチ対象は44px相当の操作領域を確保する。
- 各select / input / buttonには可視labelまたはaccessible nameを付け、エラーは`role="alert"`、処理中状態は`role="status"`で伝える。色だけで状態を表現しない。
- `prefers-reduced-motion`では既存のmotion抑制を維持し、Overlayの遮断対象と再認証導線は動きに依存しない。

## 異常系挙動

| シナリオ | uiの挙動 |
|---|---|
| 401 | Transport分類後、現在のDeep linkを保持してTop-level再認証へ遷移 |
| 400 | fieldErrorsを対象controlへ表示し、入力を保持 |
| 404 / 409 | 対象を失わず、最新BootstrapまたはConflict案内を表示 |
| 423 | 対象操作を確定せず、Background表示とRetry導線を維持 |
| 500 / timeout / offline | 保存前の値を保持し、Retryを表示。別項目を壊さない |

## テストケース（技法注記付き）

- [状態遷移] Settings初期表示→Preferences保存中→成功で値を更新し、失敗では旧値とRetryを保持する。
- [状態遷移] Workflow空→追加→編集→default変更→position変更→削除の表示を確認する。
- [デシジョンテーブル] API 400 / 404 / 409 / 423 / 500 / 401を項目別の表示へ変換する。
- [代表値] pending / runningでOverlayが業務操作を遮断し、paused / failedでResume、succeededで解除する。
- [境界値] 390pxでSettingsとWorkflowの横overflowがなく、Tabletでカードが崩れない。
- [アクセシビリティ] Keyboardでselect / input / add / edit / default / delete / retryを操作し、alert/statusとFocusを確認する。
