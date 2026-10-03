# FIX-snapshot-growth: Snapshot肥大化の延命

## 概要

Owner単位のD1 Snapshot（`orbit_store_snapshots.state_json`）は、Mutationのたびに Receipt・Activity・Outbox が増え続け、D1の行上限（2MB）へ約1,000回の更新で到達する見込みがある（2026-10-03 監査・ローカルNode計測。実D1では未検証）。到達すると全Mutationが保存できなくなる。Snapshotの形を変えずに増加量を減らし、到達までの余裕を広げる。

## 対象範囲

- 対象レイヤー: [service](./service.md)
- Mutation Receiptの保持期間を30日から24時間へ短縮し、D1保存時に期限切れReceiptを自動削除する
- Issue並び替えのActivity / Outboxを、移動した対象Issue 1件分だけにする
- IssueのPurge時に、そのIssueのActivityも削除する
- 要件定義（[02-functional.md](../../requirements/02-functional.md) のReceipt保持）と [CYC-14](../CYC-14-cycle-reorder/service.md) の記録規定を同じPRで更新する

## 対象外

- 追記系データ（activities / outbox / receipts / cycleHistory / runs）の正規化テーブル移行（根本対策・別ボルト）
- `requestHash`のハッシュ化、Receipt `response`の縮小（[FIX-rollback-compatibility](../FIX-rollback-compatibility/service.md) のcodecが現形式を解析するため）
- `sent` Outboxの削除（下記「判断根拠」。Cron導入ボルトで扱う）
- Activityの件数上限・古い履歴の削除（Issue詳細に表示するユーザーデータのため）
- Cron Trigger、クライアント、API契約、SQL Migration、Snapshotの形状

## ユニット計画

単一ユニット。

## 受け入れ基準（AC）

- [x] **AC-1**: 新しく記録するMutation Receiptの`expiresAt`は作成時刻+24時間であり、D1 Sessionの保存時に、作成から24時間を超えた（または`expiresAt`を過ぎた）同OwnerのReceiptを保存前に削除する。ちょうど24時間のReceiptは残り、24時間+1msのReceiptは削除される。
- [x] **AC-2**: 削除前のReceiptは従来どおり同じ`idempotencyKey`の再送に保存済み応答を返し、異なる内容には409 `IDEMPOTENCY_KEY_REUSED`を返す。Handlerが失敗したリクエストと保存を伴わないGETでは、Receiptを削除したSnapshotを保存しない。
- [x] **AC-3**: Receiptの自動削除後も、Snapshotの形状・`requestHash`形式・Receipt `response`は変わらず、rollback互換codecの往復（新設定の復元と旧版変更の優先）が成立する。
- [x] **AC-4**: Issueの並び替えが成功したとき、位置がずれた他のIssueの`position` / `version` / `updatedAt`は従来どおり更新し、ActivityとOutboxは移動した対象Issueの1件ずつだけを記録する。
- [x] **AC-5**: 並び替えの検証失敗・version競合・Runtime lock中は、Issueの`position` / `version`、Activity、Outbox、Receiptを変更しない。同じ`idempotencyKey`の再送は初回応答を返し、Activity / Outboxを増やさない。
- [x] **AC-6**: IssueをPurgeすると、同OwnerでそのIssueを`entityId`とするActivityも削除し、他のIssue・他OwnerのActivityは残る。

## アーキテクチャ / レイヤー間フロー

`withOwner` → Handler成功 → `session.persist()` → `store.pruneExpiredReceipts(userId)` → `store.toSnapshot()` → 既存の差分判定 → `encodeStoreSnapshot` → D1 Version CAS。Memory Store（`pnpm dev`）は`persist`を持たないため自動削除は行わない。公開Zod契約・SQL schema・`toSnapshot` / `fromSnapshot`の形状は変更しない。

## エラー・ログ方針（横断サマリ）

| シナリオ | service | data |
|---|---|---|
| 24時間を超えたキーの再送 | Receipt削除後は新しいMutationとして処理する | 削除済みSnapshotをCAS保存 |
| Handler 4xx / 5xx | 既存どおり保存しない（削除も保存されない） | writeしない |
| CAS競合 | 既存の409 `D1_WRITE_CONFLICT` | versionで拒否 |

新しいログ・ErrorCodeは追加しない。

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | `pruneExpiredReceipts`の境界値 | D1 Session `persist`で削除後のSnapshotが保存される |
| AC-2 | 削除前の再送・Key再利用 | Handler失敗 / GETで保存しない |
| AC-3 | — | Session経由でcompat codec往復 |
| AC-4 | — | `reorderIssue`（全体 / Cycleスコープ）のActivity・Outbox件数 |
| AC-5 | — | 失敗3種と再送で件数不変 |
| AC-6 | — | Maintenance RunのPurgeでActivity削除・他は保持 |

テストケースの詳細は [service.md](./service.md)。

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `OrbitStore.receipts` Map、`clock`、`recordReceipt` / `checkReceipt`、D1 Sessionの`persist`と差分判定、`runPurge`（`expiresAt < now`で削除。変更しない）。
- 差分: `THIRTY_DAYS`はTrash Purgeの閾値として残し、Receipt用に`RECEIPT_TTL`を分ける。
- 衝突と解消:
  - [02-functional.md](../../requirements/02-functional.md) のReceipt保持（30日・手動Runで削除）→ Gate 1（2026-10-03）で24時間・保存時自動削除へ変更を合意。同PRで更新する。
  - [CYC-14 service.md](../CYC-14-cycle-reorder/service.md) 手順5「変更対象IssueのActivity、Outboxを記録」→ 対象Issueのみへ変更。同PRで更新する。
  - [FIX-rollback-compatibility](../FIX-rollback-compatibility/service.md): codecは既知Receiptの削除を「変更」と見なさない契約のため両立する。旧版（15eb0eb）稼働中は旧コードが自動削除しないので、旧版での明示保存を示すReceiptは新版が次に読み込む時点（decode）まで残る。
- codekb照合: 「Receipt purgeは`expiresAt < now`」「失敗MutationはSnapshotを保存しない」「Runの失敗Chunkはdeep Snapshotで復元」を確認済み。自動削除は`persist`内のため、いずれとも干渉しない。

## 判断根拠 / 未決事項

- 採用: 形を変えない延命策（Gate 1で選択）。Receiptは監査計測でSnapshotの約4割を占め、期間短縮で上限が「24時間分」に収まる。再送は実運用で数秒〜数分以内に起きるため24時間で足りる。
- 削除条件を`min(expiresAt, createdAt + 24h) < now`とする理由: 既存の30日Receiptも初回保存で整理するため。
- 削除を`recordReceipt`内ではなく`persist`内に置く理由: Bulkの失敗rollbackやRunのChunk復元と干渉せず、「失敗時は保存しない」が自然に成り立つため。
- 却下: `requestHash`のSHA-256化・`response`縮小。compat codecが`operation＋改行＋JSON`と`response.id`を解析しており、旧版互換の再設計が必要になる。
- 範囲から外した: `sent` Outboxの削除。Outboxの重複防止は`dedupeKey`の履歴照合で行っており（例: `cycle.completed:<cycleId>`）、削除すると要件CYC-12「重複Outboxが発生しない」の二重の守りが1つ減る。また`pending`→`sent`は手動Runでしか進まないため、今回削除しても効果がほぼ無い。Cron導入ボルトでOutbox処理と合わせて設計する。Gate 1で提示した案からの変更点。
- 受け入れるリスク: 24時間を超えてから同じキーを再送すると二重実行になる。クライアントのキーは操作ごとに生成され、再試行UIは数秒で消えるため実害は小さいと判断。
- 限界: ActivityとOutboxは引き続き増える（1更新あたり約500バイト）。2MB到達は数千回の更新まで延びるが、根本対策は正規化移行。
- 本番Snapshotの現在サイズは未計測（権限上、このボルトでは実行していない）。
- 未決事項なし。
