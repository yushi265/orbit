# FEAT-cycle-settings: shared 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: Bootstrapは本人の`cycleSettings`（`enabled`、`durationWeeks`、`cooldownWeeks`、`startWeekday`、`futureCount`）を返し、設定の再取得で保存値を保持する。
- **AC-2**: 本人が`PATCH /api/v1/cycle-settings`へ`durationWeeks`（1〜8の整数）と`startWeekday`（0〜6の整数、0=日曜）を送ると保存でき、未知フィールド・範囲外・Owner外・Runtime lock中・同一Keyの異なるRequestを既存契約どおり拒否する。
- **AC-3**: Cycle設定保存後、Active / Completed CycleのID・日時・状態は変わらず、未開始かつ`scheduleOverridden = false`のUpcoming Cycleだけが、本人Timezoneの指定曜日00:00開始・指定期間で番号順に再計算される。`scheduleOverridden = true`のUpcoming Cycleは日時を保持し、後続自動Cycleの計算アンカーになる。
- **AC-4**: 設定変更後に生成される新規Upcoming CycleとCycle開始・完了時の後続自動Cycleは、保存済みの期間と開始曜日を使う。
- **AC-5**: SettingsにCycle設定カードを表示し、期間と開始曜日を選択して保存できる。保存中は対象操作を無効化し、成功時はUpcomingの再計算結果を再表示し、400 / 409 / 423 / 500では入力値と再試行導線を保持する。390pxで横overflowを出さない。

## このレイヤーが公開する契約

```ts
type CycleSettingsMutation = {
  idempotencyKey: string; // 1..200文字
  durationWeeks: number; // 整数 1..8
  startWeekday: number; // 整数 0..6、0=日曜
};
```

`cycleSettingsMutationSchema`はstrict objectとし、unknown key、0 / 9週、-1 / 7曜日、小数、文字列を拒否する。

## 異常系挙動

| シナリオ | sharedの挙動 |
|---|---|
| durationWeeks / startWeekdayの型・範囲不正 | `safeParse`が失敗し、APIの`VALIDATION_ERROR`へ変換可能 |
| unknown key / 内部Token混入 | strict schemaが失敗 |
| idempotencyKey空・201文字 | `safeParse`が失敗 |

## テストケース（技法注記付き）

- [境界値] `durationWeeks = 1 / 8`を受理し、`0 / 9 / 1.5 / "2"`を拒否する。
- [境界値] `startWeekday = 0 / 6`を受理し、`-1 / 7 / 1.5 / "1"`を拒否する。
- [デシジョンテーブル] idempotencyKeyが有効 × unknown keyなしだけ成功し、空・201文字・unknown key・内部Tokenは失敗する。
- [代表値] Bootstrapの`cycleSettings` ViewModelが5項目を保持する。
