# PHASE1 Foundation AI-DLC 振り返り学習ノート（retro note）

## メタ

- ticket: PHASE1-foundation
- 機能概要: 本番Owner bootstrap、個人設定、Workflow設定、Background lock / 状態表示をFoundationとして整備する。
- Stage宣言の結果: Stage 0+1 / 2 / 3+4 / 5 / 6 / 8を実行。Tier 1、spec作成・Gate 2承認あり、Gate 3は未承認。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-26 / 未完了

## 各 Stage の気づき（材料・軽量）

| Stage | 気づき（摩擦・想定外・判断） |
|---|---|
| 1 要件整理＋Stage 宣言 | 既存MVP実装と親specのUnit状態に差があったため、Foundationの不足だけを補足specへ切り出した。 |
| 2 spec 作成 | Preferencesは既存APIを拡張し、Workflowは別Routeへ分離することで、既存契約を壊さずに境界を固定できた。 |
| 3+4 TDD | Lease期限切れをGET後に保存する必要がある一方、任意のGET内変更は保存しない契約があり、background dirty flagへ限定した。 |
| 5 静的解析 | `tsx`のIPC pipeとGit index書き込みがsandboxで拒否されたため、必要な検証だけ権限昇格・一時領域で実行した。 |
| 6 セルフレビュー | 期限切れ/pending Run、必須idempotency、D1障害、UIのfieldErrorsとpending表示を追加検証し、初回指摘を実装へ反映した。 |
| 8 成果提示 | Gate 3でKPT・codekb差分・未確認の実Access/remote D1/実ブラウザを確認する。 |

## 振り返り（KPT）

### Keep（効いた・次も続ける）

- 既存API / Store / Bootstrapを再利用し、レイヤー間契約だけを追加する。
- 失敗系と再送を先にテストへ置き、Owner / lock / idempotencyを同じ境界で確認する。

### Problem（詰まった・摩擦・想定外）

- `[spec]` 親MVP specのUnit状態と実装の現状が一致せず、Phase1の残範囲を補足specで再定義する必要があった。
- `[tooling]` sandboxではtsx IPCとGit一時indexの書き込みができず、権威ゲートの実行方法に環境差が出た。
- `[review]` 初回レビューで、設定値の厳密な入力境界・pending Runの二重起動・UIエラー状態の証跡漏れが見つかった。

### Try（次ボルト以降でフローをこう変える）

- Stage 2でテストケースを実装タスクごとに分割し、追加検証のRED/GREEN証跡をprogressへ同時記録する。
- production / browser固有の検証をStage 5の候補コマンドとして早めに一覧化し、未実測範囲をGate 3で明示する。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| テストケースとRED証跡をタスク単位で対応づける | `tdd-cycle` / `docs/spec/_TEMPLATE/progress.md` | 未対応 |
| sandboxで失敗する権威コマンドの代替実行方法をCodex adapterへ整理する | `docs/ai-dlc/codex-adapter.md` | 未対応 |
