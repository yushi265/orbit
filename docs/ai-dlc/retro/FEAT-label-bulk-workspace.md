# FEAT-label-bulk-workspace AI-DLC 振り返り学習ノート

## メタ

- ticket: FEAT-label-bulk-workspace
- 機能概要: Label管理とIssue一括操作を実装する。
- Stage宣言の結果: Tier 1 / spec / TDD / 品質ゲート / self-reviewを実行。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-24 / 2026-08-24

## 各Stageの気づき

| Stage | 気づき |
|---|---|
| 1 要件整理＋Stage宣言 | Issueには既にlabelIdsとlabel filterがあるが、Memory Store / API / UIは未接続だった。 |
| 2 spec作成 | D1 schemaは存在するため、Preview Memory Storeを正本にし、D1 adapterはRelease hardeningへ延期した。 |
| 3+4 TDD | Label schema → Store atomicity → API → UIの順で、shared / service / browser smokeの境界を分離できた。 |
| 5 品質ゲート | 16 files / 93 tests、typecheck / lint / format / build / refereeを通過した。 |
| 6 self-review | Bulk busy選択固定、途中rollback、Owner外参照、Label lock、responsive CSSの指摘を反映した。 |
| 8 成果提示 | mainへコミットし、Inbox / Notification機能へ引き継ぐ。 |

## 振り返り（KPT）

### Keep

- 既存IssueQuery / Owner / Runtime lock / Receiptを再利用する。

### Problem

- [scope] Bulkは複数Issueの部分成功を避けるため、Memory Storeのsnapshot rollbackが必要になる。
- [test] UI異常系は実PlaywrightをRelease hardeningへ延期するため、API / StoreのErrorEnvelopeとlocal browser smokeの責務境界を明記する必要がある。

### Try

- Bulkの参照先検証とActivity / Outbox / Receiptの増分を先にテストで固定する。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| Label参照とBulk patchのOwner境界をshared / data specで固定する | create-spec | 実施中 |
| Bulk busy時の選択固定とidempotency key保持をUI実装の必須観点にする | self-review | 完了 |
