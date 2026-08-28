# FEAT-cycle-schedule-overrides: shared 詳細設計

## 担保 AC（index.mdからの引用）

- **AC-1**: `PATCH /api/v1/cycles/:cycleId/schedule` は`startDate` / `endDate`（`YYYY-MM-DD`）を受け付け、対象が本人所有のUpcoming Cycleで、本人Timezoneの各日00:00へ変換した`endsAt > startsAt`を満たす場合だけ200を返す。形式不正・存在しない日付・Active / Completed・Owner外・未知フィールドは400 / 404の既存契約で拒否する。
- **AC-2**: 日付調整が他のOwner Cycleの期間と重複する場合、400 `VALIDATION_ERROR`としてCycle・Activity・Outbox・Receiptを変更しない。同じidempotencyKey・同じRequestはNo-op、異なるRequestは409、Runtime lock中は423になる。
- **AC-3**: 成功した日付調整は対象Cycleを`scheduleOverridden = true`にし、Active / Completed Cycleと対象以外の個別調整済みUpcomingを変更しない。対象より後ろの未調整Upcomingだけを、調整済みCycleの終了日時をアンカーとして保存済みCycleSettings（Cooldown・期間・開始曜日）で再計算し、Snapshotの再読込後も保持する。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 保存 | `cycleScheduleMutationSchema` / `PATCH /api/v1/cycles/:cycleId/schedule` | `{ idempotencyKey, startDate: YYYY-MM-DD, endDate: YYYY-MM-DD }`のstrict object | Owner必須、内部Token不可 | Upcomingの日付を個別調整 |
| 変換 | `localDateAtMidnight(date, timeZone)` | 有効なGregorian日付をIANA timezoneの00:00へ変換 | I/Oなし | UTC保存値を作る |

## 実装配置

- `src/shared/contracts/cycles.ts`: 日付Mutation Schema
- `src/server/cycle-schedule.ts`: local date parser / timezone midnight helper
- `src/shared/cycle-workspace.test.ts`: strict境界テスト
- `src/server/cycle-schedule.test.ts`: 日付・Timezone境界テスト

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| 形式不正・未知フィールド | strict decodeで400 |
| 存在しない日付 | schedule helperのRangeErrorをserviceが400へ変換 |
| 終了日が開始日以前 | `endDate` field error付き400 |
| 不正Timezone | serviceが安全な400へ変換し、個人データを出さない |

## テストケース（技法注記付き）

- [境界値] `2026-01-01` / `2026-12-31`を受け入れ、`2026-02-30` / `2026-1-1`を拒否する。
- [セキュリティ境界] `scheduleOverridden` / `startsAt` / `lock_token` / unknown keyを拒否する。
- [代表値] `Asia/Tokyo`と`America/New_York`のlocal midnightが正しいUTCになる。
- [境界値] DST境界の日付でも現地00:00を返す。
- [境界値] `0001-01-01`を1901年へずらさず変換し、`2018-11-04`のSao Pauloのように存在しない00:00を拒否する。
