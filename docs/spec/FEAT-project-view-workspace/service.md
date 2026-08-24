# FEAT-project-view-workspace: service契約

## 担保AC

- **AC-1**: 本人がProjects画面でProjectを選択すると、Project名・説明・Status・期限、Owner scopedなIssue一覧を詳細表示できる。存在しない / 他OwnerのProjectは404相当の安全な表示になる。
- **AC-2**: Project詳細でname（Unicode 1〜100）、description（0〜2,000）、statusId、targetAtを保存でき、既存Project APIのOwner / Runtime lock / idempotency契約を維持する。失敗時は入力を保持してRetryできる。
- **AC-3**: 本人がSaved Viewをname（1〜80）・IssueQuery・layout付きで作成・編集・削除でき、同じKeyの再送はNo-op、異なるRequestは409、Runtime lock中は423になる。
- **AC-4**: Saved View一覧はOwner scopedで表示され、Viewを選択すると保存したmode / order / filterの内容を確認できる。削除後は一覧から除外される。

## 公開HTTP API

| Method | Path | Request | Success |
|---|---|---|---|
| PATCH | `/api/v1/projects/:projectId` | ProjectMetadataMutation | `200 { project }` |
| POST | `/api/v1/views/` | SavedViewMutation | `201 { view }` |
| PATCH | `/api/v1/views/:viewId` | SavedViewUpdate | `200 { view }` |
| DELETE | `/api/v1/views/:viewId` | Idempotency-Key | `200 { ok: true }` |

全Mutationにsame-origin、Owner、idempotency、Runtime lockを適用する。

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| 400 validation | ErrorEnvelope + fieldErrors |
| 404 Owner外 / 不存在 | ErrorEnvelope `RESOURCE_NOT_FOUND` |
| 409 same key different request | `IDEMPOTENCY_KEY_REUSED` |
| 423 Runtime lock | `OPERATION_IN_PROGRESS` |

## テストケース

- [代表値] Project PATCH / View POST / PATCH / DELETEの成功レスポンス。
- [デシジョンテーブル] Project / View 400 / 404 / 409 / 423とErrorEnvelope code。
- [状態遷移] View replay / delete replayと一覧反映。
