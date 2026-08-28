# CYC-11 AI-DLC 振り返り学習ノート

## メタ

- ticket: CYC-11
- 機能概要: 既存SnapshotのCycle繰越履歴をIssue詳細とCycles画面へread-only表示する。
- Stage宣言の結果: Tier 1。spec、TDD、品質ゲート、self-reviewを実行する。Gate 2は非委任。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-28 / 2026-08-29

## 各Stageの気づき（材料・軽量）

| Stage | 気づき（摩擦・想定外・判断） |
|---|---|
| 1 要件整理＋Stage宣言 | `cycleHistory`はSnapshotに既存だが、Issue Detail / Bootstrapの公開契約とCycles UIには未接続だった。表示粒度をCycle行のincoming件数と選択Cycleの元Cycle表示に固定した。 |
| 2 spec作成 | 正規化`cycle_issue_history`への新規読出しを作らず、production現行のSnapshotをread sourceとして公開投影する方針にした。 |
| 3+4 TDD | shared / service / uiのRED→GREENを実施し、全体324テストまで拡張した。 |
| 5 静的解析 | typecheck、test、lint、format、production build、referee-checkをGREENで確認した。 |
| 6 セルフレビュー | 複数ラウンドの指摘を補強し、取得済みレビューPASSと手動監査でMustなしを確認した。最終再委譲workerはタイムアウトのため報告を採用していない。 |
| 8 成果提示 | AC達成状況、品質ゲート、レビュー結果、未確認範囲を整理し、Gate 3承認済み。進捗の揮発ファイルを除去してコミット・本番配信へ進む。 |

## 振り返り（KPT）

### Keep

- 既存Snapshotのread sourceとOwner境界を先に固定し、Issue Detail / Bootstrapの既存GETを再利用する。

### Problem（詰まった・摩擦・想定外）

- `[testing]` read-only表示でも、既存loading/error導線・Owner参照境界・production SessionをACごとに直接検証する必要がある。
- `[tooling]` macOSのNode architecture差異と未導入gitleaksで品質ゲートの再試行が発生した。

### Try（次ボルト以降でフローをこう変える）

- UIの390px実機確認はRelease hardeningのbrowser smokeへ接続する。
- Stage 5開始時にNodeの実行architectureとsecret検知ツールの有無を確認する。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| UIの390px実機確認をRelease hardeningで行う | self-review / release hardening | 未対応 |
| 品質ゲート前にNode architectureとgitleaksを確認する | Codex adapter / task-and-pr | 未対応 |
