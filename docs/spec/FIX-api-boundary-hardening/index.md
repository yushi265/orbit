# FIX-api-boundary-hardening: API境界の入力検証強化

## 概要

リポジトリ監査（P1）で見つかった service 境界の入力検証漏れ4件を塞ぐ。未知の Issue action が archive として通ること、冪等性キーが無いとサーバーが黙ってランダム生成すること、Issue一覧クエリの `due` / `order` / `limit` が検証されないこと、Body の 1MB 上限が `content-length` ヘッダーしか見ないことの4点。

## 対象範囲

- 対象レイヤー: service のみ（[service.md](./service.md)）。UI は既に正しい値を送っているため変更しない。
- 対象ドメイン: issues（action / 一覧クエリ）、projects（archive）、cycles（close）、横断の HTTP 境界（Body 読み取り）
- 対象外（やらないこと）:
  - 既に Idempotency-Key を必須化している endpoint のうち、文言が異なるもの（`deleteView`「冪等性キーを指定してください。」、`deleteWorkflowState`「idempotencyKeyが必要です。」）の文言統一。文言が同一の `deleteIssueNote` / `deleteIssueRelation` / `deleteLabel` は挙動を変えずに `requireIdempotencyKey` へ置換する
  - `GET /api/v1/search` の `limit` 検証（一覧の `filter` 解析を共有するため `due` 検証だけは同じく効く）
  - エラーコードの追加（`413` 等）。既存の `400 VALIDATION_ERROR` を使う
  - UI・api-client の変更

## ユニット計画

単一ユニット。

## 受け入れ基準（AC）

- [ ] **AC-1**: `POST /api/v1/issues/:issueId` は `action` が `archive` / `restore` / `trash` のときだけ対応する処理を行い、`action` が未指定・それ以外の値のときは `400 VALIDATION_ERROR`（`fieldErrors.action`）を返して Issue を変更しない。
- [ ] **AC-2**: Issue の archive / restore / trash、`POST /api/v1/projects/:projectId`（archive）、`POST /api/v1/cycles/:cycleId`（close）は、`Idempotency-Key` ヘッダーが無いか空のとき `400 VALIDATION_ERROR`（`fieldErrors.idempotencyKey`）を返して対象を変更しない。ヘッダーがあるときは従来どおり処理し、同じキーの再送は同じ結果に収束する。
- [ ] **AC-3**: `GET /api/v1/issues` の `due` は `none` / `overdue` / `today` / `upcoming` / `next7`、`order` は `manual` / `priority` / `updated` / `created` / `due_at` / `estimate`、`limit` は 1〜500 の整数だけを受け付け、それ以外は `400 VALIDATION_ERROR`（該当キーの `fieldErrors`）を返す。未指定・空文字は従来どおり既定値（due 絞り込みなし / `manual` / 100）として扱う。
- [ ] **AC-4**: JSON Body の実バイト数が 1,000,000 を超えるリクエストは、`content-length` ヘッダーが無い・実際より小さい場合も含めて `400 VALIDATION_ERROR`（「リクエストが大きすぎます。」）を返す。ちょうど 1,000,000 バイトの JSON は受け付ける。

## アーキテクチャ / レイヤー間フロー

```
Route (src/routes/api/v1/**)  ──薄い委譲──▶  src/server/api.ts  ──▶  src/server/http.ts（parseBody / requireIdempotencyKey）
                                                     └─ parseQuery: shared/contracts の issueListParamsSchema で検証
```

Issue action の振り分けは Route ファイルから `api.ts` の `postIssueAction` へ移し、レイヤー内結合テストで検証できるようにする。

## エラー・ログ方針（横断サマリ）

| シナリオ | service | 表示層の挙動 |
|---|---|---|
| 未知・未指定の action | 400 VALIDATION_ERROR `fieldErrors.action` | UI は常に正しい action を送るため到達しない |
| Idempotency-Key 欠落 | 400 VALIDATION_ERROR `fieldErrors.idempotencyKey` | UI は常にキーを送るため到達しない |
| 不正な due / order / limit | 400 VALIDATION_ERROR `fieldErrors.<key>` | UI は該当クエリを送らないため到達しない |
| Body 1MB 超過 | 400 VALIDATION_ERROR「リクエストが大きすぎます。」 | 既存のエラートースト |

いずれも Snapshot は保存しない（`withOwner` は失敗 Response で persist しない既存挙動）。ログは既存どおり（ServiceError は console 出力なし）。

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|----|------|--------------|
| AC-1 | — | `src/server/api-boundary-hardening.test.ts`（api 関数を Request で呼ぶ） |
| AC-2 | — | 同上 |
| AC-3 | — | 同上 |
| AC-4 | `src/server/api-boundary-hardening.test.ts`（`parseBody` 直接呼び出し） | 同ファイル（Issue 作成 API 経由で 1 ケース） |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `validationError`（`src/server/errors.ts`）、`parseContract`（`api.ts`）、`withOwner` の非 persist 挙動、`issueFilterSchema` 内の due / order enum。
- 差分: `keyFromRequest`（ランダム生成フォールバック）を廃止し `requireIdempotencyKey` に置換。同じ文言でインライン検査していた delete 系 3 endpoint も同関数へ寄せる（Rule of Three、挙動不変）。
- 衝突: `GET /issues` で `limit>500` は従来 500 に丸め、`limit=abc` は 100 にフォールバックしていた。本 spec で 400 へ変わる（Gate 1 で合意済みの挙動変更）。UI はこれらを送らない（`OrbitApp.tsx` の一覧取得は `scope` だけ）。

## 実装に効く制約

- 共有契約の追加は `src/shared/contracts/issues.ts` に置く（wire 契約の正本）。
- エラー Envelope は既存 `errorResponse` 形式のまま。

## 判断根拠 / 未決事項

- action 未指定も 400（Gate 1 決定）。後方互換で archive を残す案は、タイポで破壊的操作が通るリスクが残るため却下。
- 冪等性キーは必須化（Gate 1 決定）。delete 系と揃え、サーバー生成フォールバックは冪等性が黙って失われるため廃止。
- クエリ不正値は 400（Gate 1 決定）。黙って既定値へ戻す案は、呼び出し側が誤りに気付けないため却下。
- Body 上限はストリームを読みながら数える。全文を読んでから長さを測る案はメモリ上限まで読んでしまうため却下。エラーコードは契約を変えないため既存の 400 を維持。
- 未決事項: なし。
