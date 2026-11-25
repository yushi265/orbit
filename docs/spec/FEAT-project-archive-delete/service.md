# FEAT-project-archive-delete: service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: `POST /api/v1/projects/<id>?action=restore`は、Ownerの未削除Projectの`archivedAt`を`null`に戻し、`updatedAt`を更新して200 `{ project }`を返す。`position`は変えない。アーカイブされていないProjectへの要求は成功として扱い、何も変更しない。`?action=archive`と`action`なしは従来のアーカイブと同じ動作をする。
- **AC-2**: `POST /api/v1/projects/<id>?action=delete`は、Ownerの未削除Project（アーカイブ済みを含む）の`deletedAt`と`updatedAt`を現在時刻にし、200 `{ project }`を返す。以降、そのProjectは`GET /api/v1/projects`とBootstrapの`projects`に含まれず、更新・アーカイブ・復元・削除・並べ替え・IssueへのProject設定は404 `RESOURCE_NOT_FOUND`になる。
- **AC-3**: 削除と同じ操作の中で、Ownerの全Issue（アーカイブ済み・ゴミ箱内を含む）のうち`projectId`が削除したProjectのものは、`projectId`を`null`にし、`version`を1増やし、`updatedAt`を更新する。他のIssueと他のProjectは変えない。
- **AC-4**: 復元・削除は、ActivityとOutboxをProjectについて1件ずつ記録する（復元: Activity `restored`・Outbox `project.restored`、削除: Activity `deleted`（`after`に`deletedAt`と外したIssueの件数`detachedIssueCount`）・Outbox `project.deleted`）。同じ`Idempotency-Key`の再送は初回の応答を返して何も変えない。復元で何も変えなかった場合はActivity・Outboxを記録しない。
- **AC-5**: `action`が`archive`・`restore`・`delete`以外は400 `VALIDATION_ERROR`（`fieldErrors.action`）、Projectが無い・他Owner・削除済みは404 `RESOURCE_NOT_FOUND`、Background Runによるロック中は423 `OPERATION_IN_PROGRESS`、`Idempotency-Key`が無いと400 `VALIDATION_ERROR`とし、失敗時はProject・Issue・Activity・Outbox・Receiptを変更しない。
- **AC-10**: 外部bot向けの手順（`docs/external-api.md`）に、Projectのアーカイブ・復元・削除の呼び方と、削除時にIssueのProjectが外れることを書く。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・制約 | 認証 | 用途 |
|---|---|---|---|---|
| 変更 | `POST /api/v1/projects/<id>` | クエリ`action`: `archive`（省略時も同じ）/ `restore` / `delete`。ヘッダー`Idempotency-Key`必須。Bodyなし。応答200 `{ project }`。それ以外の`action`は400 `VALIDATION_ERROR`（`fieldErrors.action`: 「actionはarchive・restore・deleteのいずれかを指定してください。」） | 既存の`withOwner` | アーカイブ・復元・削除 |
| 変更 | `GET /api/v1/projects`、Bootstrapの`projects` | 変更なし（既存どおり`deletedAt`ありを除く。アーカイブ済みは含む） | 既存 | 一覧 |

内部契約:

| 操作 | 名前 | 具体値 |
|---|---|---|
| 変更なし | `OrbitStore.archiveProject(userId, id, idempotencyKey)` | 既存のまま |
| 追加 | `OrbitStore.restoreProject(userId, id, idempotencyKey): Project` | 下記 |
| 追加 | `OrbitStore.deleteProject(userId, id, idempotencyKey): Project` | 下記 |
| 追加 | Handler `restoreProject(request, projectId)` / `deleteProject(request, projectId)` / `postProjectAction(request, projectId)`（`src/server/api.ts`） | `postProjectAction`は`action`クエリで`archiveProject` / `restoreProject` / `deleteProject`へ振り分け（`action`なしは`archiveProject`）。不明な値は`withOwner`の中で`validationError`。形は既存の`postIssueAction`と同じ |
| 変更 | ルート`src/routes/api/v1/projects/$projectId.ts` | `POST`を`postProjectAction`へ |

`restoreProject`の手順:

1. `assertUnlocked`。
2. `checkReceipt(userId, "project.restore", idempotencyKey, { id })`（あれば保存済み応答を返す。削除後の再送も初回の応答になるよう、存在確認より先に行う。既存の`trashIssue`と同じ順）。
3. 対象Projectが無い・他Owner・`deletedAt`ありは`notFound()`。
4. `archivedAt`が`null`なら、Receiptだけ記録して返す。
5. `archivedAt = null`、`updatedAt = clock()`。`recordActivity(userId, "project", id, "restored", key, { archivedAt: 変更前 }, { archivedAt: null })`、`recordOutbox(userId, "project.restored", `project.restored:${id}:${key}`, { projectId: id })`、`recordReceipt(userId, "project.restore", key, { id }, project)`。

`deleteProject`の手順:

1. `assertUnlocked`。
2. `checkReceipt(userId, "project.delete", idempotencyKey, { id })`（存在確認より先。理由は上と同じ）。
3. 対象Projectが無い・他Owner・`deletedAt`ありは`notFound()`。
4. `now = clock()`。`deletedAt = now`、`updatedAt = now`。
5. `this.issues`のうち`userId`が一致し`projectId === id`のもの全て（`archivedAt` / `deletedAt`を問わない）について、`projectId = null`、`version += 1`、`updatedAt = now`。件数を数える。
6. `recordActivity(userId, "project", id, "deleted", key, { deletedAt: null }, { deletedAt: now, detachedIssueCount })`、`recordOutbox(userId, "project.deleted", `project.deleted:${id}`, { projectId: id, detachedIssueCount })`、`recordReceipt(userId, "project.delete", key, { id }, project)`。

- 失敗（404 / 423）は手順3以前で投げるので何も変更しない。
- 削除後の404は、既存の`project.deletedAt`チェック（`updateProject`・`archiveProject`・`reorderProject`・Issueの作成/更新/一括のProject検証）でそのまま満たされる。
- 削除済みProjectは既存の`purgeTargets`で30日後に消える。

## 実装配置

- `src/server/store.ts`、`src/server/api.ts`、`src/routes/api/v1/projects/$projectId.ts`
- `docs/external-api.md`
- テスト: `src/server/project-archive-delete.test.ts`（新規。Store直とHTTP Handler経由）

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| 不明な`action` | 400 `VALIDATION_ERROR`（`fieldErrors.action`）。不変 |
| `Idempotency-Key`なし | 400 `VALIDATION_ERROR`（`fieldErrors.idempotencyKey`）。不変 |
| Projectが無い／他Owner／削除済み | 404 `RESOURCE_NOT_FOUND`。不変 |
| Background Runのロック中 | 423 `OPERATION_IN_PROGRESS`。不変 |
| 同じキー・同じ対象の再送 | 初回の応答。不変 |

## テストケース

| # | 技法 | ケース | AC |
|---|---|---|---|
| S1 | 状態遷移 | 未アーカイブ → restore: 何も変わらず200、Activity・Outboxなし | AC-1, AC-4 |
| S2 | 状態遷移 | アーカイブ済み → restore: `archivedAt=null`、`position`不変、Activity `restored`・Outbox `project.restored`各1 | AC-1, AC-4 |
| S3 | 代表値 | HTTP: `action`なし・`action=archive`でアーカイブされる | AC-1 |
| S4 | 状態遷移 | 未アーカイブ → delete、アーカイブ済み → delete: 一覧・Bootstrapから消える | AC-2 |
| S5 | 状態遷移（禁止遷移） | 削除済みへのupdate / archive / restore / delete / reorder / Issue作成のProject指定 → 404 | AC-2 |
| S6 | デシジョンテーブル | 削除時のIssue: 対象Project×(通常/アーカイブ/ゴミ箱)は外れて`version`+1、他Project・Projectなしは不変 | AC-3 |
| S7 | 代表値 | 削除のActivity `after.detachedIssueCount`とOutbox各1件 | AC-4 |
| S8 | 代表値 | 同じキーの再送（restore / delete）は初回応答・不変 | AC-4 |
| S9 | デシジョンテーブル | HTTP: 不明action 400 / キーなし 400 / 他Owner 404 / ロック中 423 で不変 | AC-5 |
