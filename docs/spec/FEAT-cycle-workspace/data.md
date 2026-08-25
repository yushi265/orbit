# FEAT-cycle-workspace: data契約

## 担保AC

- **AC-1**: 本人がCyclesを開くと、Current / Upcoming / Pastを切り替えられ、各タブはOwner scopedなCycleだけを表示し、Cycleがない場合は空状態と次の導線を表示する。
- **AC-2**: Cycle詳細でnameOverride（nullまたはUnicode 1〜100文字）とdescription（0〜2,000文字）を保存でき、成功時は同じCycleの再表示に反映され、同じidempotencyKeyの再送はNo-op、異なるRequestは409になる。Runtime lock中は423で副作用がない。
- **AC-4**: Cycle詳細にIssue総数、Completed数、進捗率、Canceledを除外したEstimate合計を表示し、Canceled Issueは完了率の分母から除外する。Active Cycleの完了操作は既存の繰越処理を呼び出し、処理中は画面をブロックする。
- **AC-6**: Active Cycleの後続Upcoming Cycleが不足している場合、Bootstrap成功時にCycleSettings.futureCount（既定3）まで後続Upcomingを補充し、既存Snapshotへ保存する。Current画面から「次のCycleを開始」でそのUpcomingを開始できる。

## 公開契約 / 境界

- 既存 `Cycle` の `status`, `nameOverride`, `description`, `startsAt`, `endsAt`, `completedAt`を再利用する。
- Cycleは`userId`一致でのみ取得・更新し、Issue集計も同じOwnerのIssueだけを対象にする。
- Metadata更新はMemory StoreでActivity / Outbox / Receiptを記録する。実D1 batch / CASは延期する。
- Metricsは`total`, `completed`, `progressPercent`, `estimateTotal`, `canceled`を返す純粋な集計値とする。

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| Cycle不存在・Owner外 | 404、Cycle / Issue / Activity / Outbox / Receiptを変更しない |
| Runtime lock | 423、全状態不変 |
| 完了CycleのMetadata更新 | 更新は許可するが、Issue割当UIからは対象外にする |

## テストケース

- [デシジョンテーブル] statusがupcoming / active / completedでCycle tabへの分類を確認する。
- [代表値] Cycle metricsが同一OwnerのIssueだけを集計する。
- [状態遷移] metadata update → replay → different request 409、lock 423。
- [代表値] Active Cycleの後続Upcomingが不足している場合、futureCount件まで補充される。
- [境界値] completed / canceled / estimate nullの集計。
