# FEAT-issue-detail-workspace: data契約

## 担保AC

- **AC-1**: 本人が `/issues/$issueId` を開くと、対象Issueの主要属性、Markdown互換の説明、Notes、Relations、ActivityがOwner scopedで表示され、存在しないIssueまたは他OwnerのIssueは404相当の安全な詳細表示になる。
- **AC-3**: 本人が1〜10,000文字のMarkdown互換メモを追加・編集・論理削除でき、空文字・10,001文字・他OwnerのNoteは拒否され、成功した追加・編集・削除はIssue Activityへ1件だけ記録される。
- **AC-4**: 本人が別の本人所有Issueへ `blocking / blocked_by / related / duplicate` Relationを追加・削除でき、自己参照・他Owner参照・同一Relationの重複は業務データを変更せず安全なエラーまたはNo-opになる。詳細画面ではRelation先のIssue番号とタイトルを表示する。

## 公開契約

既存 `issue_notes` / `issue_relations` / `activity_events` を再利用する。今回のMigration追加はない。

- Note: `{ id, userId, issueId, body, createdAt, editedAt, deletedAt }`
- Relation: `{ id, userId, sourceIssueId, targetIssueId, type, createdAt }`
- Activity: 既存 `ActivityEvent`をIssue単位でowner scopedに取得する。

上記は今回のMemory Store / service公開モデルである。既存D1の `issue_notes` は同じNote属性を保持し、`issue_relations` は `source_issue_id / target_issue_id / type` と一意制約を持つため、RelationのOwnerはIssueの所有者Join、識別子と作成日時はD1 adapter側で導出する契約になる。実D1 adapterの実装・同時実行検証は、前フェーズから延期したRelease hardeningの対象であり、今回の縦切りでは変更しない。

Memory Storeでは `notes` / `relations` をMapで保持し、D1のOwner検証・論理削除・一意条件を再現する。Relationの一意キーは `userId:sourceIssueId:targetIssueId:type` とする。

## 依存 / 配置

- `src/server/model.ts`
- `src/server/store.ts`
- `src/db/schema.ts`（既存テーブルを再利用）

## 異常系

| シナリオ | 挙動 |
|---|---|
| Owner外Issue / Note / Relation | 404、Map / DBを変更しない |
| Runtime lock | 423、version / Activity / Outbox / receiptを増やさない |
| Note削除 | `deletedAt`を設定し通常Detailから除外 |
| Relation重複 | 409または既存Relationを返すNo-op |

## テストケース

- [代表値] Detail取得でNote / Relation / ActivityがIssue Ownerだけ返る
- [境界値] Note body 1 / 10,000成功、0 / 10,001拒否
- [状態遷移] Note create → edit → delete、削除後Detailから除外
- [デシジョンテーブル] Relation self / other owner / duplicate / valid
- [状態遷移] Background running中のNote / Relation mutation → 423、副作用0
