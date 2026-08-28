# FEAT-cycle-schedule-overrides: service 詳細設計

## 担保 AC（index.mdからの引用）

- **AC-1**: `PATCH /api/v1/cycles/:cycleId/schedule` は`startDate` / `endDate`（`YYYY-MM-DD`）を受け付け、対象が本人所有のUpcoming Cycleで、本人Timezoneの各日00:00へ変換した`endsAt > startsAt`を満たす場合だけ200を返す。形式不正・存在しない日付・Active / Completed・Owner外・未知フィールドは400 / 404の既存契約で拒否する。
- **AC-2**: 日付調整が他のOwner Cycleの期間と重複する場合、400 `VALIDATION_ERROR`としてCycle・Activity・Outbox・Receiptを変更しない。同じidempotencyKey・同じRequestはNo-op、異なるRequestは409、Runtime lock中は423になる。
- **AC-3**: 成功した日付調整は対象Cycleを`scheduleOverridden = true`にし、Active / Completed Cycleと対象以外の個別調整済みUpcomingを変更しない。対象より後ろの未調整Upcomingだけを、調整済みCycleの終了日時をアンカーとして保存済みCycleSettings（Cooldown・期間・開始曜日）で再計算し、Snapshotの再読込後も保持する。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| PATCH | `/api/v1/cycles/:cycleId/schedule` | `{ idempotencyKey, startDate, endDate }` → `200 { cycle }` | Access / Owner / same-origin / Runtime lock | Upcomingの日付調整 |
| Bootstrap | `/api/v1/bootstrap` | 既存`BootstrapPayload` | Owner scoped | 調整結果の再表示 |

`updateCycleSchedule`は`withOwner`、`cycleScheduleMutationSchema`、既存Snapshot Sessionの成功後persistを通る。APIは内部Tokenを受け取らない。

## 実装配置

- `src/server/api.ts`: 入力SchemaとResponse
- `src/routes/api/v1/cycles/$cycleId/schedule.ts`: PATCH Route
- `src/server/store.ts`: Owner / lock / idempotency / overlap / schedule
- `src/server/api.test.ts`: HTTP 200 / 400 / 404 / 409 / 423回帰

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| unknown key / 日付形式不正 | 400 `VALIDATION_ERROR` + fieldErrors |
| Active / Completed / overlap | 400、業務データを変更しない |
| Owner外 / 不存在 | 404 `RESOURCE_NOT_FOUND` |
| 同じKey・同じRequest | 初回Responseを返す |
| 同じKey・異なるRequest | 409 `IDEMPOTENCY_KEY_REUSED` |
| Runtime lock | 423 `OPERATION_IN_PROGRESS` |
| Store / Snapshot障害 | 500 `INTERNAL_ERROR` + requestId |

## テストケース（技法注記付き）

- [代表値] Upcoming日付をPATCHして200、Bootstrapで`startsAt` / `endsAt` / `scheduleOverridden`を再取得する。
- [境界値] 開始日・終了日同日、終了日が前、無効な日付を400にする。
- [デシジョンテーブル] Upcoming / Active / Completed、Owner一致 / 不一致を分岐する。
- [状態遷移] overlap拒否時にActivity / Outbox / Receiptが増えない。
- [状態遷移] 同じKeyの再送をNo-op、異なるRequestを409にする。
- [データ境界] Runtime lock中にCycle / Snapshotを変更しない。
