# FEAT-cycle-workspace AI-DLC 振り返り学習ノート

## メタ

- ticket: FEAT-cycle-workspace
- 機能概要: CycleのCurrent / Upcoming / Past、metadata、Issue割当、進捗を強化する。
- Stage宣言の結果: Tier 1 / spec / TDD / 品質ゲート / self-reviewを実行。最終Must 0。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-24 / 2026-08-24

## 各Stageの気づき

| Stage | 気づき |
|---|---|
| 1 要件整理＋Stage宣言 | 既存BootstrapとIssue CASを再利用し、Cycle専用の新規一覧APIを増やさずに縦切りできる。 |
| 2 spec作成 | D1 cyclesはnameOverride / descriptionJsonの形なので、Memory StoreのCycleモデルとの変換を明記した。 |
| 3+4 TDD | closeの冪等性、Issue CAS再取得、shared metrics、metadata Escapeをレビュー指摘から追加した。 |
| 5 静的解析 | 11 files / 72 tests、typecheck / lint / format / build / refereeを通過した。 |
| 6 セルフレビュー | 3観点の最終Must 0。UIはlocal browser smokeをE2E任意の既存方針と突合して受容した。 |
| 8 成果提示 | Cycle workspaceをmainへコミットし、progress.mdは除去した。 |
| Follow-up | Active Cycleだけの既存SnapshotではUpcomingがなく、開始導線が存在しなかったため、Bootstrap時の後続Cycle補充とCurrentからの開始導線を追加した。 |

## 振り返り（KPT）

### Keep

- 既存Cycle close / Issue update / Runtime lockを再利用する。
- Metrics / status分類をshared pure functionに寄せ、HomeとCycle detailの表示差異を防ぐ。

### Problem

- [spec] CycleSettingsやGraphを一度に扱うとScopeが膨らむため、metadataとmetricsへ境界を絞った。
- [review] UIのclose中Keyboard操作、Escape取消、Issue CAS競合の再取得を初回差分で見落とした。

### Try

- Cycle UIのmetrics計算を純粋関数として先にテストする。
- UI smokeでは空状態、Keyboard、viewport境界まで一度に記録する。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| Cycle metadataとD1 column mappingをGate 2で確認する | create-spec | 実施済み |
| UI smokeのviewport / Keyboard証跡を残す | self-review / tdd-cycle | 実施済み |
