# FEAT-issue-detail-workspace: service契約

## 担保AC

- **AC-1**: 本人が `/issues/$issueId` を開くと、対象Issueの主要属性、Markdown互換の説明、Notes、Relations、ActivityがOwner scopedで表示され、存在しないIssueまたは他OwnerのIssueは404相当の安全な詳細表示になる。
- **AC-2**: Issue詳細で説明を編集して保存すると、versionが1増えActivityが1件追加され、同じversionを使った競合Mutationは409になり既存の説明・Activity・Outboxを変更しない。保存中は入力を編集でき、失敗時は直前の内容へ戻して再試行を表示する。
- **AC-3**: 本人が1〜10,000文字のMarkdown互換メモを追加・編集・論理削除でき、空文字・10,001文字・他OwnerのNoteは拒否され、成功した追加・編集・削除はIssue Activityへ1件だけ記録される。
- **AC-4**: 本人が別の本人所有Issueへ `blocking / blocked_by / related / duplicate` Relationを追加・削除でき、自己参照・他Owner参照・同一Relationの重複は業務データを変更せず安全なエラーまたはNo-opになる。詳細画面ではRelation先のIssue番号とタイトルを表示する。
- **AC-5**: Background Runがrunningの間、説明・Note・RelationのMutationは423 `OPERATION_IN_PROGRESS`で拒否され、Issue version・Activity・Outbox・Note・Relationを増やさない。読み取りは継続できる。

## 公開HTTP API

| Method | Path | Request | Success |
|---|---|---|---|
| GET | `/api/v1/issues/:issueId` | — | `200 { issue, notes, relations, activity }` |
| POST | `/api/v1/issues/:issueId/notes` | `NoteMutation` | `201 { note }` |
| PATCH | `/api/v1/issues/:issueId/notes/:noteId` | `NoteMutation` | `200 { note }` |
| DELETE | `/api/v1/issues/:issueId/notes/:noteId` | `Idempotency-Key` | `200 { ok: true }` |
| POST | `/api/v1/issues/:issueId/relations` | `RelationMutation` | `201 { relation }` |
| DELETE | `/api/v1/issues/:issueId/relations/:relationId` | `Idempotency-Key` | `200 { ok: true }` |

全Mutationに `X-Requested-With: XMLHttpRequest`、same-origin credentials、idempotencyKey、Owner / Runtime lock guardを適用する。

## 依存 / 配置

- `src/server/api.ts` / `src/routes/api/v1/issues/`
- `src/server/store.ts`の既存CAS / receipt / activity / outbox
- `src/shared/contracts/issue-detail.ts`

## 異常系

| シナリオ | 挙動 |
|---|---|
| Detail不存在 / Owner外 | 404 `RESOURCE_NOT_FOUND` |
| Note / Relation validation | 400 `VALIDATION_ERROR` + fieldErrors |
| Issue version conflict | 409 `ISSUE_VERSION_CONFLICT`、副作用なし |
| Runtime lock | 423 `OPERATION_IN_PROGRESS`、副作用なし |
| 同じKey異なるRequest | 409 `IDEMPOTENCY_KEY_REUSED` |

## テストケース

- [代表値] Detail APIが全セクションを返す
- [デシジョンテーブル] Detail / Note / RelationのOwner一致 / 不一致 / 不存在
- [状態遷移] Note create → edit → deleteとActivity件数
- [同値分割 + 境界値] 1 / 10,000 / 10,001文字Note
- [デシジョンテーブル] self / duplicate / valid Relation
- [状態遷移] running lock中の各Mutation → 423、副作用0
