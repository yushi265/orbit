# FEAT-home-project-inbox-ux AI-DLC 振り返り学習ノート（retro note）

## メタ

- ticket: FEAT-home-project-inbox-ux
- 機能概要: Homeを今日の作業入口へ刷新し、Project詳細へIssue workspaceと別端末同期する表示設定を追加し、Inboxの使い方を説明する。
- Stage宣言の結果: Tier 1。Stage 0+1 / 2 / 3+4 / 5 / 6 / 8を実行。Gate 2は非委任。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-29 / 未完了

## 各Stageの気づき（材料・軽量）

| Stage | 気づき（摩擦・想定外・判断） |
|---|---|
| 1 要件整理＋Stage宣言 | 別端末同期を含めることで、Project表示設定はlocalStorageではなくSnapshot / API契約が必要になった。 |
| 2 spec作成 | 既存のProject詳細は一覧下埋め込み、Inboxは既読・遷移中心で、要求との差分が画面ごとに分かれていた。 |
| 3+4 TDD | Gate 2承認後、契約テストから開始する。 |
| 5 静的解析 | 未着手 |
| 6 セルフレビュー | 未着手 |
| 8 成果提示 | 未着手 |

## 振り返り（KPT）

### Keep

- 既存Issue一覧の操作部品とSnapshot bridgeを先に調査して再利用範囲を確定する。

### Problem

- `[spec]` Project表示設定の同期対象を要件整理時に明示しないと、UI-only案と永続化案が分岐する。

### Try

- Project単位の表示設定を追加する時は、初期値・同期範囲・同じKeyの再送をStage 1で先に確定する。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| Project表示設定の同期範囲を要件整理で確認する | create-spec / Stage 0+1 | 未対応 |
