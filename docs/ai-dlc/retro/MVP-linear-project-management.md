# MVP-linear-project-management AI-DLC 振り返り学習ノート（retro note）

> 設計ドラフト段階の永続メモ。実装・品質ゲート・Gate 3 は未実施であり、完了時に追記する。

## メタ

- ticket: MVP-linear-project-management
- 機能概要: 要件定義書 v1.3 を個人用 Linear ライクプロジェクト管理 MVP のレイヤー別設計 spec へ分解した。
- Stage 宣言の結果: Stage 0+1 実行、Tier 1。Stage 2 実行。TDD / 静的解析 / セルフレビュー / Gate 3 は実装開始後に実行。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-23 / 未完了

## 各 Stage の気づき（材料・軽量）

| Stage | 気づき（摩擦・想定外・判断） |
|---|---|
| 1 要件整理＋Stage 宣言 | アプリ本体と codekb 実装スナップショットがなく、要件側で Route / Migration / Access JWT / Chunk 数値が未確定だったため、推測で埋めず Q&A へ分離した。 |
| 2 spec 作成 | 受入シナリオ AC-01〜13 を共有 AC-1〜13 に正規化し、D1 / shared / service / ui の境界ごとに引用を揃えた。 |

## 振り返り（KPT）

> Gate 3 で実装・レビューの結果を材料に確定する。

### Keep（効いた・次も続ける）

- 要件文書の未確定事項を設計判断と混ぜず、`questions.md` に分離する。
- レイヤー間契約を先に書き、AC の引用を各レイヤーにリテラルで持つ。

### Problem（詰まった・摩擦・想定外）

- `[spec]` 実装予定のレイヤー構造は明確だったが、具体的な Route / Migration / Access 検証方式は architecture の未確定事項に残っていた。

### Try（次ボルト以降でフローをこう変える）

- Phase 0 の技術検証結果を Q-1〜Q-8 の回答と ADR / spec の判断根拠へ収束させる。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| Phase 0 の未確定事項を spec の Q&A へ分離する | `create-spec` スキル / `docs/spec/_TEMPLATE/questions.md` | 未対応（本ノートで実施例を作成） |
