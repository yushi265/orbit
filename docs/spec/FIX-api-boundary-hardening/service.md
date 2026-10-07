# FIX-api-boundary-hardening: service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: `POST /api/v1/issues/:issueId` は `action` が `archive` / `restore` / `trash` のときだけ対応する処理を行い、`action` が未指定・それ以外の値のときは `400 VALIDATION_ERROR`（`fieldErrors.action`）を返して Issue を変更しない。
- **AC-2**: Issue の archive / restore / trash、`POST /api/v1/projects/:projectId`（archive）、`POST /api/v1/cycles/:cycleId`（close）は、`Idempotency-Key` ヘッダーが無いか空のとき `400 VALIDATION_ERROR`（`fieldErrors.idempotencyKey`）を返して対象を変更しない。ヘッダーがあるときは従来どおり処理し、同じキーの再送は同じ結果に収束する。
- **AC-3**: `GET /api/v1/issues` の `due` は `none` / `overdue` / `today` / `upcoming` / `next7`、`order` は `manual` / `priority` / `updated` / `created` / `due_at` / `estimate`、`limit` は 1〜500 の整数だけを受け付け、それ以外は `400 VALIDATION_ERROR`（該当キーの `fieldErrors`）を返す。未指定・空文字は従来どおり既定値（due 絞り込みなし / `manual` / 100）として扱う。
- **AC-4**: JSON Body の実バイト数が 1,000,000 を超えるリクエストは、`content-length` ヘッダーが無い・実際より小さい場合も含めて `400 VALIDATION_ERROR`（「リクエストが大きすぎます。」）を返す。ちょうど 1,000,000 バイトの JSON は受け付ける。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|------|------------|-----------------|-------------------|------|
| 変更 | `POST /api/v1/issues/:issueId?action=` | `action ∈ {archive, restore, trash}` 必須。ヘッダー `Idempotency-Key` 必須（非空文字列）。成功 200 `{ issue }` | 既存（Owner scope・X-Requested-With） | Issue lifecycle |
| 変更 | `POST /api/v1/projects/:projectId` | ヘッダー `Idempotency-Key` 必須。成功 200 `{ project }` | 既存 | Project archive |
| 変更 | `POST /api/v1/cycles/:cycleId` | ヘッダー `Idempotency-Key` 必須。成功 200 `{ cycle }` | 既存 | Cycle close |
| 変更 | `GET /api/v1/issues` | `due?: none\|overdue\|today\|upcoming\|next7`、`order?: manual\|priority\|updated\|created\|due_at\|estimate`、`limit?: 1..500 の整数`。空文字は未指定扱い | 既存 | Issue 一覧 |
| 変更 | 全 JSON Body の Mutation（`parseBody`） | 実バイト数 ≤ 1,000,000 | 既存 | 共通 |
| 追加 | `issueListParamsSchema`（`src/shared/contracts/issues.ts`） | `z.object({ due: issueDueSchema.optional(), order: issueOrderSchema.optional(), limit: z.coerce.number().int().min(1).max(500).optional() })` | — | クエリ検証の正本 |

エラー応答（既存 Envelope）:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "入力内容を確認してください。", "fieldErrors": { "action": ["actionはarchive・restore・trashのいずれかを指定してください。"] }, "requestId": "req_..." } }
```

- `fieldErrors.idempotencyKey`: `["Idempotency-Keyを指定してください。"]`（既存の Issue note 削除等と同じ文言）
- `fieldErrors.due` / `order` / `limit`: Zod の `flatten().fieldErrors` をそのまま返す（`parseContract` 既存挙動）
- Body 超過: `message: "リクエストが大きすぎます。"`、`fieldErrors` なし（既存文言）

## このレイヤーが依存する下位の契約（呼び出す相手）

- `OrbitStore.archiveIssue / restoreIssue / trashIssue / archiveProject / closeCycle / listIssues`（変更なし）

## 実装配置

- `src/server/http.ts`: `keyFromRequest` → `requireIdempotencyKey(request): string`（欠落・空で `validationError`）。`parseBody` をストリーム読み取り＋バイト計数に変更（`content-length` の事前チェックは早期拒否として残す）。
- `src/server/api.ts`: `postIssueAction(request, issueId)` を追加して action を振り分け、未知は `validationError({ action: [...] })`。5 endpoint で `requireIdempotencyKey` を使う。同文言でインライン検査していた `deleteIssueNote` / `deleteIssueRelation` / `deleteLabel` も同関数へ置換（挙動不変）。`parseQuery` で `issueListParamsSchema` を通す。
- `src/routes/api/v1/issues/$issueId.ts`: `POST` を `postIssueAction` へ委譲。
- `src/shared/contracts/issues.ts`: `issueListParamsSchema` を追加・export。

## 異常系挙動

| シナリオ | 本レイヤーの挙動 |
|---|---|
| action 未指定 / 未知 | 400 VALIDATION_ERROR `fieldErrors.action`。store 呼び出し前に拒否し、Snapshot 保存なし |
| Idempotency-Key 欠落 / 空 | 400 VALIDATION_ERROR `fieldErrors.idempotencyKey`。store 呼び出し前に拒否 |
| due / order / limit 不正 | 400 VALIDATION_ERROR、該当キーの fieldErrors。`/api/v1/search` も filter 解析を共有するため `due` 不正は 400 |
| Body > 1,000,000 bytes | 読み取りを打ち切り 400 VALIDATION_ERROR「リクエストが大きすぎます。」 |
| Body が JSON でない / オブジェクトでない | 既存どおり 400「JSON形式のリクエストを指定してください。」 |

## テストケース（技法注記付き）

`src/server/api-boundary-hardening.test.ts` に置く。

AC-1:
- [同値分割] `action=archive` / `restore` / `trash` → 200、Issue の archivedAt / deletedAt が期待どおり変わる
- [同値分割] `action=delete`（未知）→ 400、`fieldErrors.action`、Issue 不変
- [境界値] `action` 未指定・`action=`（空）→ 400、Issue 不変
- [同値分割] `action=ARCHIVE`（大文字）→ 400

AC-2（デシジョンテーブル: endpoint 5 種 × キー有無）:
- [デシジョンテーブル] archive / restore / trash / project archive / cycle close × Idempotency-Key なし → 400 `fieldErrors.idempotencyKey`、対象不変
- [境界値] Idempotency-Key が空文字 → 400
- [状態遷移] キーあり → 200、同じキーで再送 → 同じ結果（200・同 version）

AC-3:
- [同値分割] `due` 有効値 5 種それぞれ → 200 / `due=later` → 400 `fieldErrors.due`
- [同値分割] `order` 有効値 6 種それぞれ → 200 / `order=random` → 400 `fieldErrors.order`
- [境界値] `limit=1` / `limit=500` → 200（件数が limit 以下）、`limit=0` / `limit=501` / `limit=1.5` / `limit=abc` → 400 `fieldErrors.limit`
- [境界値] `due=` / `order=` / `limit=` / 未指定 → 200、既定（limit 100・manual）
- [代表値] `GET /api/v1/search?due=later` → 400

AC-4:
- [境界値] ちょうど 1,000,000 バイトの JSON（content-length なし）→ 受理
- [境界値] 1,000,001 バイト（content-length なし）→ 400「リクエストが大きすぎます。」
- [境界値] 1,000,001 バイトで content-length を 10 と偽装 → 400
- [代表値] content-length が 1,000,001 → 本文を読まずに 400（既存の早期拒否）
- [代表値] Issue 作成 API に 1,000,001 バイト（content-length なし）→ 400、Issue 件数不変
