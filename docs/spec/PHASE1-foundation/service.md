# PHASE1: service

## 担保 AC（[index.md](./index.md) の引用）

- **AC-2**: 本番の認証境界は、Access JWT・issuer・audience・email・`OWNER_USER_ID`に対応する`users`行をすべて検証し、未認証・設定不足・D1 binding不足・Owner不一致ではMemory Storeへフォールバックせず、定義済みの401または500 ErrorEnvelopeを返す。
- **AC-3**: 本人のPreferencesは`timezone`、`locale`、`theme`、`colorTheme`、`estimateEnabled`を既存の`PATCH /api/v1/preferences`で更新でき、許可値・IANA timezone・Owner境界・idempotencyを検証し、成功値が再取得後も保持される。Settingsでは各項目の初期・保存中・成功・失敗状態を操作可能に表示する。
- **AC-4**: 本人はWorkflow stateを一覧・追加・名称/色/順序/既定値変更・削除できる。カテゴリは`backlog / unstarted / started / completed / canceled`に限定し、Owner外の参照を拒否し、既定stateは常に1件、Issueが参照中または既定stateの削除は拒否し、同じidempotencyKeyの再送はNo-opになる。
- **AC-5**: Background Runが`pending`または`running`の間、Preferences / Workflowを含む業務Mutationは423 `OPERATION_IN_PROGRESS`で拒否され、Issue・Activity・Outbox・Receipt・設定値を変更しない。`GET /api/v1/background-runs/current`とBootstrapは本人のRun状態だけを返し、`lock_token`と`admission_token`を公開しない。

## このレイヤーが公開する契約

| Method / Path | Request | Response / Error |
|---|---|---|
| `PATCH /api/v1/preferences` | `PreferencesMutation` | `200 { preferences: Preferences }`。不正は400、lock中は423 |
| `GET /api/v1/workflow-states` | なし | `200 { workflowStates: WorkflowState[] }` |
| `POST /api/v1/workflow-states` | `WorkflowStateCreateMutation` | `200 { workflowState: WorkflowState }`。不正は400、lock中は423 |
| `PATCH /api/v1/workflow-states/:workflowStateId` | `WorkflowStateUpdateMutation` | `200 { workflowState: WorkflowState }`。不存在/Owner外は404 |
| `DELETE /api/v1/workflow-states/:workflowStateId` | `Idempotency-Key` header | `200 { ok: true }`。既定/参照中は400、lock中は423 |
| `GET /api/v1/background-runs/current` | なし | `200 { run: PublicRunSummary | null }`。Tokenを含めない |

全Mutationは`X-Requested-With: XMLHttpRequest`、`credentials: same-origin`、Owner解決、strict Schema、Runtime lock、idempotencyの順に通す。Workflowのcreate / update / deleteは`OrbitStore`のOwner scoped methodだけを呼ぶ。

## 異常系挙動

| シナリオ | serviceの挙動 |
|---|---|
| JWTなし・設定不足・JWT不一致・users行なし | `401 AUTH_REQUIRED`。productionでMemory Storeへfallbackしない |
| production D1 bindingなし / 読み書き障害 | `500 INTERNAL_ERROR`。secret・個人データをログへ出さない |
| Preferences / Workflowの入力不正 | `400 VALIDATION_ERROR` + fieldErrors |
| Owner外のWorkflow ID | `404 RESOURCE_NOT_FOUND` |
| 既定/参照中Workflowの削除 | `400 VALIDATION_ERROR`。他のWorkflowやIssueを変更しない |
| active Run中のMutation | `423 OPERATION_IN_PROGRESS`。Handlerを実行せず副作用なし |
| 同じKey・同じRequest | 保存済みResponseを返し副作用なし |
| 同じKey・異なるRequest | `409 IDEMPOTENCY_KEY_REUSED`。本文・Key・hashを返さない |

## テストケース（技法注記付き）

- [デシジョンテーブル] JWTなし / 設定不足 / D1なし / email不一致 / users不一致を401または500へ分岐する。
- [状態遷移] Preferencesの各項目を更新→Bootstrapで再取得し、未指定項目を保持する。
- [境界値] timezoneの`UTC`・`Asia/Tokyo`を受理し、空・不明値を400にする。
- [代表値] Workflow list / create / update / deleteのHTTP契約を検証する。
- [状態遷移] Workflow default変更とposition変更を再取得し、default 1件・順序を確認する。
- [状態遷移/禁止] 参照中・既定Workflow deleteの400と副作用0を確認する。
- [状態遷移] 同じWorkflow mutation keyの再送をNo-op、異なるRequestを409にする。
- [代表値] PublicRunSummaryとBootstrapのJSONを検査し、内部Tokenがないことを確認する。
- [デシジョンテーブル] Runなし / pending / running / paused / failed / succeededのcurrent表示とMutation lockを分岐検証する。
