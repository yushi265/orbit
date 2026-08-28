# FEAT-cycle-advanced-settings: service 詳細設計

## 担保 AC（index.mdからの引用）

- **AC-1**: `PATCH /api/v1/cycle-settings` は既存の`durationWeeks`（1〜8）と`startWeekday`（0〜6）に加えて、`cooldownWeeks`（0〜4）と`futureCount`（1〜15）を受け付け、未知フィールド・範囲外・Owner外・Runtime lock中・同一Keyの異なるRequestを既存の400 / 404 / 409 / 423契約どおり拒否する。
- **AC-2**: Cooldownを保存すると、Active / Completed Cycleと`scheduleOverridden = true`のUpcoming Cycleは変更せず、未調整Upcoming Cycleだけが本人Timezoneの指定曜日00:00かつCooldown後の境界から番号順に再計算される。既存のdurationWeeks / startWeekdayの計算契約は維持する。
- **AC-3**: 保存済みのCooldownは設定変更後の新規Upcoming Cycle、Cycle完了後の後続Cycle、Upcoming開始後の後続Cycleへ適用される。TimezoneのDST境界をまたいでも現地00:00と暦週の期間を維持する。
- **AC-4**: 保存済みのfutureCountはBootstrap / production Store Sessionの成功時にOwnerのUpcoming件数を不足分だけ補充する。既存CycleのID・番号・日時・metadataは変更せず、futureCountを下げても既存Upcomingを削除しない。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| PATCH | `/api/v1/cycle-settings` | `{ idempotencyKey, durationWeeks, startWeekday, cooldownWeeks?, futureCount? }` → `200 { cycleSettings }` | Access / Owner / same-origin / lock | Cycle設定の保存 |
| Bootstrap | `/api/v1/bootstrap` | `cycleSettings`へ保存済み全フィールドを返す | Owner scoped | 設定再取得とUpcoming補充 |

全Mutationは`cycleSettingsMutationSchema`を入口で使い、`withOwner`がOwnerとRuntime lockを解決した後に`OrbitStore.updateCycleSettings`を呼ぶ。成功Response後のみ既存Snapshot Sessionが保存する。

## 実装配置

- `src/server/api.ts`: Cycle settingsの入力Schema変換とResponse
- `src/routes/api/v1/cycle-settings.ts`: PATCH Route
- `src/server/store.ts`: Owner / lock / idempotency / schedule / receipt
- `src/server/api.test.ts`: APIの境界・再送・Snapshot回帰

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| 未知フィールド・範囲外 | 400 `VALIDATION_ERROR` + fieldErrors。Storeを呼ばない |
| Owner外・CycleSettings不存在 | 404 `RESOURCE_NOT_FOUND`。他Ownerを返さない |
| 同一Key・同じRequest | 初回の`cycleSettings` Responseを返し副作用なし |
| 同一Key・異なるRequest | 409 `IDEMPOTENCY_KEY_REUSED`。設定・Cycleを変更しない |
| Runtime lock | 423 `OPERATION_IN_PROGRESS`。設定・Cycle・Snapshotを変更しない |
| Store / Snapshot障害 | 500 `INTERNAL_ERROR` + requestId。内部Token・個人データを出さない |

## テストケース（技法注記付き）

- [代表値] 4項目をPATCHして200、Bootstrapの再取得で同じ値を返す。
- [境界値] Cooldown 0 / 4、futureCount 1 / 15を受理し、範囲外を400にする。
- [デシジョンテーブル] Owner一致 / 不一致、lock idle / running、同一Key同一Request / 異なるRequestを分岐する。
- [状態遷移] 保存成功後のSnapshot再読込で設定とCycle日時が欠落しない。
- [回帰] 既存のdurationWeeks / startWeekdayのみを送るClientも保存できる。
