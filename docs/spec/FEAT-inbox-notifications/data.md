# FEAT-inbox-notifications: data契約

## 担保AC

- **AC-1**: 本人のNotificationだけをInboxに表示し、read mutationはidempotencyKey・Owner・Runtime lock・ErrorEnvelope契約を守る。同じKeyの再送はNo-op、欠落・型違反は400、lock中は423になる。

## データ境界

- `OrbitStore.listNotifications`の`userId` / `deletedAt` filterを正本とする。
- `markNotification`はreadAtだけを変更し、Receiptで同じKeyの再送をNo-opにする。

## 異常系挙動

- Owner外・不存在は状態不変で404。Runtime lockは通知とReceiptを変更しない。

## テストケース

- [デシジョンテーブル] read true / false、Owner一致 / 外部Owner / 不存在 / lock。
- [状態遷移] 未読→既読→未読、same-key replay。
