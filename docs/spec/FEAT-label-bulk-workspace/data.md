# FEAT-label-bulk-workspace: data契約

## 担保AC

- **AC-1**: 本人がLabelをname（Unicode 1〜50）・color（`#RRGGBB`）で作成・編集・削除できる。一覧はOwner scopedで、削除時はIssueから該当Label参照を除去する。同じKeyの再送はNo-op、内容違いは409、Runtime lock中は423になる。
- **AC-2**: 本人が1〜100件の自分のIssueを選択し、status / priority / cycle / project / labelのいずれか1つを一括更新できる。参照先のOwner、Issueの存在・未削除を検証し、全件成功または全件不変の原子性を保つ。成功した各Issueはversionを1増やす。
- **AC-4**: Issue行にLabel名・色を表示し、Label filterで絞り込める。SettingsのLabel管理とIssuesのBulk選択は同じBootstrap情報を使う。

## データ構造

- `Label`: `{ id, userId, name, color }`
- `OrbitStore.labels`: `Map<string, Label>`。`userId + name`はcase-sensitiveのtrim後に一意。
- `Issue.labelIds`: 同一Label IDの重複を許可せず、参照先は同じOwnerのLabelだけ。
- Bulk snapshotは対象Issue、Activity、Outbox、Receiptの変更前を保持し、検証または適用で例外が出た場合に戻す。

## 異常系挙動

- Label name empty / 51 code points、color非hex、bulk issueIds empty / 101件、patch空は400。
- Owner外Label / Issue / Project / Cycle / Statusは404。失敗時にLabel / Issue / Activity / Outbox / Receiptを変更しない。
- Label deleteは対象Labelを先にOwner確認し、Issueから参照だけを除去する。
- Runtime lockは全Label / Bulk Mutationの冒頭で検査する。

## テストケース

- [同値分割] Label name 1 / 50 / 51 Unicode、color `#000000` / `#FFFFFF` / invalid。
- [状態遷移] Label create → update → issue assign → delete → issue label removal。
- [デシジョンテーブル] Bulkの各patch（status / priority / cycle / project / label）とOwner一致 / 外部Owner / 不存在。
- [境界値] bulk issueIds 0 / 1 / 100 / 101、duplicate IDsの正規化。
- [状態遷移] Bulk success / validation rollback / lock 423 / same-key replay / different-request 409。
