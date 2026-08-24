# FEAT-label-bulk-workspace: service契約

## 担保AC

- **AC-1**: 本人がLabelをname（Unicode 1〜50）・color（`#RRGGBB`）で作成・編集・削除できる。一覧はOwner scopedで、削除時はIssueから該当Label参照を除去する。同じKeyの再送はNo-op、内容違いは409、Runtime lock中は423になる。
- **AC-2**: 本人が1〜100件の自分のIssueを選択し、status / priority / cycle / project / labelのいずれか1つを一括更新できる。参照先のOwner、Issueの存在・未削除を検証し、全件成功または全件不変の原子性を保つ。成功した各Issueはversionを1増やす。
- **AC-3**: Issues画面のBulk barで対象属性と値を選択して適用・解除でき、成功後に選択解除と再取得を行う。400 / 404 / 409 / 423時は選択と入力を保持し、Error alertと再試行導線を表示する。

## API

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/v1/labels` | — | `{ items: Label[] }` |
| POST | `/api/v1/labels` | `{ idempotencyKey, name, color }` | 201 `{ label }` |
| PATCH | `/api/v1/labels/:labelId` | `{ idempotencyKey, name?, color? }` | 200 `{ label }` |
| DELETE | `/api/v1/labels/:labelId` | `Idempotency-Key` header | 200 `{ ok: true }` |
| POST | `/api/v1/issues/bulk` | `{ idempotencyKey, issueIds: string[], patch: { statusId? / priority? / cycleId? / projectId? / labelIds? } }` | 200 `{ items: Issue[] }` |

Bulk requestはpatchに上記5属性のうち1つだけを含める。`cycleId` / `projectId`はnullで解除、`labelIds`は`[]`で解除する。

## 異常系挙動

- 400は共通ErrorEnvelope + fieldErrors、404は`RESOURCE_NOT_FOUND`、409は`IDEMPOTENCY_KEY_REUSED`、423は`OPERATION_IN_PROGRESS`。
- API入口はZod strict schemaでidempotencyKeyのnull / 数値 / 欠落を拒否する。DELETEはheaderを必須とする。
- Ownerは`withOwner`で解決し、Store側でも対象Label / Issue / 参照先を再検証する。

## テストケース

- [代表値] Label list / create / patch / deleteをHTTP経由で確認。
- [境界値] schema fieldErrors、unknown key、idempotencyKey型、hex色を確認。
- [同値分割] Bulk各patchと複数Issueの成功レスポンスを確認。
- [異常系] Bulk partial validation、Owner外、missing、lock、same-key replay、different-key conflictのstatus / code / 副作用を確認。
