# FEAT-cycle-schedule-overrides: data 詳細設計

## 担保 AC（index.mdからの引用）

- **AC-1**: `PATCH /api/v1/cycles/:cycleId/schedule` は`startDate` / `endDate`（`YYYY-MM-DD`）を受け付け、対象が本人所有のUpcoming Cycleで、本人Timezoneの各日00:00へ変換した`endsAt > startsAt`を満たす場合だけ200を返す。形式不正・存在しない日付・Active / Completed・Owner外・未知フィールドは400 / 404の既存契約で拒否する。
- **AC-2**: 日付調整が他のOwner Cycleの期間と重複する場合、400 `VALIDATION_ERROR`としてCycle・Activity・Outbox・Receiptを変更しない。同じidempotencyKey・同じRequestはNo-op、異なるRequestは409、Runtime lock中は423になる。
- **AC-3**: 成功した日付調整は対象Cycleを`scheduleOverridden = true`にし、Active / Completed Cycleと対象以外の個別調整済みUpcomingを変更しない。対象より後ろの未調整Upcomingだけを、調整済みCycleの終了日時をアンカーとして保存済みCycleSettings（Cooldown・期間・開始曜日）で再計算し、Snapshotの再読込後も保持する。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 日付保存 | `OrbitStore.updateCycleSchedule` | OwnerのUpcomingをUTC timestampへ変換し、対象と後続自動Cycleを更新 | `userId`一致、Runtime lockなし | 個別調整を反映 |
| Snapshot | `OrbitStoreSnapshot.cycles` | `startsAt` / `endsAt` / `scheduleOverridden`をround-trip | Owner scoped | 次回Sessionで復元 |

既存CycleはMap内で適用前検証を完了してから一括して変更する。新規Migrationは作らない。

## 実装配置

- `src/server/store.ts`: 日付調整、重複検証、後続自動Cycle再計算、Activity / Outbox / Receipt
- `src/server/store-cycle.test.ts`: Store状態遷移・副作用なし・Owner境界
- `src/server/store-session.test.ts`: Snapshot再読込

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| Active / Completed | 400、Cycle / Activity / Outbox / Receipt不変 |
| Owner外 / 不存在 | 404、対象Ownerの状態のみ保持 |
| 他Cycleとの期間重複 | 400、適用前検証で全状態不変 |
| 後続個別調整Cycleとの重複 | 400、対象と後続Cycleを変更しない |
| Runtime lock | 423、全状態不変 |

## テストケース（技法注記付き）

- [状態遷移] Upcomingの開始・終了日を保存し、`scheduleOverridden`がtrueになる。
- [状態遷移] 対象後ろのautomatic Upcomingだけが新しい終了日時から再計算される。
- [状態遷移] Active / Completed / 別のoverride UpcomingのID・日時・状態が変わらない。
- [デシジョンテーブル] overlapなし=成功、前後Cycleとのoverlap=400・副作用0。
- [デシジョンテーブル] idle lock=成功、running lock=423、Owner外=404。
- [同値分割] 同じKey・同じRequest=同じCycle、同じKey・異なるRequest=409。
- [データ境界] Owner Aの日付調整がOwner BのCycle / Snapshotへ影響しない。
