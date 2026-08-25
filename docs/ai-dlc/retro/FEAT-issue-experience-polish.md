# FEAT-issue-experience-polish AI-DLC 振り返り学習ノート（retro note）

## メタ

- ticket: FEAT-issue-experience-polish
- 機能概要: Issue入力・Priority表示・List手動順・カラーテーマを改善する。
- Stage宣言の結果: Tier 1。Stage 0+1 / 2 / 3+4 / 5 / 6 / 8を実行。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-25 / 2026-08-25（Gate 3承認・コミット待ち）

## 各 Stage の気づき（材料・軽量）

| Stage | 気づき（摩擦・想定外・判断） |
|---|---|
| 1 要件整理＋Stage 宣言 | Project詳細は既存実装済みだったため、新規画面ではなく回帰確認へスコープを限定した。 |
| 2 spec 作成 | `issues.position`と`manual` orderは既存だが、複数Issueの再採番を安全に行うAPI契約は未実装だった。 |
| 3+4 TDD | IME、Reorder、ColorThemeを共有契約・Store・UIの順にRED→GREENし、旧Snapshot補完を途中で追加した。 |
| 5 静的解析 | gitleaksのテスト用idempotency key誤検知をキー名変更で解消し、pre-commitをgreenにした。 |
| 6 セルフレビュー | Board共通Order、filtered reorder、retry key、API境界をレビュー指摘から追加確認した。 |
| 8 成果提示 | Project詳細は既存実装を再利用し、codekbへ新API・migrationの罠を追記した。 |

## 振り返り（KPT）

### Keep

- Gate 1前に既存画面・契約・テストを確認し、既存Project詳細の重複実装を避ける。

### Problem

- `[spec]` 既存コードに先行して存在する`position` / `manual`契約と、未実装のUI・Mutation境界を実装前に明示する必要があった。

### Try

- 複数レコードを動かすMutationは、単一Issue PATCHへ無理に載せず、原子性と冪等性をspecで先に固定する。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| 既存の先行契約と未実装範囲をspec調査で切り分ける | `docs/ai-dlc/codekb/shared.md` | 未対応 |
