# PHASE2 Issue core AI-DLC 振り返り学習ノート（retro note）

## メタ

- ticket: PHASE2-issue-core
- 機能概要: Issue coreの不足機能（属性・親子・lifecycle・検索履歴・Command / Shortcut）を既存契約へ統合する。
- Stage宣言の結果: Stage 0+1 / 2 / 3+4 / 5 / 6 / 8を実行。Tier 1、Gate 1 / Gate 2承認済み、Gate 3承認待ち。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-27 / 未完了

## 各Stageの気づき（材料・軽量）

| Stage | 気づき（摩擦・想定外・判断） |
|---|---|
| 1 要件整理＋Stage宣言 | 先行Feature specと親MVP specの状態表に差があるため、Phase 2は既存資産を再利用し不足分だけを補足契約にした。 |
| 2 spec作成 | Recentは既存Snapshot CASへ追加し、GET副作用を避ける明示POSTへ分離する方針を採用した。 |
| 3+4 TDD | 追加テストのRED確認後、shared / data / service / UIを順にGREEN化。 |
| 5 静的解析 | 49 files / 240 tests、typecheck / lint / format / referee / production buildを確認。Coverageは依存未導入で未計測。 |
| 6 セルフレビュー | 委譲3体はtimeoutのためshutdown。メインループがAC・契約・Owner scope・既存差分を手動監査しMustなし。 |
| 8 成果提示 | Gate 3承認待ち。 |

## 振り返り（KPT）

### Keep

- 既存のIssue / Owner / Lock / Version / Receipt契約を再利用し、Phase単位で不足機能を閉じる。

### Problem

- `[spec]` 既存Feature specの完了状態と実装の実態が一致しないため、現実装調査を先に行う必要がある。
- `[tooling]` self-reviewの委譲が規定時間内に返らず、メインループの手動監査へフォールバックした。Coverage依存も未導入だった。

### Try

- Stage 2の段階で、先行実装済みのACと未実装ACを分けた差分表を必ずspecへ残す。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| 先行実装済みACと未実装ACの差分表をspecへ残す | create-spec / docs/spec/_TEMPLATE | 未対応 |
