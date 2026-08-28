# FEAT-cycle-auto-add: service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: `PATCH /api/v1/cycle-settings` は`autoAddToCurrentCycle`（boolean）を受け付け、BootstrapとSnapshot再読込で保存値を返す。未知フィールド・boolean以外・Owner外・Runtime lock中・同一Keyの異なるRequestは既存の400 / 404 / 409 / 423契約どおり拒否し、旧Snapshotで値が欠落している場合は`false`へ補完する。
- **AC-2**: `autoAddToCurrentCycle = true` かつActive Cycleが存在する時、未所属Issueが作成時にStarted / Completedとなる、または既存Issueのstatusを別statusからStarted / Completedへ変更する、または一括Status変更で同条件を満たす場合、IssueをCurrent Cycleへ割り当てる。IssueのversionはそのMutationで1回だけ進み、明示的な`cycleId`、既にCycle所属、対象外status、Active Cycleなし、設定OFFでは自動割当しない。
- **AC-3**: 自動割当は通常のIssue Activity / Outboxと同じ成功Mutationへ含まれ、`cycle.auto_assigned`・`system:automation`・`before.cycleId = null`・`after.cycleId = Current Cycle ID`を持つAutomation Activityと、重複しない`issue.cycle.auto_assigned` Outboxを記録する。同じidempotencyKeyの再送は保存済みIssueを返し、二重割当・二重履歴・二重Outboxを発生させない。
- **AC-4**: Issue更新は既存のOwner、Runtime lock、version conflict、入力検証、Snapshot Version CAS境界を維持し、入力不正・権限外・lock中・競合時はIssue、Activity、Outbox、Receiptを増やさない。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 設定保存 | `PATCH /api/v1/cycle-settings` | `{ idempotencyKey, durationWeeks, startWeekday, cooldownWeeks?, futureCount?, autoAddToCurrentCycle? }` → `200 { cycleSettings }` | Access / Owner / same-origin / Runtime lock | 自動追加設定 |
| Issue作成 | `POST /api/v1/issues` | Started / Completed statusかつ`cycleId`省略、設定ON、Active Cycleありで自動割当 | Access / Owner / lock | 初期statusの自動追加 |
| Issue更新 | `PATCH /api/v1/issues/:issueId` | `version`必須。statusIdが別statusからStarted / Completedへ変わり、cycleId省略・未所属なら自動割当 | Access / Owner / lock / version CAS | status遷移の自動追加 |
| Issue一括更新 | `POST /api/v1/issues/bulk` | statusId変更時にIssueごと同じ判定。cycleId指定時は自動割当なし | Access / Owner / lock | 一括status遷移の自動追加 |

自動割当条件は次の通り。

```text
settings.autoAddToCurrentCycle === true
AND active Cycle exists
AND issue.cycleId === null
AND request does not explicitly include cycleId (create / update / bulk)
AND next status category is started or completed
AND update has a real status transition (create has no previous status)
```

自動割当時のAutomation Activityは`entityType = "issue"`、`action = "cycle.auto_assigned"`、`actorType = "system:automation"`、`mutationKey = <request idempotencyKey>:cycle-auto-add`、`before = { cycleId: null, statusId }`、`after = { cycleId: active.id, statusId }`とする。Outboxは`type = "issue.cycle.auto_assigned"`、`dedupeKey = "issue.cycle.auto_assigned:<issueId>:<version>"`とし、`issueId`、`cycleId`、`version`をpayloadへ含める。

## このレイヤーが依存する下位の契約

- `cycleSettingsMutationSchema`、`UpdateIssueInput`、`BulkIssueMutation`のstrict schema
- `OrbitStore.listCycles`のOwner-scoped Cycle一覧
- `recordActivity` / `recordOutbox` / `recordReceipt`の一意化契約
- `withOwner`と`StoreSession.persist`のOwner / lock / Snapshot CAS境界

## 実装配置

- `src/server/api.ts`: 既存設定・Issue APIのschema boundaryを維持
- `src/server/store.ts`: `shouldAutoAssignIssueToCurrentCycle`相当の判定、create / update / bulkへの適用、Activity / Outbox
- `src/server/api.test.ts`: APIの設定・status遷移・再送・エラー境界
- `src/server/store-issue-core.test.ts` または `src/server/store.test.ts`: Storeの条件分岐と副作用
- `src/server/store-session.test.ts`: production Snapshot round-trip

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| 設定OFF / Activeなし / 対象外status | 通常のIssue Mutationだけを実行し、cycleId・Automation Activity / Outboxを追加しない |
| 既存Cycle所属 / cycleId明示 | ユーザー指定を優先し、自動割当しない |
| Status / CycleのOwner不一致 | 404。Issueと副作用を変更しない |
| version不一致 | 409 `ISSUE_VERSION_CONFLICT`。自動割当を含めて全副作用を変更しない |
| Runtime lock | 423 `OPERATION_IN_PROGRESS`。自動割当を含めて全副作用を変更しない |
| 同一idempotencyKeyの再送 | 保存済みReceiptのIssue responseを返し、Activity / Outboxを増やさない |

## テストケース（技法注記付き）

- [代表値] 設定ON・Active Cycle・未所属IssueをUnstartedからStartedへ変更し、Current Cycleへ割り当てる。
- [状態遷移] 未所属IssueをStarted / Completedで作成し、cycleId省略時だけCurrentへ割り当てる。
- [状態遷移] bulk status updateで未所属IssueだけをCurrentへ割り当て、所属済みIssueは維持する。
- [デシジョンテーブル] 設定ON/OFF × Activeあり/なし × 未所属/所属済み × status対象/対象外 × cycleId省略/明示を分岐する。
- [境界値] Started→Completed、Canceled→Started、同一status、Backlog / Unstartedへの変更を分岐する。
- [冪等性] 同じRequestを再送してIssue version・Automation Activity・Outboxが1件のままであることを確認する。
- [異常系] Owner外Status、version競合、Runtime lock、未知フィールドで副作用がないことを確認する。
