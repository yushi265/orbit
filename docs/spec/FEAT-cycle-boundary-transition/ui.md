# FEAT-cycle-boundary-transition: ui 詳細設計

## 担保 AC（index.mdからの引用）

- **AC-4**: Current画面でActive Cycleがない場合、Upcoming Cycleがあれば次回開始日時とUpcomingへの導線を表示し、Cooldown状態を「Active Cycleなし」とテキストで示す。390pxで横overflowを出さず、既存の開始・完了操作を壊さない。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 表示 | `/cycles`のCurrentタブ | BootstrapのOwner scoped `cycles`を使用 | UIはAPIのOwner結果だけを表示 | Active / Cooldown状態の表示 |
| 導線 | Upcomingカード / Current空状態 | 対象Cycleの既存URL `/cycles/:cycleId`へ遷移 | 対象がBootstrapに存在する場合のみ | 次回Cycleの確認 |

## UI/UX方針

- **画面フロー / 導線**: CurrentタブにActive Cycleがない場合、最も早いUpcoming Cycleの開始日時と「Upcomingを確認」導線を表示する。開始日時到来後はMaintenance Runの再取得結果でActive表示へ切り替わる。
- **主要操作とフィードバック**: Cooldown中は「Active Cycleなし」「次回開始: …」を表示し、開始ボタンをActiveなしの状態で表示しない。Upcomingへの導線は既存のタブ切替またはCycle詳細遷移を使う。
- **状態設計（出し分け）**: Activeありは既存Current詳細、Activeなし・UpcomingありはCooldownカード、Cycleなしは既存EmptyState、Run中は既存Overlay、API / Bootstrap障害は既存エラー状態を使う。
- **既存デザインシステムとの整合**: 既存`EmptyState`、`cycle-tabs`、`detail-card`、`timeline-list`、`button`、`status-pill`を再利用し、新規チャートやModalは追加しない。

### レスポンシブ / アクセシビリティ

- Desktop / Tabletは既存Cycle詳細と同じ余白を使い、Mobile（390pxを含む767px以下）は空状態カードを縦積みにする。
- 次回開始日時はテキストで表示し、色だけでCooldownを表現しない。導線はButtonとしてKeyboardのEnter / Spaceで操作できる。
- 既存の`cycle-blocking-overlay`とRun Overlayの操作阻害契約を変更せず、横方向の固定幅を追加しない。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| Activeなし・Upcomingあり | 次回開始時刻とUpcoming導線を表示 |
| Cycleなし | 既存の「Active Cycleはありません」EmptyStateとUpcoming導線を表示 |
| Bootstrap障害 | 既存Loading / Error表示を維持 |
| Run中 | 既存フルスクリーンOverlayを表示し、開始・完了操作を確定させない |

## テストケース（技法注記付き）

- [状態遷移] Activeなし・UpcomingありのCurrent表示に次回開始日時と導線がある。
- [状態遷移] Activeありでは既存Cycle詳細と完了操作を維持する。
- [アクセシビリティ] 導線がvisible textを持ち、Keyboardで操作できる。
- [境界値] 390pxのCurrent空状態に固定幅を追加せず横overflowを発生させない。
