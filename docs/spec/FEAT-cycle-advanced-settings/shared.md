# FEAT-cycle-advanced-settings: shared 詳細設計

## 担保 AC（index.mdからの引用）

- **AC-1**: `PATCH /api/v1/cycle-settings` は既存の`durationWeeks`（1〜8）と`startWeekday`（0〜6）に加えて、`cooldownWeeks`（0〜4）と`futureCount`（1〜15）を受け付け、未知フィールド・範囲外・Owner外・Runtime lock中・同一Keyの異なるRequestを既存の400 / 404 / 409 / 423契約どおり拒否する。
- **AC-2**: Cooldownを保存すると、Active / Completed Cycleと`scheduleOverridden = true`のUpcoming Cycleは変更せず、未調整Upcoming Cycleだけが本人Timezoneの指定曜日00:00かつCooldown後の境界から番号順に再計算される。既存のdurationWeeks / startWeekdayの計算契約は維持する。
- **AC-3**: 保存済みのCooldownは設定変更後の新規Upcoming Cycle、Cycle完了後の後続Cycle、Upcoming開始後の後続Cycleへ適用される。TimezoneのDST境界をまたいでも現地00:00と暦週の期間を維持する。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 保存 | `cycleSettingsMutationSchema` / `PATCH /api/v1/cycle-settings` | `idempotencyKey: string`、`durationWeeks: int 1..8`、`startWeekday: int 0..6`、`cooldownWeeks?: int 0..4`、`futureCount?: int 1..15`。strict object | Owner必須、内部Token不可 | Cycle設定を更新 |
| 開始境界 | `nextCycleStartAt(anchor, weekday, timezone, cooldownWeeks?)` | `cooldownWeeks`省略時0、整数0..4。指定曜日の現地00:00を返す | I/Oなし | DSTを含む次Cycle境界の計算 |

## 実装配置

- `src/shared/contracts/cycles.ts`: Cooldown / futureCountのstrict Schema
- `src/server/cycle-schedule.ts`: Cooldownを暦週として反映した開始日時計算
- `src/shared/cycle-workspace.test.ts`: 入力境界の契約テスト
- `src/server/cycle-schedule.test.ts`: Cooldown / DST境界テスト

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| `cooldownWeeks`が0未満 / 5以上 / 非整数 | `VALIDATION_ERROR`のfield errorを返す |
| `futureCount`が0 / 16 / 非整数 | `VALIDATION_ERROR`のfield errorを返す |
| unknown key / lock token混入 | strict decodeで拒否する |
| 不正Timezone / helper引数 | schedule helperはRangeError、serviceが安全な400へ変換する |

## テストケース（技法注記付き）

- [境界値] `cooldownWeeks`の0 / 4を受理し、-1 / 5 / 1.5を拒否する。
- [境界値] `futureCount`の1 / 15を受理し、0 / 16 / 1.5を拒否する。
- [セキュリティ境界] `enabled` / `autoAddToCurrentCycle` / `lock_token` / unknown keyをMutation Schemaで拒否する。
- [状態遷移] Cooldown 0では従来と同じ開始日時、Cooldown 1では指定曜日の暦週後の00:00を返す。
- [代表値] America/New_YorkのDST開始前後でもCooldown後の現地00:00と期間を維持する。
