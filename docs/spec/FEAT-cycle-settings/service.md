# FEAT-cycle-settings: service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: Bootstrapは本人の`cycleSettings`（`enabled`、`durationWeeks`、`cooldownWeeks`、`startWeekday`、`futureCount`）を返し、設定の再取得で保存値を保持する。
- **AC-2**: 本人が`PATCH /api/v1/cycle-settings`へ`durationWeeks`（1〜8の整数）と`startWeekday`（0〜6の整数、0=日曜）を送ると保存でき、未知フィールド・範囲外・Owner外・Runtime lock中・同一Keyの異なるRequestを既存契約どおり拒否する。
- **AC-3**: Cycle設定保存後、Active / Completed CycleのID・日時・状態は変わらず、未開始かつ`scheduleOverridden = false`のUpcoming Cycleだけが、本人Timezoneの指定曜日00:00開始・指定期間で番号順に再計算される。`scheduleOverridden = true`のUpcoming Cycleは日時を保持し、後続自動Cycleの計算アンカーになる。
- **AC-4**: 設定変更後に生成される新規Upcoming CycleとCycle開始・完了時の後続自動Cycleは、保存済みの期間と開始曜日を使う。

## このレイヤーが公開する契約

| Method / Path | Request | Response / Error |
|---|---|---|
| `GET /api/v1/bootstrap` | なし | `200 { ..., cycleSettings: CycleSettings }`。本人の設定のみ |
| `PATCH /api/v1/cycle-settings` | `CycleSettingsMutation` | `200 { cycleSettings: CycleSettings }`。400 / 409 / 423 |

`updateCycleSettings`は`userId`で対象を限定し、`durationWeeks`と`startWeekday`を保存する。保存後、未開始・未調整UpcomingをCycle number順に再計算する。Active / Completed / 手動調整済みUpcomingは変更しない。

自動Cycleの日付計算は次の規則とする。

1. 最初のUpcomingのアンカーは、存在すればActiveの`endsAt`、なければ直前のCycleの`endsAt`、それもなければ自身の`startsAt`。
2. 自動Cycleの開始はアンカー以降で最初に現れる指定曜日のTimezone 00:00とする。アンカーが指定曜日00:00より後なら翌週を選ぶ。
3. 終了は開始日時のTimezone上の`durationWeeks * 7`暦日後の00:00とする。
4. `scheduleOverridden = true`のCycleは日時をそのまま保持し、その`endsAt`を次の自動Cycleのアンカーにする。

設定変更と生成はActivity / Outbox / Receiptの既存形式で記録し、同じidempotencyKeyの再送は保存済み設定を返す。

## このレイヤーが依存する下位の契約

- 呼び出す相手: `cycleSettingsMutationSchema`、`CycleSettingsViewModel`、既存`openStoreSession` / D1 Snapshot CAS
- 受け渡し: Accessで解決済みの`userId`、PreferencesのIANA `timezone`、Runtime lock、idempotencyKey

## 実装配置

- `src/shared/contracts/cycles.ts`: `cycleSettingsMutationSchema`と型
- `src/shared/view-models.ts` / `src/server/model.ts`: `CycleSettings`のBootstrap公開型
- `src/server/cycle-schedule.ts`: IANA timezoneの曜日00:00と暦日加算
- `src/server/store.ts`: 設定更新、Upcoming再計算、Cycle生成へのschedule適用
- `src/server/api.ts` / `src/routes/api/v1/cycle-settings.ts`: PATCH handler / route
- `src/server/store-cycle.test.ts` / `src/server/cycle-schedule.test.ts`: 設定・日付・状態遷移
- `src/server/api.test.ts` / `src/server/store-session.test.ts`: HTTP・Snapshot再取得

## 異常系挙動

| シナリオ | serviceの挙動 |
|---|---|
| 入力不正 | Storeを変更せず400 `VALIDATION_ERROR` + fieldErrors |
| Owner外・設定なし | 404 `RESOURCE_NOT_FOUND`。Cycle / 設定を変更しない |
| Runtime lock | 423 `OPERATION_IN_PROGRESS`。設定・Cycle・Activity・Outbox・Receipt不変 |
| 同じKey・同じRequest | 保存済み`CycleSettings`を返し、再計算・台帳を増やさない |
| 同じKey・異なるRequest | 409 `IDEMPOTENCY_KEY_REUSED`。何も変更しない |
| D1 Snapshot競合 | 409 `D1_WRITE_CONFLICT`。競合Sessionの設定を保存しない |

## テストケース（技法注記付き）

- [代表値] Bootstrap → `cycleSettings`の5項目を返し、変更後Bootstrapで値を再取得する。
- [状態遷移] PATCH duration / weekday → 設定を保存し、未調整Upcomingを指定曜日00:00・指定期間へ再計算する。
- [状態遷移/禁止] Active / Completed CycleのID・日時・状態と手動調整済みUpcomingの日時を変更しない。
- [状態遷移] 設定変更後の`createNextCycle`、Active close、Upcoming startの後続Cycleが新しい設定を使う。
- [デシジョンテーブル] 400 / 404 / 409 / 423の各条件で設定・Cycle・台帳が不変になる。
- [セキュリティ境界] 他OwnerのCycleSettingsを読み書きできない。
