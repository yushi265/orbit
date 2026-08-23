# FEAT-issue-detail-workspace AI-DLC 振り返り学習ノート

## メタ

- ticket: FEAT-issue-detail-workspace
- 機能概要: Issue専用URLに説明、Notes、Relations、Activityを追加する。
- Stage宣言の結果: Tier 1 / spec実行 / TDD / 品質ゲート / self-reviewを実行。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-23 / 2026-08-24

## 各Stageの気づき

| Stage | 気づき |
|---|---|
| 1 要件整理＋Stage宣言 | 既存SchemaにNotes / Relations / Activityがあるため、Migrationを増やさず縦切りできる。 |
| 2 spec作成 | 既存Memory Storeと公開shared型の境界を先に固定する必要がある。 |
| 3+4 TDD | Noteの削除は論理削除、Relationの重複は既存行を返すNo-opとして既存Error codeの拡張を避けた。 |
| 5 静的解析 | TanStackの生成route treeはroot format対象から除外し、生成後に個別整形する必要がある。 |
| 6 セルフレビュー | 3観点レビューを再委譲し、最終Must 0を確認。ブラウザで見つかった`descriptionJson`混入とFocus再描画漏れを修正した。 |

## 振り返り（KPT）

### Keep

- 既存のIssue CAS / Activity / Outboxを再利用する。
- 共有wire schema、Service、API、UIを同じ縦切りで先に通し、最後にブラウザで再取得まで確認する。

### Problem

- [spec] 既存のMVP specはIssue detailの詳細挙動を契約化していなかった。
- [testing] 初回レビューで、APIの再送 / lock / Owner副作用とUIの再描画後Focusの証跡が不足していることが判明した。
- [runtime] 厳格な公開schemaを追加したことで、API変換後に内部`descriptionJson`をStoreへ渡す既存経路がブラウザ再取得時に表面化した。

### Try

- 次のFeatureではwire schemaとUI状態をGate 2で先に固定する。
- UIの保存Mutationは、成功レスポンスだけでなく再取得・再描画・Focus復帰までlocal browserで確認する。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| Feature detailのwire schemaを先に共有する | create-spec | 実施済み |
| UI Mutationの再取得 / Focusをbrowser smokeに含める | self-review / tdd-cycle | 次Featureで継続 |
