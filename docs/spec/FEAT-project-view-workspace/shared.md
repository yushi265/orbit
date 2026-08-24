# FEAT-project-view-workspace: shared契約

## 担保AC

- **AC-2**: Project詳細でname（Unicode 1〜100）、description（0〜2,000）、statusId、targetAtを保存でき、既存Project APIのOwner / Runtime lock / idempotency契約を維持する。失敗時は入力を保持してRetryできる。
- **AC-3**: 本人がSaved Viewをname（1〜80）・IssueQuery・layout付きで作成・編集・削除でき、同じKeyの再送はNo-op、異なるRequestは409、Runtime lock中は423になる。

## 公開契約

```ts
type ProjectMetadataMutation = {
  idempotencyKey: string
  name?: string
  description?: string
  statusId?: string
  priority?: Priority
  color?: string
  icon?: string
  startAt?: number | null
  targetAt?: number | null
}

type SavedViewMutation = {
  idempotencyKey: string
  name: string
  query: IssueQuery
  layout?: Record<string, boolean>
}

type SavedViewUpdate = {
  idempotencyKey: string
  name?: string
  query?: IssueQuery
  layout?: Record<string, boolean>
}
```

Zod strict schemaを入口にし、ProjectのnameはUnicode 1..100、descriptionは0..2,000、View nameはUnicode 1..80。既存IssueQueryのunknown keyは拒否する。

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| 長さ / query不正 | 400 `VALIDATION_ERROR` |
| 内部Token / unknown key | decode拒否 |
| Project / View Owner外 | 404 |

## テストケース

- [境界値] Project name 0 / 1 / 100 / 101、description 0 / 2,000 / 2,001。
- [境界値] View name 0 / 1 / 80 / 81、Unicode astral code point。
- [デシジョンテーブル] query valid / unknown key、metadata unknown key。
