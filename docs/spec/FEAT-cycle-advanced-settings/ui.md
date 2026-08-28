# FEAT-cycle-advanced-settings: ui 詳細設計

## 担保 AC（index.mdからの引用）

- **AC-5**: SettingsのCycleカードで期間、開始曜日、Cooldown、将来Cycle数を選択して保存できる。保存中は4項目と保存操作を無効化し、成功時は保存値を表示し、400 / 409 / 423 / 500では入力値と再試行導線を保持する。390pxで横overflowを出さない。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 表示 | `/settings`のCycleカード | `durationWeeks: 1..8`、`startWeekday: 0..6`、`cooldownWeeks: 0..4`、`futureCount: 1..15` | Bootstrapの本人設定のみ | 保存済み設定を表示 |
| 保存 | `onCycleSettings` → `/api/v1/cycle-settings` | 4項目とidempotencyKey | APIの既存契約へ委譲 | 設定を保存 |

## UI/UX方針

- **画面フロー / 導線**: Settingsの既存Cycleカード内で4つのselectを編集し、「Cycle設定を保存」で一括保存する。Cycle画面へ移動せず、成功後に保存値とTimezoneを同じカードへ表示する。
- **主要操作とフィードバック**: 保存中は4つのselectと保存ボタンを無効化し、見出しに「保存中…」を表示する。成功時は「Cycle設定を保存しました。」、失敗時は入力値を保持してfield errorまたは再試行ボタンを表示する。
- **状態設計（出し分け）**: 初期はBootstrap値、入力中は未保存値、ローディングはdisabled + status、400は該当field error、409は再取得後に競合通知、423 / 500は同じ入力値でRetry、成功は保存通知を表示する。
- **既存デザインシステムとの整合**: 既存の`settings-card`、`setting-row`、`cycle-settings-actions`、`setting-field-error`、`button`、`select`を再利用し、新しいPickerやModalは追加しない。

### レスポンシブ / アクセシビリティ

- Desktop（1200px以上）は既存の設定カードレイアウト、Tablet（768〜1199px）は1列寄り、Mobile（390pxを含む767px以下）は4つの設定行を縦積みにする。
- 各selectには可視テキストと`aria-label` / `aria-invalid` / `aria-describedby`を付け、保存ボタンはKeyboardのEnterで実行できる。
- 保存中のdisabled状態、成功status、field error、423 / 500のRetryを色だけに依存させず、テキストと`role="alert"` / `role="status"`で伝える。
- 既存のモバイルCSSを使い、selectとボタンの最小操作領域44px、カード幅390pxで横overflowなしを維持する。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| 400 field error | 入力値を戻さず、該当行にエラーを表示して再試行を出す |
| 409 conflict | `onRefresh`で最新設定を取得し、競合メッセージを表示する |
| 423 lock | 入力値を保持し、同じmutation signatureのRetryで同じKeyを再利用する |
| 500 / 通信障害 | 入力値を保持し、再試行導線を表示する |

## テストケース（技法注記付き）

- [代表値] CycleカードにCooldownと将来Cycle数のselect、保存値、Timezone、保存ボタンが表示される。
- [状態遷移] 4項目を選択して保存し、`onCycleSettings`へ4項目とKeyが渡る。
- [境界値] Cooldown 0 / 4、futureCount 1 / 15のoptionを表示する。
- [状態遷移] 保存中は4つのselectと保存ボタンがdisabledになる。
- [異常系] 400 / 409 / 423のいずれでも入力値を保持し、field error / conflict / Retryを表示する。
- [アクセシビリティ] 390pxのCycleカードに横overflowがなく、selectとRetryをKeyboardで操作できる。
