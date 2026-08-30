# FEAT-home-project-inbox-ux: service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-3**: ProjectごとのIssue workspace表示設定（List / Board、検索、Status / Priority / Label / 期限Filter、並び順、完了Issue表示切替）はOwner scopedなサーバー状態として保存され、別端末のBootstrap再取得後に同じProjectで復元される。設定未保存のProjectは定義済み初期値で表示する。
- **AC-4**: Project表示設定のMutationは既存のOwner境界、same-origin、idempotencyKey、Runtime lockを守る。同じKey・同じRequestの再送は同じ設定を返し、同じKey・異なるRequestは409、入力不正は400、存在しないまたはOwner外Projectは404、Runtime lock中は423になり、設定を部分更新しない。Inboxは既存通知の既読化・対象遷移を維持したまま、Inboxの役割、通知の読み方、通知がない場合の次の行動を画面上で説明する。
- **AC-5**: Home、Project詳細、InboxはLoading、空、保存中、400 / 404 / 409 / 423 / 500系エラー、成功状態を既存のエラー表示方針で示し、Pointer / Keyboardの双方で主要操作を実行できる。Desktop（1200px以上）、Tablet（768〜1199px）、Mobile（767px以下、390pxを含む）で横方向の表示崩れを起こさない。

## このレイヤーが公開する契約（外部インターフェース）

### Bootstrap

`GET /api/v1/bootstrap`の200 responseへ次を追加する。

```ts
{
  // existing fields ...
  projectDisplayPreferences: ProjectDisplayPreferenceViewModel[]
}
```

返却は認証済みOwnerのProjectに属する設定だけとする。

### Project display preferences

既存`PATCH /api/v1/projects/:projectId`へdisplay preference branchを追加する。

Request:

```json
{
  "idempotencyKey": "ui-...",
  "displayPreferences": {
    "mode": "list",
    "filterText": "",
    "statusFilter": "all",
    "priorityFilter": "all",
    "labelFilter": "all",
    "dueFilter": "all",
    "showCompleted": true,
    "order": "updated_desc"
  }
}
```

Response:

```json
{
  "projectDisplayPreference": {
    "id": "project-display_...",
    "userId": "owner",
    "projectId": "project_...",
    "settings": {},
    "updatedAt": 0
  }
}
```

`displayPreferences`を持つRequestはmetadata `patch`と同時に受け付けず、shared strict schemaで検証して`store.updateProjectDisplayPreferences`を呼ぶ。`withOwner`がsame-origin / Access / Snapshot Sessionを適用する。

### Existing Inbox contract

Inboxの既存API契約は変更しない。

- `GET /api/v1/notifications` → `{ items: Notification[] }`
- `PATCH /api/v1/notifications/:notificationId` → `{ idempotencyKey, read }` → `{ notification }`

通知生成は本チケットのService scopeに含めない。

### Project-scoped Issue reorder

既存`POST /api/v1/issues/reorder`のRequestへProject detailから任意の`projectId`を追加できるようにする。
`projectId`を指定した場合、対象Issueと`beforeIssueId`は同じOwner・同じProjectに属する必要があり、Project内のpositionだけを並べ替える。既存のProject未指定Requestの挙動は変更しない。

## このレイヤーが依存する下位の契約

- `withOwner`のOwner / Request ID / same-origin / Snapshot persist。
- shared `projectDisplayPreferencesMutationSchema`。
- data `updateProjectDisplayPreferences` / `bootstrap` projection。

## 実装配置

- `src/server/api.ts`: Bootstrap projectionとProject PATCH display preference branch。
- `src/routes/api/v1/projects/$projectId.ts`: 既存PATCH routeを再利用。
- `src/server/store.ts`: data method呼び出し。
- `src/server/api-project-display.test.ts`または既存Project API test: API contract / error / replay。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| JSON欠落・未知キー・型違反 | 400 `VALIDATION_ERROR` + fieldErrors、Storeを呼ばない |
| Project不存在 / Owner外 | 404 `RESOURCE_NOT_FOUND`、Response以外の状態不変 |
| 同じKey・同じRequest | 200で同じ`projectDisplayPreference`を返す |
| 同じKey・異なるRequest | 409 `IDEMPOTENCY_KEY_REUSED` |
| Runtime lock | 423 `OPERATION_IN_PROGRESS`、設定を確定しない |
| Bootstrap取得 | 設定recordをOwnerで絞り、未保存ProjectはUIが初期値を補う |

## テストケース（技法注記付き）

- [代表値] Bootstrapに本人のProject表示設定だけが含まれる。
- [契約] `displayPreferences` branchの正常Requestが200と設定recordを返す。
- [デシジョンテーブル] Owner一致 / Owner外 / 不存在 / 削除済みを200 / 404へ分岐する。
- [同値分割] 同じKey・同じRequestは同じresponse、同じKey・異なるRequestは409になる。
- [デシジョンテーブル] lock idleは200、runningは423になり、業務データを変更しない。
- [境界値] `filterText` 255文字は200、256文字は400になる。
- [代表値] Inbox read APIの既存個別既読・対象遷移が回帰しない。
- [代表値] `projectId`付きreorderは同一Project内だけを並べ替え、別Projectのpositionを変更しない。
