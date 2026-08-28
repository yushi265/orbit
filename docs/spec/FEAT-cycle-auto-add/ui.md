# FEAT-cycle-auto-add: ui 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: `PATCH /api/v1/cycle-settings` は`autoAddToCurrentCycle`（boolean）を受け付け、BootstrapとSnapshot再読込で保存値を返す。未知フィールド・boolean以外・Owner外・Runtime lock中・同一Keyの異なるRequestは既存の400 / 404 / 409 / 423契約どおり拒否し、旧Snapshotで値が欠落している場合は`false`へ補完する。
- **AC-5**: SettingsのCycleカードで自動追加のON/OFFをキーボード操作できる。保存中は操作と保存ボタンを無効化し、成功表示、400 field error、409 conflict、423 / 500 Retryを既存の設定UIと同じ方式で表示する。Issue詳細の変更履歴では自動割当を`Automation`として識別でき、390px幅で横overflowを発生させない。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 表示 | `/settings`のCycleカード | Bootstrapの`cycleSettings.autoAddToCurrentCycle: boolean` | 本人のBootstrapのみ | 自動追加設定の表示 |
| 保存 | `onCycleSettings` → `/api/v1/cycle-settings` | 既存4項目 + `autoAddToCurrentCycle` + idempotencyKey | APIの既存契約へ委譲 | ON/OFF保存 |
| 履歴表示 | Issue DetailのActivity | `actorType === "system:automation"`を`Automation`として表示 | 本人のIssue detailのみ | 自動割当の識別 |

## UI/UX方針

- **画面フロー / 導線**: Settingsの既存Cycleカード内に「Started / CompletedのIssueをCurrent Cycleへ自動追加」チェックボックスを置き、他のCycle設定と一括保存する。Issueのstatus変更後は既存のIssue refreshでCycle割当を反映する。
- **主要操作とフィードバック**: チェックボックスはSpace / Enterを含むキーボード操作に対応する。保存中はcheckbox、4つのselect、保存ボタンをdisabledにし、見出しのstatusへ「保存中…」を表示する。成功時は「Cycle設定を保存しました。」、自動割当の履歴は「Automation」と表示する。
- **状態設計（出し分け）**: 初期はBootstrap値、入力中は未保存値、保存中はdisabled、400はfield error、409は最新設定を再取得して競合通知、423 / 500は入力値と同じmutation signatureのRetry、成功は保存通知を表示する。設定OFF時は自動割当を行わず、UIはOFF状態を明示する。
- **既存デザインシステムとの整合**: 既存の`settings-card`、`setting-row`、`cycle-settings-actions`、`setting-field-error`、`button`、`input[type=checkbox]`、`role=alert` / `role=status`を再利用し、新規SwitchライブラリやModalは追加しない。

### レスポンシブ / アクセシビリティ

- Desktop（1200px以上）は既存Settingsカード内で説明とcheckboxを横並びにし、Tablet（768〜1199px）は1列寄り、Mobile（390pxを含む767px以下）は説明と操作を縦積みにして横overflowを出さない。
- checkboxには可視ラベルと一意な`aria-label`を付け、`aria-invalid` / `aria-describedby`でfield errorへ関連付ける。操作領域は既存の44px基準を満たす。
- 保存中、成功、field error、Retryは色だけに依存させず、disabled属性、テキスト、`role=status`、`role=alert`で伝える。
- Issue DetailのAutomation表示はactor typeをテキストで示し、色やActivity dotだけで自動処理を表現しない。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| 400 field error | checkboxの入力値を戻さず、Cycle設定行にエラーを表示する |
| 409 conflict | `onRefresh`で最新設定を取得し、競合メッセージとRetryを表示する |
| 423 lock | 入力値を保持し、同じmutation signatureで再試行する |
| 500 / 通信障害 | 入力値を保持し、再試行導線を表示する |

## テストケース（技法注記付き）

- [代表値] Cycleカードに自動追加checkboxが表示され、Bootstrapのtrue / falseを反映する。
- [状態遷移] checkboxを切り替えて保存し、`onCycleSettings`へbooleanを含む全設定とKeyを渡す。
- [状態遷移] 保存中はcheckbox、4つのselect、保存ボタンがdisabledになる。
- [異常系] 400 / 409 / 423 / 500で入力値を保持し、field error / conflict / Retryを表示する。
- [アクセシビリティ] labelとaria属性があり、390px相当のDOM構造に横overflowを生む固定幅がない。
- [代表値] Issue Detailの`system:automation` Activityが`Automation`と表示される。
