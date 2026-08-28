# FEAT-cycle-auto-add AI-DLC 振り返り学習ノート

## メタ

- ticket: FEAT-cycle-auto-add
- 機能概要: Started / Completedへ遷移した未所属Issueを、設定に応じてActive Cycleへ自動追加し、Automation履歴へ記録する。
- Stage宣言の結果: Tier 1。spec、TDD、品質ゲート、self-reviewを実行。Gate 2は継続指示による委任として扱う。
- 着手日 / 完了日: 2026-08-28 / 2026-08-28

## 各Stageの気づき

| Stage | 気づき |
|---|---|
| 1 要件整理＋Stage宣言 | `auto_add_to_current_cycle`はD1初期Schemaに先行して存在したが、RuntimeのCycleSettings model / Snapshot / UIへ未接続だった。 |
| 2 spec作成 | `system:manual-run`をAutomationへ流用せず、Activity actor typeを追加して意味を分離する契約にした。 |
| 3+4 TDD | 実装前RED 9件を確認し、Store / API / UI / SnapshotのケースをGREENへ収束させた。 |
| 5 静的解析 | format / lint / typecheck / production build / referee-checkが成功した。sandboxのtsx IPCだけ許可付き再実行を要した。 |
| 6 セルフレビュー | 委譲3体がタイムアウトしたため手動監査へ切替。bulkのActivity key衝突を発見し、Issue IDを含めて修正した。 |
| 8 成果提示 | CYC-10のコミット対象を確定し、本番配信へ進める。 |

## 振り返り（KPT）

### Keep

- 既存Schema、Owner / lock / version / Receipt境界を先に確認し、最小差分で機能を接続する。

### Problem

- `[boundary]` 既存D1のactor type制約とMemory SnapshotのActivity型が別々に存在するため、Automation actor追加時に両方を同期する必要がある。

### Try

- Activity actor typeを追加するボルトでは、正規化D1のMigrationとSnapshot往復テストを同じ実装タスクの初期ケースに含める。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| Activity actor typeのMigrationとSnapshotを同時に検証する | create-spec / tdd-cycle | 未対応 |
