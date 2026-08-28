# FEAT-cycle-schedule-overrides: ui 詳細設計

## 担保 AC（index.mdからの引用）

- **AC-4**: Upcoming Cycle詳細で開始日・終了日を編集して保存できる。保存中は対象操作を無効化し、成功時は再表示へ反映する。400 / 409 / 423 / 500では入力値と再試行導線を保持し、390pxで横overflowを出さずKeyboard / Pointerで操作できる。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 表示 | `/cycles/:cycleId` | Upcomingのみ開始日・終了日を`YYYY-MM-DD`で表示 | BootstrapのOwner scoped Cycleのみ | 個別日付を編集 |
| 保存 | `apiPatch('/api/v1/cycles/:cycleId/schedule')` | `{ idempotencyKey, startDate, endDate }` | APIへ委譲 | 日付調整を保存 |

## UI/UX方針

- **画面フロー / 導線**: Upcoming Cycle詳細の「日付を調整」から開始日・終了日を編集し、「日付を保存」で確定する。Current / Pastでは日付調整操作を表示しない。
- **主要操作とフィードバック**: 保存中は2つのdate inputと保存ボタンを無効化する。成功時はCycleを再取得し、400はfield error、409は最新Bootstrap、423 / 500は同じ入力値のRetryを表示する。
- **状態設計（出し分け）**: 通常は保存済み日付、編集時はdraft、保存中はdisabled、重複・期間不正は入力保持、成功は編集を閉じて再表示、失敗はRetryを表示する。
- **既存デザインシステムとの整合**: 既存`cycle-detail`、`cycle-metadata-editor`、`field-label`、`text-input`、`button`、`detail-live-error`を再利用し、新規ModalやDatePickerライブラリは追加しない。

### レスポンシブ / アクセシビリティ

- Desktop / Tabletは既存Cycle詳細の編集幅、Mobile（390pxを含む767px以下）は開始日・終了日・保存ボタンを縦積みにする。
- 各date inputには可視labelと`aria-label` / `aria-invalid` / `aria-describedby`を付け、保存・Retry・編集切替はKeyboardで操作できる。
- 保存中、成功、field error、Conflict、Lockを色だけに依存させず、テキストと`role="status"` / `role="alert"`で示す。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| 400 | 入力を保持しfield error / Retryを表示 |
| 409 | `onRefresh`で最新Cycleを取得しConflictを表示 |
| 423 | 入力を保持し同じsignatureのRetryを表示 |
| 500 / 通信障害 | 入力を保持しRetryを表示 |
| Active / Completed | 日付調整UIを表示しない |

## テストケース（技法注記付き）

- [状態遷移] Upcoming詳細に「日付を調整」とdate inputが表示される。
- [状態遷移] 開始日・終了日を変更して保存し、schedule APIへ同じ値を送る。
- [状態遷移] 保存中はdate input・保存ボタンがdisabledになる。
- [異常系] 400 / 409 / 423で入力値を保持し、field error / Conflict / Retryを表示する。
- [境界値] Active / Completedでは調整UIがなく、390pxで固定幅overflowを発生させない。
