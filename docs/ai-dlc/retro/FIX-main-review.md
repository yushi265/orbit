# FIX-main-review 振り返り

## メタ

- ticket: FIX-main-review
- 機能概要: mainのローカルD1・Browserレビューで見つかった19件の修正。
- Stage: spec・TDD・品質ゲート・3観点レビュー・コミットを実施する。
- 着手日: 2026-10-02
- トークン実測: 未計測

## 各Stageの気づき

| Stage | 気づき |
|---|---|
| 要件・契約 | 期限の入力は日付だけだが保存契約はtimestamp。既存データの意味を確認してから修正する。 |
| 調査 | IssuesとDetailは兄弟Routeで、FilterのuseStateを共有しない。URL導入時は未取得Bootstrapによる参照ID初期化を避ける。 |
| TDD | 表示用limitをBootstrapや業務処理で流用すると境界件数で欠落する。 |

## KPT

### Keep

- Browser実測と境界件数の回帰テストを組み合わせる。
- 表示制限と業務全件抽出を分け、Run chunk failureは既存Snapshotで復元する。

### Problem

- [boundary] 表示上限が業務対象の抽出に混入していた。
- [tooling] 子プロセスのgitとlocalhostのsandbox制約は、実装失敗と分けて再検証する必要がある。

### Try

- 全件を対象にする業務処理には、表示上限の境界＋1件を必ず検証する。

## フロー改善候補

| Try | 還流先 | 状態 |
|---|---|---|
| 表示上限と業務抽出の境界テスト | レイヤーテスト規約 | 提案のみ。ハーネス変更は今回対象外 |
