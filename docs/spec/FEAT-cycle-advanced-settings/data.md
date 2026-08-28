# FEAT-cycle-advanced-settings: data 詳細設計

## 担保 AC（index.mdからの引用）

- **AC-2**: Cooldownを保存すると、Active / Completed Cycleと`scheduleOverridden = true`のUpcoming Cycleは変更せず、未調整Upcoming Cycleだけが本人Timezoneの指定曜日00:00かつCooldown後の境界から番号順に再計算される。既存のdurationWeeks / startWeekdayの計算契約は維持する。
- **AC-3**: 保存済みのCooldownは設定変更後の新規Upcoming Cycle、Cycle完了後の後続Cycle、Upcoming開始後の後続Cycleへ適用される。TimezoneのDST境界をまたいでも現地00:00と暦週の期間を維持する。
- **AC-4**: 保存済みのfutureCountはBootstrap / production Store Sessionの成功時にOwnerのUpcoming件数を不足分だけ補充する。既存CycleのID・番号・日時・metadataは変更せず、futureCountを下げても既存Upcomingを削除しない。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 設定保存 | `OrbitStore.updateCycleSettings` | 保存済み`CycleSettings`を返す。`cooldownWeeks: 0..4`、`futureCount: 1..15` | `userId`一致、Runtime lockなし | 設定と自動Upcoming日付を更新 |
| 補充 | `OrbitStore.ensureUpcomingCycles` | Active / 最終Cycleを起点に不足分だけ生成 | Owner `userId`のみ | Bootstrap / Sessionの補充 |
| Snapshot | `OrbitStoreSnapshot.cycleSettings` | 既存`CycleSettings[]`の全フィールドをround-trip | Snapshot owner scope | production永続化 |

## 実装配置

- `src/server/store.ts`: 設定適用、Upcoming再計算、後続Cycle生成、Snapshot
- `src/server/store-cycle.test.ts`: Storeの状態遷移・補充・既存Cycle保護
- `src/server/store-session.test.ts`: Snapshotの設定値保持

## このレイヤーが依存する下位の契約

- `src/server/cycle-schedule.ts`のTimezone境界計算を利用する。
- `src/server/store-session.ts`の既存Owner単位Snapshot persistを利用する。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| 入力値が範囲外 | 設定、Cycle、Activity、Outbox、Receiptを変更せず400 |
| Runtime lock中 | `assertUnlocked`で423、全状態不変 |
| Owner外 / 設定なし | 404、他Owner・他Cycleを参照しない |
| futureCount減少 | 既存Upcomingを削除せず、次回以降の補充上限だけを下げる |
| 個別調整済みUpcoming | 日時を保持し、後続自動Cycleのアンカーとして扱う |

## テストケース（技法注記付き）

- [状態遷移] Active / Completed / override Upcomingを配置してCooldownを変更し、保護対象が同一のままで自動Upcomingだけが再計算される。
- [状態遷移] Cooldown変更後にcloseし、新規Upcomingの開始境界が保存値を使う。
- [状態遷移] Cooldown変更後に次Upcomingをstartし、後続自動Cycleの境界が保存値を使う。
- [代表値] futureCountを3から6へ増やしたSnapshotをBootstrapし、不足3件だけを追加する。
- [状態遷移] futureCountを1へ下げても既存Cycleを削除・番号変更しない。
- [データ境界] Owner Aの設定更新・補充がOwner BのCycle / Snapshotへ影響しない。
