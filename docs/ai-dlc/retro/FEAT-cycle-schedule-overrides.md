# FEAT-cycle-schedule-overrides AI-DLC 振り返り学習ノート

## メタ

- ticket: FEAT-cycle-schedule-overrides
- 機能概要: Upcoming Cycleの開始日・終了日を個別調整し、後続自動Cycleを再計算する。
- Stage宣言の結果: Tier 1。spec、TDD、品質ゲート、self-reviewを実行。self-review委譲は未返答時に手動監査へ切り替える。
- 着手日 / 完了日: 2026-08-28 / 2026-08-28

## 各Stageの気づき

| Stage | 気づき |
|---|---|
| 0+1 要件整理 | 実装済みCycle設定・境界遷移との依存を整理し、CYC-06を次タスクとして選定した。 |
| 2 spec作成 | 日付文字列をユーザーTimezoneの00:00へ変換し、既存Metadata APIへ混在させず専用PATCHへ分離した。 |
| 3+4 TDD | 適用前に前後Cycleの重複を検証し、対象と後続Cycleを部分更新しない状態遷移を固定した。レビューで見つかった年境界・DST欠落・409 draft保持も追加テストと実装修正で閉じた。 |
| 5 品質ゲート | 290テスト、typecheck、lint、format、production build、referee-checkが成功した。 |
| 6 セルフレビュー | code / spec-conformance / test-qualityの委譲は返答前にタイムアウト。diff、AC引用、Owner / lock / idempotency / Snapshotを手動で再確認した。 |
| 8 成果提示 | コミット・本番反映は次の明示指示で実施する。 |

## 振り返り（KPT）

### Keep

- 日付入力はブラウザTimezoneに依存せず、ServerのIANA timezone境界へ変換する。
- 自動Cycleと個別調整Cycleを分け、後続自動Cycleの再計算アンカーを明示する。

### Problem

- [scope] 個別調整の対象と、後続自動Cycleの再計算範囲を同じMutation内で扱う必要があり、単純なCycle更新より検証順序が重要だった。

### Try

- 日付変更系では、前方・後方の重複と後続再計算を別テストケースとして最初に台帳へ置く。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| 日付変更の前後重複テストをspecテンプレートへ反映する | create-spec / tdd-cycle | 未対応 |
