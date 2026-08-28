# FEAT-cycle-settings: ui 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: Bootstrapは本人の`cycleSettings`（`enabled`、`durationWeeks`、`cooldownWeeks`、`startWeekday`、`futureCount`）を返し、設定の再取得で保存値を保持する。
- **AC-2**: 本人が`PATCH /api/v1/cycle-settings`へ`durationWeeks`（1〜8の整数）と`startWeekday`（0〜6の整数、0=日曜）を送ると保存でき、未知フィールド・範囲外・Owner外・Runtime lock中・同一Keyの異なるRequestを既存契約どおり拒否する。
- **AC-3**: Cycle設定保存後、Active / Completed CycleのID・日時・状態は変わらず、未開始かつ`scheduleOverridden = false`のUpcoming Cycleだけが、本人Timezoneの指定曜日00:00開始・指定期間で番号順に再計算される。`scheduleOverridden = true`のUpcoming Cycleは日時を保持し、後続自動Cycleの計算アンカーになる。
- **AC-4**: 設定変更後に生成される新規Upcoming CycleとCycle開始・完了時の後続自動Cycleは、保存済みの期間と開始曜日を使う。
- **AC-5**: SettingsにCycle設定カードを表示し、期間と開始曜日を選択して保存できる。保存中は対象操作を無効化し、成功時はUpcomingの再計算結果を再表示し、400 / 409 / 423 / 500では入力値と再試行導線を保持する。390pxで横overflowを出さない。

## このレイヤーが公開する契約

| 画面 / 部品 | 使用契約 | 状態 |
|---|---|---|
| `/settings` Cycle設定カード | Bootstrapの`cycleSettings` / `preferences.timezone`、`PATCH /api/v1/cycle-settings` | 初期値、編集中、保存中、成功、400 / 409 / 423 / 500 |
| 期間select | `durationWeeks: 1..8` | `aria-label="Cycle期間"`、保存中disabled |
| 開始曜日select | `startWeekday: 0..6` | `aria-label="Cycle開始曜日"`、保存中disabled |

画面では「`{preferences.timezone}`の指定曜日00:00を開始境界」と説明する。2つの選択値を一つの保存操作で送信し、成功後にBootstrapを再取得してUpcomingの日付を表示へ反映する。

## UI/UX 方針

- **画面フロー / 導線**: SidebarまたはMobile NavigationからSettingsへ入り、Appearanceの後にCycle設定カードを表示する。
- **主要操作とフィードバック**: 期間・開始曜日を選択し「Cycle設定を保存」を押す。保存中はselectとbuttonをdisabledにし、成功時は保存済み表示と再計算後の日付を反映する。
- **状態設計（出し分け）**: Bootstrap loadingは既存loading screen、設定値は現在値を初期表示、保存中は`role="status"`、成功はカード内メッセージ、400はfield error、409は最新値再取得、423 / 500は入力保持とRetryを表示する。
- **既存デザインシステムとの整合**: `.settings-card`、`.settings-card-title`、`.setting-row`、`.button`、`.detail-live-error`、`setting-value`を再利用する。

### レスポンシブ / アクセシビリティ

- 対象はDesktop、Tablet、390px以上のMobile。既存`.settings-grid`の1列化を利用し、390pxでカード・select・buttonを横にはみ出させない。
- 各selectとbuttonに可視テキストまたはaccessible nameを付け、保存中は対象操作をdisabledにする。
- 保存中は`role="status"`、失敗は`role="alert"`で通知し、曜日は色だけでなく曜日名を表示する。
- KeyboardのTab / Enterでselectと保存を操作でき、`prefers-reduced-motion`の既存設定を維持する。

## 異常系挙動

| シナリオ | uiの挙動 |
|---|---|
| 400 | 選択値を保持し、field errorをカード内に表示 |
| 409 | 最新Bootstrapを再取得し、最新の設定値を表示してConflictを通知 |
| 423 | 保存前の選択値とRetry keyを保持し、処理中表示を維持 |
| 500 / timeout / offline | 選択値を保持し、再試行ボタンを表示 |

## テストケース（技法注記付き）

- [代表値] Settingsに現在の期間・開始曜日・Timezone説明と保存ボタンを表示する。
- [状態遷移] 期間・曜日を選択 → 保存 → `onCycleSettings`へ両値とidempotencyKeyを渡す。
- [状態遷移] 保存中はselect / buttonがdisabledになり、成功後に保存済み表示を出す。
- [デシジョンテーブル] 400 / 409 / 423 / 500で選択値を保持し、alert / Retryを表示する。
- [境界値] 390pxでCycle設定カードの横overflowがなく、全selectにaccessible nameがある。
