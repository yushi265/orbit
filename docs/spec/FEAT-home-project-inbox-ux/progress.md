# FEAT-home-project-inbox-ux 進行状態（progress）

> **揮発物**。AI-DLCの中断・再開用。機能完了時に除去する。

## Stage 宣言（Gate 1で承認）

**リスクティア**: Tier 1（判定根拠: 別端末同期のためのSnapshot公開データとProject PATCH共有契約、およびProject detail routing / UI契約を変更する）。

**Gate 2 委任**: なし（デフォルト。2026-08-30にユーザー承認済み）。

| Stage | 区分 | 実行/スキップ | 理由 |
|---|---|---|---|
| 0+1 Stage宣言＋要件整理 | 🔒必須 | 実行 | Home、Project detail、完了表示、別端末同期、Inbox UX、近日期限7日を確定済み |
| 2 spec作成 | 🔓条件付き | 実行 | Tier 1かつSnapshot / API / routing契約を確定するため |
| 3+4 TDD（RED→GREEN→REFACTOR） | 🔒必須 | 実行 | UI・共有契約・Store・APIの挙動変更があるため |
| 5 静的解析・フォーマッター | 🔒必須 | 実行 | 常時 |
| 6 セルフレビュー | 🔒必須 | 実行 | 常時 |
| 8 成果提示＋コミットゲート | 🔒必須 | 実行 | 常時。コミット前に対象ファイル承認を得る |

## ゲート承認状態

- [x] Gate 1 要件＋Stage宣言 承認（2026-08-29、ユーザーの「それでいいので進めてください」）
- [x] Gate 2 spec 承認（2026-08-30、ユーザーの「承認」）
- [x] codekb差分追記済み（2026-08-30）
- [ ] Gate 3 コミット対象 承認

## 現在位置

- 現Stage: 8 成果提示＋コミットゲート
- 次の一手: Gate 3としてコミット対象の承認を得る

## 品質ゲート（Stage 5）

- `./node_modules/.bin/tsc --noEmit`: ✅
- `./node_modules/.bin/vitest run`: ✅ 71 files / 390 tests
- `./node_modules/.bin/oxlint .`: ✅
- `./node_modules/.bin/oxfmt --check ...`: ✅
- `WRANGLER_LOG_PATH=/private/tmp/orbit-wrangler.log ./node_modules/.bin/vite build`: ✅ client / ssr
- 初回RED実行は依存再構成中の`@rollup/rollup-darwin-x64`欠落で実行不能だったため、復旧後に対象テストを実行してgreenを確認した。
- 3観点self-review（code / spec-conformance / test-quality）を実施し、Must / Shouldの実装上の未解決指摘はなし。実ブラウザの実viewport / keyboard操作は環境制約により未確認のため、UI構造・jsdom操作・responsive CSS検査・production buildで代替検証した。

## 実装タスク計画（順序付き）

- [x] T1 [shared] AC-3,AC-4 依存:なし — Project表示設定のZod契約・初期値・公開型
- [x] T2 [data] AC-3,AC-4 依存:T1 — Snapshot / Memory StoreのProject表示設定永続化
- [x] T3 [service] AC-3,AC-4 依存:T1,T2 — Bootstrap投影とProject PATCH display preference branch
- [x] T4 [ui] AC-2,AC-3,AC-5 依存:T1,T3 — Issue workspace共通化とProject専用詳細
- [x] T5 [ui] AC-1,AC-5 依存:T4 — Home actionable dashboard
- [x] T6 [ui] AC-4,AC-5 依存:T1,T3 — Inbox guidance UX
- [x] T7 [ui] AC-1,AC-2,AC-3,AC-4,AC-5 依存:T4,T5,T6 — レイヤー結合・responsive・accessibility検証

## リンク

- 契約: [index.md](./index.md)
- レイヤー: [shared.md](./shared.md) / [data.md](./data.md) / [service.md](./service.md) / [ui.md](./ui.md)
