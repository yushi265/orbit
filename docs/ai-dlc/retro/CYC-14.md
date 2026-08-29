# CYC-14 AI-DLC 振り返り学習ノート

## メタ

- ticket: CYC-14
- 機能概要: Cycle詳細のIssueをList / Boardから同一Cycle内で並び替えられるようにする。
- Stage宣言の結果: Tier 1。spec、TDD、品質ゲート、self-reviewを実行する。Gate 2はユーザー指定により委任。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-29 / 2026-08-29

## 各Stageの気づき（材料・軽量）

| Stage | 気づき（摩擦・想定外・判断） |
|---|---|
| 1 要件整理＋Stage宣言 | 既存のIssue List手動順は全体scope、Cycle詳細はIssue一覧のみ、Boardは表示のみだった。Cycle追加・解除は既存導線を維持し、今回の差分をCycle詳細の順序操作へ絞った。 |
| 2 spec作成 | `Issue.position`を新規schemaへ拡張せず、Cycle内の既存position slotを置換する契約にした。BoardはStatus列内だけをscopeにして、並び替えとStatus変更を分離した。 |
| 3+4 TDD | shared契約 → service scope / position slot → Cycle詳細UIの順にRED→GREENを進めた。Cycle外position・Board同一Status・Completed read-onlyを追加テストで固定した。 |
| 5 静的解析 | typecheck、全63ファイル342テスト、lint、format、production build、referee-check、pre-commitを確認した。 |
| 6 セルフレビュー | 3観点の委譲を2回試みたが各回120秒で報告が返らず、成果を採用せずに手動監査へ切り替えた。 |
| 8 成果提示 | Gate 3承認済み。progressを除去し、コミット・main push・本番配信を実施する。 |

## 振り返り（KPT）

### Keep

- 既存のIssue position / reorder / Owner境界を先に調査し、新規D1 Migrationを避ける方針をGate 1で確定する。

### Problem（詰まった・摩擦・想定外）

- `[spec]` 既存の全体manual orderとCycleスコープの順序が同じposition列を共有するため、slot置換の不変条件を実装・テストで明示する必要がある。
- `[boundary]` BoardのStatus列操作はCycle境界とStatus境界を同時に検証する必要がある。
- `[tooling]` Explore / reviewer workerのタイムアウト時に、取得済みのRED・GREEN・品質ゲートを使って手動監査へ切り替える判断を記録する必要がある。

### Try（次ボルト以降でフローをこう変える）

- 実ブラウザの390px / touch drag確認をRelease hardeningのsmokeへ接続する。
- Cycle scoped reorderのscope組合せをdecision tableから先にテストファイルへ転記する。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| 390px / touch dragの実測をRelease hardeningで行う | self-review / release hardening | 未対応 |
| Cycle / Status scope組合せのdecision tableをテンプレートへ反映する | tdd-cycle / create-spec | 未対応 |
