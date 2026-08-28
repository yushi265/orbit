# FEAT-cycle-auto-add: shared 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: `PATCH /api/v1/cycle-settings` は`autoAddToCurrentCycle`（boolean）を受け付け、BootstrapとSnapshot再読込で保存値を返す。未知フィールド・boolean以外・Owner外・Runtime lock中・同一Keyの異なるRequestは既存の400 / 404 / 409 / 423契約どおり拒否し、旧Snapshotで値が欠落している場合は`false`へ補完する。
- **AC-2**: `autoAddToCurrentCycle = true` かつActive Cycleが存在する時、未所属Issueが作成時にStarted / Completedとなる、または既存Issueのstatusを別statusからStarted / Completedへ変更する、または一括Status変更で同条件を満たす場合、IssueをCurrent Cycleへ割り当てる。IssueのversionはそのMutationで1回だけ進み、明示的な`cycleId`、既にCycle所属、対象外status、Active Cycleなし、設定OFFでは自動割当しない。
- **AC-3**: 自動割当は通常のIssue Activity / Outboxと同じ成功Mutationへ含まれ、`cycle.auto_assigned`・`system:automation`・`before.cycleId = null`・`after.cycleId = Current Cycle ID`を持つAutomation Activityと、重複しない`issue.cycle.auto_assigned` Outboxを記録する。同じidempotencyKeyの再送は保存済みIssueを返し、二重割当・二重履歴・二重Outboxを発生させない。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 設定Mutation | `cycleSettingsMutationSchema` | `autoAddToCurrentCycle?: boolean`。既存の`durationWeeks` / `startWeekday`必須、unknown key禁止 | Owner / same-origin / Runtime lock | 自動追加のON/OFF |
| Issue結果 | `IssueViewModel.cycleId` | 自動割当時はActive CycleのID、通常のIssue responseと同じversion | Owner scoped | UIへ割当結果を返す |

## 実装配置

- `src/shared/contracts/cycles.ts`: CycleSettings Mutationのboolean契約
- `src/shared/view-models.ts`: CycleSettings view modelのboolean
- `src/server/model.ts`: CycleSettings / Activity actorTypeの型
- `src/server/store.ts`: Snapshot旧値補完、Mutation条件、Activity / Outbox payload

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| boolean以外・unknown key | schema parseを失敗させ、`VALIDATION_ERROR` / 400へ変換する |
| 旧Snapshotの設定欠落 | `autoAddToCurrentCycle: false`を補完してからSnapshot validationする |
| actorTypeの未知値 | Snapshot validationで拒否し、既存の許可値を壊さない |

## テストケース（技法注記付き）

- [境界値] `autoAddToCurrentCycle`の`true` / `false`を受理し、文字列・数値・nullを拒否する。
- [デシジョンテーブル] CycleSettingsのunknown key / 旧Snapshotのfield欠落 / actorType許可値を分岐する。
- [代表値] `system:automation`を含むActivityがview modelへ保持される。
