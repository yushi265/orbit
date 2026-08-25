# FEAT-issue-controls AI-DLC 振り返り学習ノート（retro note）

## メタ

- ticket: FEAT-issue-controls
- 機能概要: Issue詳細Status変更、完了Issue表示切替、Issueソート
- Stage宣言の結果: Tier 2。UI specを作成し、既存APIを再利用して実装。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-25 / 2026-08-25

## 各 Stage の気づき（材料・軽量）

| Stage | 気づき |
|---|---|
| 1 要件整理＋Stage宣言 | 既存のIssue PATCHとBootstrapだけで3機能を完結できるため、API追加を避ける方針を確定した。 |
| 2 spec作成 | 完了判定は表示名ではなくworkflow stateのcategoryを使う必要がある。 |
| 3+4 TDD | 純粋関数に完了判定・ソートを切り出すことで、List / Board共通の順序を単体テストできた。 |
| 5 静的解析 | 既存のoptimistic mutationとAPI契約を変更せず、UIだけで3機能を成立させられた。 |

## 振り返り（KPT）

### Keep

- 既存のoptimistic mutationと表示配列を再利用する。

### Problem

- `[spec]` 実装前にSortの選択肢とcompletedの定義を明文化する必要があった。

### Try

- 一覧系のUI機能は、表示状態・ソート・空状態をspecのテストケースへ先に落とす。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| 一覧系UIの表示契約を先に列挙する | create-spec / UI spec | 反映済み |
