# FEAT-cycle-schedule-overrides: Upcoming Cycleの日付個別調整

## 概要

Upcoming Cycleの開始日・終了日を本人のTimezoneで個別調整できるようにする。
調整済みCycleは自動スケジュールの上書き対象外とし、その終了日を後続自動Cycleの計算アンカーにする。

## 対象範囲

- 対象レイヤー: shared / data / service / ui
  - [shared.md](./shared.md)
  - [data.md](./data.md)
  - [service.md](./service.md)
  - [ui.md](./ui.md)
- 対象ドメイン: cycles / schedule / owner-scoped snapshot
- 対象外（やらないこと）:
  - Active / Completed Cycleの日付変更
  - Cycleの削除・番号変更・自動Schedulerの導入
  - Graph / 日別Snapshot、CycleSettingsの追加項目
  - D1正規化Repositoryや新規Migration

## ユニット計画

単一ユニット（Upcoming日付調整のshared契約・Store・API・UI）。既存のCycleSettings、Timezone helper、metadata API、Snapshot persist境界を再利用する。

## 受け入れ基準（AC）

- [x] **AC-1**: `PATCH /api/v1/cycles/:cycleId/schedule` は`startDate` / `endDate`（`YYYY-MM-DD`）を受け付け、対象が本人所有のUpcoming Cycleで、本人Timezoneの各日00:00へ変換した`endsAt > startsAt`を満たす場合だけ200を返す。形式不正・存在しない日付・Active / Completed・Owner外・未知フィールドは400 / 404の既存契約で拒否する。
- [x] **AC-2**: 日付調整が他のOwner Cycleの期間と重複する場合、400 `VALIDATION_ERROR`としてCycle・Activity・Outbox・Receiptを変更しない。同じidempotencyKey・同じRequestはNo-op、異なるRequestは409、Runtime lock中は423になる。
- [x] **AC-3**: 成功した日付調整は対象Cycleを`scheduleOverridden = true`にし、Active / Completed Cycleと対象以外の個別調整済みUpcomingを変更しない。対象より後ろの未調整Upcomingだけを、調整済みCycleの終了日時をアンカーとして保存済みCycleSettings（Cooldown・期間・開始曜日）で再計算し、Snapshotの再読込後も保持する。
- [x] **AC-4**: Upcoming Cycle詳細で開始日・終了日を編集して保存できる。保存中は対象操作を無効化し、成功時は再表示へ反映する。400 / 409 / 423 / 500では入力値と再試行導線を保持し、390pxで横overflowを出さずKeyboard / Pointerで操作できる。

## アーキテクチャ / レイヤー間フロー

```text
Upcoming Cycle UI
  └─ PATCH /api/v1/cycles/:cycleId/schedule
       ├─ shared strict schema (YYYY-MM-DD)
       └─ owner-scoped OrbitStore.updateCycleSchedule
            ├─ local date → IANA timezone midnight
            ├─ overlap / status / Owner validation
            ├─ target override + following automatic reschedule
            └─ Activity / Outbox / Receipt
                 ↓
              existing Snapshot persist
```

## エラー・ログ方針（横断サマリ）

| シナリオ | shared | service / data | 表示層の挙動 |
|---|---|---|---|
| 日付形式・カレンダー・期間不正 | strict `VALIDATION_ERROR` / 400 + fieldErrors | 全状態を変更しない | 入力を保持してfield error |
| Active / Completed / Owner外 / 不存在 | — | 400または404、他Cycleを返さない | 安全なエラー表示 |
| 期間重複 | `VALIDATION_ERROR` / 400 | Cycle / Activity / Outbox / Receiptを変更しない | 重複解消を促しRetry |
| 同じKeyの再送 | — | 同じResponseを返し副作用なし、Request違いは409 | 最新値再取得またはConflict表示 |
| Runtime lock | `OPERATION_IN_PROGRESS` / 423 | 全状態を変更しない | 入力を保持してRetry |
| 予期せぬ障害 | `INTERNAL_ERROR` / 500 + requestId | Snapshot保存を確定しない | 入力を保持してRetry |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | YYYY-MM-DD / local midnight mapper | API / Storeのstatus・Owner・期間境界 |
| AC-2 | overlap判定・request hash | Storeの副作用なし・再送・lock |
| AC-3 | 後続日付再計算 | Store / Snapshot round-trip |
| AC-4 | date input / save state mapper | Cycle UIの保存・Retry・responsive構造 |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 既存`Cycle`の`startsAt` / `endsAt` / `scheduleOverridden`、`CycleSettings`、`nextCycleStartAt` / `cycleEndAt`を再利用する。
- 既存`PATCH /api/v1/cycles/:cycleId`のmetadata契約へ日付を混在させず、`/schedule`の専用PATCHへ分離する。
- `updateCycleSettings`と同じActivity / Outbox / Receipt / Runtime lock / Snapshot境界を使い、Migrationは追加しない。
- 手動の`POST /api/v1/cycles/:cycleId/start`は現在時刻開始の既存契約を維持する。

## 実装に効く制約

- 日付文字列はGregorian `YYYY-MM-DD`、保存時刻は本人Timezoneの00:00をUTC Unix millisecondsで保持する。
- 対象はUpcomingのみ。Active / Completedは変更不可。
- 期間は終了日を排他的なCycle境界として扱い、`endDate > startDate`を要求する。
- 期間重複の検証と後続自動Cycleの再計算は、いずれも適用前に全件検証して部分更新を起こさない。
- `scheduleOverridden = true`の後続Cycleは日時を保持し、その終了日時を次の自動Cycle計算アンカーにする。
- 内部Token・Cookie・メールアドレス・D1 BindingをResponseやUIへ出さない。

## 判断根拠 / 未決事項

- 日付入力はブラウザのUTC timestampを直接受け取らず、`YYYY-MM-DD`を本人Timezoneで解釈する。端末Timezoneによる日付ずれとDSTの固定オフセット問題を避けるためである。
- Metadata PATCHへ日付を追加せず専用Pathへ分ける。名前・説明保存とスケジュール競合の失敗を独立させ、既存Clientの契約を壊さないためである。
- 対象Cycleの後続自動日付は同一Mutationの適用前計算で確定する。後続Cycleだけを別Requestで補正すると、調整直後に不整合な期間が見えるためである。
- 期間重複は入力エラーとして扱い、既存のCycle / Activity / Outbox / Receiptを保持する。自動解決でユーザーの意図しない日付変更を起こさないためである。
- 未決事項なし。今回の進行指示をGate 1の実装開始承認として扱い、Gate 3でコミット対象と未確認範囲を提示する。
