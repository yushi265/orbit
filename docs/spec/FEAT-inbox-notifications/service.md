# FEAT-inbox-notifications: service契約

## 担保AC

- **AC-1**: 本人のNotificationだけをInboxに表示し、read mutationはidempotencyKey・Owner・Runtime lock・ErrorEnvelope契約を守る。同じKeyの再送はNo-op、欠落・型違反は400、lock中は423になる。

## API

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/v1/notifications` | — | `{ items: Notification[] }` |
| PATCH | `/api/v1/notifications/:notificationId` | `{ idempotencyKey, read }` | 200 `{ notification }` |

## 異常系挙動

- API入口はstrict schemaでread mutationを検証し、Delete / external generationは今回対象外。
- `withOwner`とStoreの二重Owner検証、Runtime lock、Receiptを通す。

## テストケース

- [代表値] list / mark individual / replay。
- [契約] missing / null / number / unknown keyは400 fieldErrors。
- [異常系] missing / other owner 404、runtime lock 423、副作用なし。
