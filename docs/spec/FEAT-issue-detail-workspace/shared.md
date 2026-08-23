# FEAT-issue-detail-workspace: shared契約

## 担保AC

- **AC-1**: 本人が `/issues/$issueId` を開くと、対象Issueの主要属性、Markdown互換の説明、Notes、Relations、ActivityがOwner scopedで表示され、存在しないIssueまたは他OwnerのIssueは404相当の安全な詳細表示になる。
- **AC-3**: 本人が1〜10,000文字のMarkdown互換メモを追加・編集・論理削除でき、空文字・10,001文字・他OwnerのNoteは拒否され、成功した追加・編集・削除はIssue Activityへ1件だけ記録される。
- **AC-4**: 本人が別の本人所有Issueへ `blocking / blocked_by / related / duplicate` Relationを追加・削除でき、自己参照・他Owner参照・同一Relationの重複は業務データを変更せず安全なエラーまたはNo-opになる。詳細画面ではRelation先のIssue番号とタイトルを表示する。

## 公開契約

```ts
type IssueDetailResponse = {
  issue: IssueViewModel
  notes: IssueNoteViewModel[]
  relations: IssueRelationViewModel[]
  activity: ActivityViewModel[]
}

type NoteMutation = { idempotencyKey: string; body: string }
type RelationMutation = { idempotencyKey: string; targetIssueId: string; type: RelationType }
type RelationType = 'blocking' | 'blocked_by' | 'related' | 'duplicate'
```

Note bodyはUnicode code pointで1..10,000、Relation typeは固定4値、IDは空でない文字列を受け付ける。公開型に内部Token・Cookie・emailは含めない。

## 依存 / 配置

- `src/shared/contracts/issue-detail.ts`
- `src/shared/view-models.ts`
- `src/server/model.ts`の内部型はUIへ公開しない。

## 異常系

| シナリオ | 挙動 |
|---|---|
| body空 / 10,001文字 | `VALIDATION_ERROR` / 400、fieldErrors.body |
| target不存在 / Owner不一致 | `RESOURCE_NOT_FOUND` / 404 |
| 自己Relation / duplicate | `VALIDATION_ERROR`または409、業務効果なし |
| 内部Token混入 | strict schemaでdecode拒否 |

## テストケース

- [境界値] Note body 0 / 1 / 10,000 / 10,001文字 → 400 / 成功 / 成功 / 400
- [同値分割] Relation type 4 wire value → 成功、表示名 → 400
- [代表値] Detail responseのissue / notes / relations / activityをdecode
- [デシジョンテーブル] Token / Cookie / email / unknown keyの混入 → decode拒否
