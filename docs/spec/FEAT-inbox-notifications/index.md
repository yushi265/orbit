# FEAT-inbox-notifications: Inbox / Notification

## 概要

Inboxで通知を一覧し、個別または全件を既読化できるようにする。通知の対象がIssue / Cycle / Projectの場合は対象画面へ遷移し、未読数をNavigationへ反映する。

## 対象範囲

- 対象レイヤー: shared / data / service / ui
- 対象: Notification read contract、既存Store/APIのstrict化、全件既読UI、対象画面遷移、empty / error / responsive
- 対象外: 通知生成ルール・スケジューラ・外部配送、D1 repository / migration、Push通知、通知設定CRUD

## ユニット計画

| # | ユニット | 含むAC | 状態 |
|---|---|---|---|
| 1 | Notification contract / service | AC-1 | 完了 |
| 2 | Inbox UI / navigation | AC-2, AC-3 | 完了 |

## 受け入れ基準（AC）

- [x] **AC-1**: 本人のNotificationだけをInboxに表示し、read mutationはidempotencyKey・Owner・Runtime lock・ErrorEnvelope契約を守る。同じKeyの再送はNo-op、欠落・型違反は400、lock中は423になる。
- [x] **AC-2**: 個別通知のクリックで既読化し、Issue / Cycle / Projectの対象画面へ遷移できる。「すべて既読」で未読を一括既読化し、未読badgeが0になる。
- [x] **AC-3**: Loading / empty / 400 / 404 / 423を明示し、mobileを含む各幅で横overflowがなく、notification rowと操作をKeyboardで実行できる。

## アーキテクチャ / API

```text
Bootstrap.notifications + GET /api/v1/notifications
  ↓
InboxView
  ├─ PATCH /api/v1/notifications/:notificationId { idempotencyKey, read }
  └─ all read = owned notificationsへ個別PATCH
```

既存Notification model / Store / Routeを再利用し、通知生成は今回のスコープ外とする。

## エラー・ログ方針

| シナリオ | API | UI |
|---|---|---|
| 欠落・型違反 | 400 `VALIDATION_ERROR` + fieldErrors | 入力状態を維持、alert |
| 不存在 / Owner外 | 404 `RESOURCE_NOT_FOUND` | alert、一覧を維持 |
| Runtime lock | 423 `OPERATION_IN_PROGRESS` | 未読を確定せず再試行可能 |

## テスト戦略

| AC | 単体 | API / Browser smoke |
|---|---|---|
| AC-1 | read schema boundary | API 400 / 404 / 423 / replay |
| AC-2 | target routing mapper | local browser individual / all read |
| AC-3 | unread count mapper | 390 / 768 / 1200px、empty、Keyboard |

実D1 / Access / PlaywrightはRelease hardeningへ延期する。

## 判断根拠 / 未決事項

- 全件既読は新しいBulk endpointを増やさず、既存のOwner / Receipt境界を通る個別PATCHを使う。
- 通知生成を同じボルトへ入れると、期限・Cycle・Runの発火契約が増えるため、既存データを読むInboxに限定する。
- `dev-owner`のseed notificationはローカルBrowser smoke用fixtureであり、通知生成ルールの実装ではない。
- 未決事項なし。自律実行指示によりGate 2委任で進める。
