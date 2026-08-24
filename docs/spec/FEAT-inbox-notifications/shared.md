# FEAT-inbox-notifications: shared契約

## 担保AC

- **AC-1**: 本人のNotificationだけをInboxに表示し、read mutationはidempotencyKey・Owner・Runtime lock・ErrorEnvelope契約を守る。同じKeyの再送はNo-op、欠落・型違反は400、lock中は423になる。

## 公開契約

```ts
type NotificationReadMutation = {
  idempotencyKey: string
  read: boolean
}
```

Zod strict schemaでunknown key、null / number / 欠落を拒否する。

## 異常系挙動

- 400 `VALIDATION_ERROR`、404 `RESOURCE_NOT_FOUND`、423 `OPERATION_IN_PROGRESS`をErrorEnvelopeで返す。

## テストケース

- [境界値] read true / false、null / number / missing / unknown key。
- [状態遷移] same-key replay、different request conflict、Owner外 / missing。
