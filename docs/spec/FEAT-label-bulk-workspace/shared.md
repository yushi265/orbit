# FEAT-label-bulk-workspace: shared契約

## 担保AC

- **AC-1**: 本人がLabelをname（Unicode 1〜50）・color（`#RRGGBB`）で作成・編集・削除できる。一覧はOwner scopedで、削除時はIssueから該当Label参照を除去する。同じKeyの再送はNo-op、内容違いは409、Runtime lock中は423になる。
- **AC-2**: 本人が1〜100件の自分のIssueを選択し、status / priority / cycle / project / labelのいずれか1つを一括更新できる。参照先のOwner、Issueの存在・未削除を検証し、全件成功または全件不変の原子性を保つ。成功した各Issueはversionを1増やす。

## 公開契約

```ts
type LabelMutation = {
  idempotencyKey: string
  name: string // Unicode 1..50
  color: `#${string}` // runtimeで#RRGGBBを検証
}

type LabelUpdate = {
  idempotencyKey: string
  name?: string
  color?: string
}

type BulkIssueMutation = {
  idempotencyKey: string
  issueIds: string[] // 1..100, unique化
  patch: {
    statusId?: string
    priority?: Priority
    cycleId?: string | null
    projectId?: string | null
    labelIds?: string[]
  }
}
```

Zod strict schemaはunknown key、空patch、空ID、上限超過を拒否する。`color`はhex 6桁を受け付ける。

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| 長さ / 色 / patch不正 | 400 `VALIDATION_ERROR` |
| Owner外参照 | 404 `RESOURCE_NOT_FOUND` |
| 同じKeyの異なるrequest | 409 `IDEMPOTENCY_KEY_REUSED` |
| Runtime lock | 423 `OPERATION_IN_PROGRESS` |

## テストケース

- [境界値] Label name / color / issueIds / labelIdsの最小・最大・不正値。
- [同値分割] Bulk patchをstatus / priority / cycle / project / labelsに分類して確認。
- [デシジョンテーブル] `null` / `[]`の解除とOwner外参照を確認。
