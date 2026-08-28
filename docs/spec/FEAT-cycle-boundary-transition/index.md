# FEAT-cycle-boundary-transition: Cycle境界の自動遷移

## 概要

Settingsから起動するMaintenance Runの`cycle_transition` Stepで、期限到来したActive Cycleの完了・Issue繰越と、開始日時を迎えたUpcoming CycleのActive化を一貫して処理する。
Cooldown中はActive Cycleを作らず、次回開始時刻を画面へ示す。

## 対象範囲

- 対象レイヤー: data / service / ui
  - [data.md](./data.md)
  - [service.md](./service.md)
  - [ui.md](./ui.md)
- 対象ドメイン: cycles / background / owner-scoped snapshot
- 対象外（やらないこと）:
  - 自動Scheduler、Cron、Queue、常駐Workerの導入
  - CycleSettingsの新規項目、個別日付編集、Graph / 日別Snapshot
  - 既存の手動「次のCycleを開始」契約の変更
  - D1正規化Repositoryや新規Migration

## ユニット計画

単一ユニット（Maintenance RunのCycle境界遷移）。既存の`closeCycle`、CycleSettings、Timezone計算、RunのLease / lock / Snapshotを再利用する。

## 受け入れ基準（AC）

- [x] **AC-1**: Maintenance Runの`cycle_transition` Stepが、`endsAt <= now`のOwner scopedなActive Cycleを既存の完了・繰越処理へ渡し、Unstarted / Startedだけを次Cycleへ移動し、Backlog / Completed / Canceledは元Cycleへ残す。次Cycleは既存行を再利用し、不足時だけ1件生成する。
- [x] **AC-2**: Active Cycleがなく、次のUpcoming Cycleの`startsAt <= now`になった場合、対象Upcomingだけを保存済みの`startsAt` / `endsAt`のままActiveへ遷移する。Cooldown中（次の`startsAt > now`）はActive Cycleを作らず、Upcomingを変更しない。
- [x] **AC-3**: 同じRunの`cycle_transition`再送・同時相当の再実行・Lease復旧後の再開では、Cycle状態、Issue繰越、Cycle履歴、Cycle Outboxを重複させず、Owner外のCycleへ副作用を発生させない。Run自身の有効なlock contextだけが処理を通過する。
- [x] **AC-4**: Current画面でActive Cycleがない場合、Upcoming Cycleがあれば次回開始日時とUpcomingへの導線を表示し、Cooldown状態を「Active Cycleなし」とテキストで示す。390pxで横overflowを出さず、既存の開始・完了操作を壊さない。

## アーキテクチャ / レイヤー間フロー

```text
Settings / Maintenance Run
  └─ POST /api/v1/background-runs/:runId/continue
       └─ OrbitStore.runCycleTransition(userId, runId)
            ├─ expired Active → closeCycle(runId)
            │                    └─ rollover / history / outbox
            └─ due Upcoming → scheduled activation
                                 └─ activity / outbox
                 ↓
              owner-scoped Snapshot persist

Cycles UI ← Bootstrap cycles (Active or Upcoming startAt)
```

## エラー・ログ方針（横断サマリ）

| シナリオ | data | service | 表示層の挙動 |
|---|---|---|---|
| 期限前Active / Cooldown中 | 状態を変更しない | Run Stepは成功し、次回開始待ちとして返す | Activeなし・次回開始日時を表示 |
| 期限到来Active | Owner scopedに1回だけ完了・繰越 | 有効Run context以外は423 | Run進捗を更新 |
| 同じ境界の再送・再開 | Unique / dedupe条件で副作用なし | 現在状態へ収束 | 最新Bootstrapへ反映 |
| Owner外・Run不一致・Lease切れ | 業務データを変更しない | 404 / 423 / paused契約を維持 | Retry / Resumeを表示 |
| 予期せぬ処理障害 | 途中の業務状態を確定しない | Runをfailed、後続Stepをskipped | 再開導線を表示 |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | 繰越対象判定 | Storeの期限到来Runと履歴 / Outbox |
| AC-2 | due / cooldown判定 | Storeのscheduled activationと状態保持 |
| AC-3 | 境界遷移のdedupe | Run continue / resume / Owner・Lease |
| AC-4 | 次回表示mapper | Cycles UIのCurrent空状態・responsive構造 |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 既存`runCycleTransition`、`closeCycle`、`CycleSettings`、`cycle-schedule.ts`を拡張し、手動Runの公開APIは変更しない。
- 自動開始は手動`startCycle`の「現在時刻へ日付を寄せる」処理を再利用せず、予定済みUpcomingの日付を保持してActive化する。手動開始のCYC-08挙動と混同しないためである。
- Cycle固有の重複防止は既存Cycle状態、Cycle履歴の存在確認、Outbox dedupeを利用し、新規Schemaは作らない。
- UIは既存の`CyclesView`の空状態とBootstrapデータを拡張するだけで、別のAPIや状態管理を追加しない。

## 実装に効く制約

- 境界処理は必ず有効な`runId`とRuntime lockを通し、通常の業務Mutationとして実行できない。
- Auto activationは`startsAt <= now`かつActive Cycleなしの場合だけ行い、Cooldown中はUpcomingを変更しない。
- Auto activationでは予定日時を保持し、手動開始時だけ現在時刻開始とする。
- Cycle / Issue / History / OutboxはOwner scoped、再実行時に重複させない。
- 自動Schedulerを追加せず、ユーザーが起動したHTTP Chunk Runnerだけを境界処理の入口とする。

## 判断根拠 / 未決事項

- 既存Runの`cycle_transition`が期限到来Cycleを閉じる入口なので、同じStep内で予定開始まで扱う。新しいEndpointを増やすより、Runのlock・Lease・Snapshot境界を一つに保てる。
- Cooldown中にUpcomingを前倒しすると設定意図を壊すため、`startsAt`を判定値として使い、Activeなしを正しい状態として返す。
- 自動開始は予定日を保持する。手動の即時開始とは異なるため、共有の開始メソッドへ無理に統合せず、内部の小さな遷移処理に分ける。
- 未決事項なし。今回の進行指示をGate 1の実装開始承認として扱い、コミット前にGate 3の変更対象と未確認範囲を提示する。
