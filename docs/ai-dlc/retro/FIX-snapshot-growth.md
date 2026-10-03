# FIX-snapshot-growth AI-DLC 振り返り学習ノート（retro note）

## メタ

- ticket: FIX-snapshot-growth
- 機能概要: D1 Snapshotの肥大化を延命する（Receipt 24時間＋保存時自動削除、並び替えの記録削減、PurgeでActivity削除）
- Stage 宣言の結果: 全Stage実行（Tier 1・spec必須・Gate 2委任）
- トークン実測: 未計測
- 着手日 / 完了日: 2026-10-03 / 2026-10-03

## 各 Stage の気づき（材料・軽量）

| Stage | 気づき（摩擦・想定外・判断） |
|-------|------------------------------|
| 1 要件整理＋Stage 宣言 | 監査の短期対策案（requestHashのハッシュ化・Receipt期間短縮・reorder記録削減）が、rollback互換spec・要件定義・CYC-14 specの3契約と衝突していた。監査サブエージェントはコードだけ読み、specを読んでいなかった |
| 2 spec 作成 | sent Outboxの削除は`dedupeKey`の履歴照合（CYC-12の重複防止）を弱めると分かり、Gate 1提示案から外した。本番Snapshotサイズの計測は権限で拒否され未実施 |
| 3+4 TDD | implementerがFake D1を3件目としてコピーした。レビューでRule of Three到達と指摘され、test-fixturesへ抽出した |
| 6 セルフレビュー | test-qualityがデシジョンテーブルのno-op列欠落（Cycleスコープ）と、更新後オブジェクトを期待値に使う弱いassertを検出。code-reviewerのMust（codekb未更新・ゲート証跡）は、レビュー起動後に対応済みの時差だった |

## 振り返り（KPT）

### Keep
- 監査の改善案を実装前に既存spec・要件定義と突合し、衝突をGate 1で人間に提示した。
- 「効果がほぼ無く、重複防止を弱める」変更（sent Outbox削除）をspec段階で範囲から外した。

### Problem
- `[spec]` 監査サブエージェントへの依頼に「改善案は既存spec・要件と照合する」を含めておらず、契約と衝突する短期対策が上がった。
- `[tdd]` デシジョンテーブルの列（スコープ×no-op）が実装テストで一部欠けた。specの表記が1行にまとまっていて、列挙が読み取りにくかった。
- `[gate]` codekb更新とゲート証跡をレビュー起動の後に行ったため、レビュアーがMustとして報告した。

### Try
- 監査・調査の委譲プロンプトに「改善案は docs/spec と docs/requirements の既存契約と照合し、衝突を明記する」を定型で入れる。
- デシジョンテーブルのテストケースは、specで全列を1行ずつ列挙する。
- codekb追記とゲート証跡の記録は、セルフレビュー起動の前に済ませる。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| 委譲プロンプトへ既存契約の照合を定型化 | ai-dlc-flow / 監査系スキル | 未対応 |
| デシジョンテーブルは全列を1行ずつ列挙 | create-spec | 未対応 |
| codekb・証跡はレビュー前に | ai-dlc-flow Stage 5 | 未対応 |
