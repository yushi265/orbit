# FEAT-external-api-token 進行状態（progress）

> 揮発物。Gate 3 承認後・merge 前に除去する。

## Stage 宣言（Gate 1 で承認）

> **リスクティア**: Tier 1（判定根拠: Cloudflare Accessの認証/認可に影響する変更。`src/server/auth.ts`が tier-triggers の auth-boundary に該当）。
> **Gate 2 委任**: なし（2026-11-03 Gate 1でB1を選択）

| Stage | 区分 | 実行/スキップ | 理由 |
|-------|------|--------------|------|
| 0+1 Stage 宣言＋要件整理 | 🔒必須 | 実行 | 常時 |
| 2 spec 作成 | 🔓条件付き | 実行 | Tier 1 は必須 |
| 3+4 TDD（RED→GREEN→REFACTOR） | 🔒必須 | 実行 | 常時 |
| 5 静的解析・フォーマッター | 🔒必須 | 実行 | 常時 |
| 6 セルフレビュー | 🔒必須 | 実行 | 常時 |
| 8 成果提示＋コミットゲート | 🔒必須 | 実行 | 常時 |

## ゲート承認状態

- [x] Gate 1 要件＋Stage 宣言 承認（2026-11-03、A1=全API許可・B1=Gate 2非委任）
- [ ] Gate 2 spec 承認
- [ ] codekb 差分追記済み
- [ ] Gate 3 コミット対象 承認

## 現在位置

- 現 Stage: 2 spec 作成（Gate 2 承認待ち）
- 次の一手: Gate 2 承認後、T1 のテストを追加して RED を確認する

## 実装タスク計画（順序付き）

- [ ] T1 [service] AC-1,AC-2,AC-3,AC-4 依存:なし — resolveOwner の Service Token 分岐
- [ ] T2 [service] AC-5 依存:T1 — withOwner 経由の Issue 作成結合テスト
- [ ] T3 [infra] AC-6 依存:T1 — docs/external-api.md と deployment.md

## 学習メモ

## リンク

- 契約: [index.md](./index.md)
- レイヤー: [service.md](./service.md)
