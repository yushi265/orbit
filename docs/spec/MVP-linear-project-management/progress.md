# MVP 進行状態（progress）

> 揮発物。AI-DLC の中断・再開用スナップショット。契約は `index.md` と各レイヤー spec が正本であり、本ファイルは Gate 3 / merge 前に除去する。

## Stage 宣言（Gate 1 で承認）

> リスクティア: **Tier 1**。根拠は、D1 Schema / Migration、Cloudflare Access の認証・認可、`user_id` によるデータ境界、共有 API 契約、Cycle の自動遷移・繰越、Background Run の実行ロックを同時に設計対象とするため。
> Gate 2 委任: **なし（デフォルト）**。人間が明示的に委任するまで Gate 2 の承認待ちとする。

| Stage | 区分 | 実行 / スキップ | 理由 |
|---|---|---|---|
| 0+1 Stage 宣言＋要件整理 | 🔒必須 | 実行 | 要件定義 6 文書、全体アーキテクチャ、横断規約、既存実装の有無を確認した。 |
| 2 spec 作成 | 🔒Tier 1 必須 | 実行 | 複数レイヤー、D1、認証境界、共有契約、Cycle / Background の設計を含む。 |
| 3+4 TDD（RED→GREEN→REFACTOR） | 🔒必須 | 保留 | 本ターンは設計書作成のみ。Gate 1 / Gate 2 と質問回答後に実装時実行する。 |
| 5 静的解析・フォーマッター | 🔒必須 | 保留 | アプリ本体未実装で対象コマンド未定義。設計確定後に実行する。 |
| 6 セルフレビュー | 🔒必須 | 保留 | 実装差分がないため、本ターンは spec の整合確認を行い、実装完了時に観点別レビューを行う。 |
| 8 成果提示＋コミットゲート | 🔒必須 | 保留 | 本ターンの成果は未承認の設計ドラフト。Gate 3 は実装・品質ゲート後に行う。 |

## ゲート承認状態

- [ ] Gate 1 要件＋Stage 宣言 承認（未承認）
- [ ] Gate 2 spec 承認（Q-1〜Q-8 回答後。未承認）
- [ ] codekb 差分追記済み（N/A: アプリ本体・codekb 実装スナップショットなし）
- [ ] Gate 3 コミット対象 承認（未実施）

## 現在位置

- 現 Stage: 2 design doc 作成（ドラフト完了）
- 次の一手: [questions.md](./questions.md) の Q-1〜Q-8 を確定し、Gate 1 / Gate 2 の承認を得る。

## 実装タスク計画（順序付き）

- [ ] T1 [data] AC-2,AC-6,AC-7,AC-8,AC-9,AC-10,AC-11,AC-12,AC-13 依存:なし — Owner / 業務 Schema / Runtime lock / Background Run / Migration
- [ ] T2 [shared] AC-1,AC-3,AC-4,AC-5,AC-7,AC-8,AC-9,AC-10,AC-11,AC-12,AC-13 依存:T1 — Zod 契約 / Error Envelope / Enum / cursor・progress 型
- [ ] T3 [service] AC-5,AC-6,AC-7,AC-8,AC-9,AC-10,AC-11,AC-12,AC-13 依存:T1,T2 — Access / Owner / Mutation Guard / Background API / Cycle 処理
- [ ] T4 [service] AC-1,AC-2,AC-3,AC-4 依存:T1,T2,T3 — Issue / Cycle / Project / View / Search の Server Functions
- [ ] T5 [ui] AC-1,AC-3,AC-4,AC-5,AC-9,AC-10,AC-11,AC-12,AC-13 依存:T2,T3,T4 — Route / Query / Optimistic UI / Overlay / PWA / Responsive
- [ ] T6 [ui] AC-2,AC-3,AC-4 依存:T4,T5 — Cycle / Project / View の分析・Board・Bulk Journey
- [ ] T7 [data] AC-1,AC-2,AC-3,AC-6,AC-7,AC-8,AC-9,AC-10,AC-11,AC-12,AC-13 依存:T1,T3,T4,T5,T6 — 実 D1 Integration / resilience / performance 検証

## リンク

- 契約（AC はここが正本）: [index.md](./index.md)
- レイヤー: [data.md](./data.md) / [shared.md](./shared.md) / [service.md](./service.md) / [ui.md](./ui.md)
- 未決事項: [questions.md](./questions.md)
