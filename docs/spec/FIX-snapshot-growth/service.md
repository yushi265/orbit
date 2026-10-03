# FIX-snapshot-growth: service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: 新しく記録するMutation Receiptの`expiresAt`は作成時刻+24時間であり、D1 Sessionの保存時に、作成から24時間を超えた（または`expiresAt`を過ぎた）同OwnerのReceiptを保存前に削除する。ちょうど24時間のReceiptは残り、24時間+1msのReceiptは削除される。
- **AC-2**: 削除前のReceiptは従来どおり同じ`idempotencyKey`の再送に保存済み応答を返し、異なる内容には409 `IDEMPOTENCY_KEY_REUSED`を返す。Handlerが失敗したリクエストと保存を伴わないGETでは、Receiptを削除したSnapshotを保存しない。
- **AC-3**: Receiptの自動削除後も、Snapshotの形状・`requestHash`形式・Receipt `response`は変わらず、rollback互換codecの往復（新設定の復元と旧版変更の優先）が成立する。
- **AC-4**: Issueの並び替えが成功したとき、位置がずれた他のIssueの`position` / `version` / `updatedAt`は従来どおり更新し、ActivityとOutboxは移動した対象Issueの1件ずつだけを記録する。
- **AC-5**: 並び替えの検証失敗・version競合・Runtime lock中は、Issueの`position` / `version`、Activity、Outbox、Receiptを変更しない。同じ`idempotencyKey`の再送は初回応答を返し、Activity / Outboxを増やさない。
- **AC-6**: IssueをPurgeすると、同OwnerでそのIssueを`entityId`とするActivityも削除し、他のIssue・他OwnerのActivityは残る。

## このレイヤーが公開する契約（外部インターフェース）

HTTP API・共有Zod契約・Snapshot形状の変更は無い。内部契約のみ。

| 操作 | 名前 | 入出力・制約 | 用途 |
|---|---|---|---|
| 追加 | 定数 `RECEIPT_TTL = DAY`（`src/server/store.ts`） | 24時間（ms）。`THIRTY_DAYS`はTrash Purge用に残す | Receipt保持期間 |
| 変更 | `recordReceipt` | `expiresAt = clock() + RECEIPT_TTL`。他フィールド・`requestHash`・`response`は不変 | AC-1 |
| 追加 | `OrbitStore.pruneExpiredReceipts(userId: string): number` | `receipt.userId === userId` かつ `Math.min(receipt.expiresAt, receipt.createdAt + RECEIPT_TTL) < clock()` のReceiptをMapから削除し、削除件数を返す。他Ownerは触らない | AC-1 |
| 変更 | D1 Sessionの`persist()`（`src/server/store-session.ts`） | `persisted`判定の後、`store.toSnapshot()`の直前に`store.pruneExpiredReceipts(userId)`を1回呼ぶ。以降の差分判定・encode・CASは既存のまま | AC-1, AC-2 |
| 変更 | `reorderIssue` | 全対象Issueの`position` / `version` / `updatedAt`更新は既存のまま。`recordActivity` / `recordOutbox`は対象Issue（`target`）だけに1回ずつ呼ぶ。キー形式は既存のまま: Activity `mutationKey = ${idempotencyKey}:${target.id}`、action `reordered`、before/after `{ version, position }`。Outbox type `issue.reordered`、`dedupeKey = issue.reordered:${target.id}:${target.version}`、payload `{ issueId, position, version }`。変更が1件も無い場合（既存のno-op分岐）は従来どおりReceiptだけ記録する | AC-4, AC-5 |
| 変更 | `purgeIssue` | 既存の依存データ削除に加え、`activity.userId === userId && activity.entityId === issueId`のActivityを配列から削除する | AC-6 |

- `runPurge`のReceipt削除条件（`expiresAt < now`）、`checkReceipt`、Memory Storeの経路は変更しない。
- `needsInitialPersist`の判定は変更しない（期限切れReceiptの存在だけでGETを書き込みにしない）。

## 実装配置

- `src/server/store.ts`: `RECEIPT_TTL`、`recordReceipt`、`pruneExpiredReceipts`、`reorderIssue`、`purgeIssue`
- `src/server/store-session.ts`: `persist()`での呼び出し
- テスト: `src/server/snapshot-growth.test.ts`（新規）。Fake D1は3件目の利用になったため`src/server/store-session.test-fixtures.ts`へ抽出し、`store-session.test.ts`と共用する。既存テストの期待値更新は`api-cycle-reorder.test.ts`・`review-followup-service.test.ts`・`maintenance-integrity.test.ts`など、30日ReceiptとずれたIssueのActivity件数を前提にした箇所に限る
- docs: `docs/requirements/02-functional.md`（Receipt保持）、`docs/spec/CYC-14-cycle-reorder/service.md`手順5、`docs/ai-dlc/codekb/shared.md`

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| 24時間以内に同じキー・同じ内容を再送 | 保存済み応答を返す。Activity / Outboxを増やさない |
| 24時間以内に同じキー・異なる内容 | 409 `IDEMPOTENCY_KEY_REUSED` |
| 期限切れだが未削除のキーを再送（同一リクエスト内で削除前） | 既存どおり保存済み応答を返す（要件: 物理削除までキーを予約） |
| Receipt削除後に同じキーを送信 | 新しいMutationとして処理する |
| Handlerが4xx / 5xx・例外 | `persist`を呼ばないためSnapshotを保存しない |
| D1 Version競合 | 既存の409 `D1_WRITE_CONFLICT`。削除済み状態で上書きしない |
| 並び替えの404 / 409 / 423 | position・version・Activity・Outbox・Receiptを変更しない |

## テストケース（技法注記付き）

- [境界値] `pruneExpiredReceipts`: 作成から24時間ちょうどは残る／24時間+1msは削除／24時間-1msは残る。
- [同値分割] 旧形式Receipt（`expiresAt = createdAt + 30日`）は作成から24時間超で削除される。`expiresAt`が`createdAt + 24h`より早いReceiptは`expiresAt`超過で削除される。
- [同値分割] 他OwnerのReceiptは期限切れでも削除しない。戻り値は削除件数。
- [代表値] 新規Mutation後のReceiptは`expiresAt - createdAt === 24時間`。
- [状態遷移] 記録→24時間以内の再送は同じ応答→期限超過＋`pruneExpiredReceipts`→同じキーが新しいMutationとして処理される。
- [同値分割] 24時間以内に同じキー・異なる内容は409 `IDEMPOTENCY_KEY_REUSED`。
- [レイヤー内結合] D1 Session: 期限切れReceiptを含むSnapshot＋Mutation成功→保存されたSnapshotに期限切れReceiptが無く、新Receiptがある。
- [レイヤー内結合] D1 Session: Handler失敗では保存されず、D1上のReceiptは残る。保存を伴わないGETでは`needsInitialPersist`がfalseのままで、D1のversionが進まない。
- [レイヤー内結合] D1 Session: rollback互換metaを持つSnapshot（新並び順のProject表示設定＋関連Receipt）で、関連Receiptが期限切れ削除された後も再読込で新設定が復元される。保存JSONのReceiptは`requestHash`が`operation\n`で始まり`response`を持つ。
- [デシジョンテーブル] `reorderIssue`: スコープ（全体 / Cycle List / Cycle Board）× 移動（複数Issueがずれる / no-op）。ずれる場合はActivity +1・Outbox +1で、どちらも対象Issueのもの。ずれた他Issueは`position` / `version`が更新されている。no-opはActivity・Outbox増分0でReceiptのみ。
- [同値分割] 並び替えの失敗: 不正参照404・version競合409・Runtime lock 423で、position・version・Activity・Outbox・Receiptが不変。
- [代表値] 並び替えの同じキー再送: 初回応答を返し、Activity・Outboxが増えない。
- [同値分割] Purge: 30日超のTrash IssueをMaintenance RunでPurge→そのIssueのActivityが0件。別IssueのActivityと他OwnerのActivity（同じ`entityId`文字列を持つ場合を含む）は残る。
