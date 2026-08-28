# FEAT-cycle-advanced-settings: CycleのCooldown・将来数設定

## 概要

SettingsからCycle間のCooldownと、先行生成しておくUpcoming Cycleの件数を本人が設定できるようにする。
保存済みの設定を、既存のCycle日付再計算・Bootstrap補充・後続Cycle生成へ一貫して適用する。

## 対象範囲

- 対象レイヤー: shared / data / service / ui
  - [shared.md](./shared.md)
  - [data.md](./data.md)
  - [service.md](./service.md)
  - [ui.md](./ui.md)
- 対象ドメイン: cycles / settings / production snapshot
- 対象外（やらないこと）:
  - Cycleの有効 / 無効（`enabled`）と未所属Issueの自動追加（`autoAddToCurrentCycle`）の編集
  - Upcoming Cycleの個別日付編集・Graphの時系列Snapshot
  - Cycleの自動Scheduler導入、既存Cycleの削除・番号振り直し
  - D1の正規化Repositoryや新規Migration

## ユニット計画

単一ユニット（Cooldown・将来Cycle数の設定とスケジュール適用）。既存のCycleSettings API、Snapshot、Timezone計算、Bootstrap補充を再利用する。

## 受け入れ基準（AC）

- [x] **AC-1**: `PATCH /api/v1/cycle-settings` は既存の`durationWeeks`（1〜8）と`startWeekday`（0〜6）に加えて、`cooldownWeeks`（0〜4）と`futureCount`（1〜15）を受け付け、未知フィールド・範囲外・Owner外・Runtime lock中・同一Keyの異なるRequestを既存の400 / 404 / 409 / 423契約どおり拒否する。
- [x] **AC-2**: Cooldownを保存すると、Active / Completed Cycleと`scheduleOverridden = true`のUpcoming Cycleは変更せず、未調整Upcoming Cycleだけが本人Timezoneの指定曜日00:00かつCooldown後の境界から番号順に再計算される。既存のdurationWeeks / startWeekdayの計算契約は維持する。
- [x] **AC-3**: 保存済みのCooldownは設定変更後の新規Upcoming Cycle、Cycle完了後の後続Cycle、Upcoming開始後の後続Cycleへ適用される。TimezoneのDST境界をまたいでも現地00:00と暦週の期間を維持する。
- [x] **AC-4**: 保存済みのfutureCountはBootstrap / production Store Sessionの成功時にOwnerのUpcoming件数を不足分だけ補充する。既存CycleのID・番号・日時・metadataは変更せず、futureCountを下げても既存Upcomingを削除しない。
- [x] **AC-5**: SettingsのCycleカードで期間、開始曜日、Cooldown、将来Cycle数を選択して保存できる。保存中は4項目と保存操作を無効化し、成功時は保存値を表示し、400 / 409 / 423 / 500では入力値と再試行導線を保持する。390pxで横overflowを出さない。

## アーキテクチャ / レイヤー間フロー

```text
Settings UI
  └─ PATCH /api/v1/cycle-settings
       ├─ shared strict schema
       └─ owner-scoped OrbitStore.updateCycleSettings
            ├─ update saved settings
            ├─ recalculate automatic Upcoming dates
            └─ Bootstrap / Store SessionでfutureCount不足を補充
                 ↓
              Snapshot persistence (existing D1 adapter)
```

## エラー・ログ方針（横断サマリ）

| シナリオ | shared | service / data | 表示層の挙動 |
|---|---|---|---|
| 入力不正・未知フィールド | strict `VALIDATION_ERROR` / 400 + fieldErrors | 設定・Cycle・Activity・Outbox・Receiptを変更しない | 入力値を保持して該当項目へエラー表示 |
| Owner外・設定不存在 | — | `RESOURCE_NOT_FOUND` / 404、他Ownerを変更しない | 安全なエラー表示 |
| 同じKeyの異なるRequest | `IDEMPOTENCY_KEY_REUSED` / 409 | 業務効果なし | 最新値を再取得し、入力を確定しない |
| Runtime lock | `OPERATION_IN_PROGRESS` / 423 | 全状態を変更しない | 保存中表示を解除し、Retryを表示 |
| 予期せぬ障害 | `INTERNAL_ERROR` / 500 + requestId | Snapshot保存を確定しない | 入力値を保持してRetryを表示 |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | CycleSettings schemaの境界・strictness | API / Storeの400・404・409・423・replay |
| AC-2 | Cooldown後のTimezone境界計算 | StoreのActive / Completed / override保持とUpcoming再計算 |
| AC-3 | DSTを含むCycle開始・終了計算 | close / start後の後続Cycle生成 |
| AC-4 | Upcoming補充数の差分 | Bootstrap / Snapshot Sessionの永続化 |
| AC-5 | Settingsの保存状態・field error mapper | UIの保存・再試行・responsive構造 |

## 既存実装との関係（再利用 / 差分 / 衝突）

- `CycleSettings`の既存`cooldownWeeks` / `futureCount`フィールド、`cycle_settings` schema、Snapshot round-tripを再利用する。
- 既存の`PATCH /api/v1/cycle-settings`を拡張し、既存の期間・開始曜日の送信とResponse形状を維持する。
- `nextCycleStartAt`のTimezone / DST計算と`OrbitStore.ensureUpcomingCycles`、`createNextCycle`、`upcomingScheduleUpdates`、`startCycle`を同じ設定値でつなぐ。
- Active / Completed / 個別調整済みUpcomingを保護する既存契約を維持し、Migrationや別のCycle作成APIは追加しない。

## 実装に効く制約

- 全設定Mutationは既存のOwner、same-origin、idempotency、Runtime lock、Snapshot persist境界を通す。
- Cooldownは0〜4週間、futureCountは1〜15件の整数だけを受け付ける。
- Cooldownは固定UTCオフセットではなく、本人Timezoneの暦日と指定曜日00:00で計算する。
- futureCountを下げても既存Cycleを削除・再番号付けしない。増加分だけBootstrap時に補充する。
- `enabled`と`autoAddToCurrentCycle`は今回のRequestやUIへ混入させない。

## 判断根拠 / 未決事項

- 既存Schemaにすでに対象列がありSnapshotのround-tripも確立しているため、新規Migrationなしで設定APIと既存スケジュール計算を拡張する。正規化Repositoryへの移行はRelease hardeningへ残す。
- Cooldownは「前Cycleの終了から次の指定曜日境界まで」の計算アンカーへ暦週を加える。固定ミリ秒だけで日付を進める方式はDST境界で現地00:00を壊すため採用しない。
- futureCountを下げたとき既存Upcomingを消すとユーザーの計画を破壊するため、件数不足の補充だけを行い、余剰Cycleは保持する。
- 今回はCycleの有効化・自動追加・個別調整まで同時に扱わず、既存の手動Run / start契約に設定値を一貫適用する。
- 未決事項なし。今回の進行指示をGate 1の実装開始承認として扱い、Gate 3で変更対象と未確認範囲を提示する。
