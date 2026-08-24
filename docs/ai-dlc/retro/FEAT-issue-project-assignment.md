# FEAT-issue-project-assignment AI-DLC 振り返り学習ノート

## メタ

- ticket: FEAT-issue-project-assignment
- 機能概要: Issueの新規作成・一覧・詳細からProjectを割り当て・解除する
- Stage宣言の結果: Tier 1としてspec、TDD、静的解析、セルフレビューを実行
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-25 / 2026-08-25

## 各 Stage の気づき（材料・軽量）

| Stage | 気づき（摩擦・想定外・判断） |
|---|---|
| 1 要件整理＋Stage宣言 | UIだけの追加に見えても、新規作成時にOwner境界の既存検証不備が露出したためTier 1へ再宣言した。 |
| 2 spec作成 | 既存Issue APIの入力契約を変えず、画面導線と検証責務をspecへ分離した。 |
| 3+4 TDD | ProjectなしをUIの空文字からAPIのnullへ正規化する共通処理を先にテストした。 |
| 5 静的解析 | Wranglerのログ先を`/tmp`へ切り替え、buildとpre-commitのsecret検知を通した。 |
| 6 セルフレビュー | 競合後のBootstrap cache同期、一覧retryのクロージャ、route遷移中のin-flight mutation混入を順に修正した。 |
| 8 成果提示 | Browser/component smokeはRelease hardeningへ延期し、サービス/API境界と静的ゲートをGate 3証跡にした。 |

## 振り返り（KPT）

### Keep

- レビューを設計・要件・テストの3観点に分けて、UIと既存契約の差分を確認する。

### Problem

- `[boundary]` 新規Issue作成のProject存在検証が既存Storeで不足していたため、UI追加時に境界テストを先に補正した。
- `[review]` UIの再試行はstate更新直後のクロージャを避け、再送対象を操作へ直接渡す必要があった。

### Try

- Owner境界を持つ選択肢をUIへ追加する際は、作成・更新の両方で不正IDテストを先に確認する。
- UIの失敗再試行は、stateではなく失敗した入力を明示的に保持する。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| Owner境界選択肢の作成・更新テストを先に確認 | docs/ai-dlc/codekb/shared.md | 未対応 |
