# FEAT-cycle-boundary-transition: data 詳細設計

## 担保 AC（index.mdからの引用）

- **AC-1**: Maintenance Runの`cycle_transition` Stepが、`endsAt <= now`のOwner scopedなActive Cycleを既存の完了・繰越処理へ渡し、Unstarted / Startedだけを次Cycleへ移動し、Backlog / Completed / Canceledは元Cycleへ残す。次Cycleは既存行を再利用し、不足時だけ1件生成する。
- **AC-2**: Active Cycleがなく、次のUpcoming Cycleの`startsAt <= now`になった場合、対象Upcomingだけを保存済みの`startsAt` / `endsAt`のままActiveへ遷移する。Cooldown中（次の`startsAt > now`）はActive Cycleを作らず、Upcomingを変更しない。
- **AC-3**: 同じRunの`cycle_transition`再送・同時相当の再実行・Lease復旧後の再開では、Cycle状態、Issue繰越、Cycle履歴、Cycle Outboxを重複させず、Owner外のCycleへ副作用を発生させない。Run自身の有効なlock contextだけが処理を通過する。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 境界処理 | `OrbitStore.runCycleTransition(userId, runId)` | 期限到来Activeの完了後、予定開始日時到来UpcomingをActive化。処理数を返す | `runId`付きRuntime lockのみ | Maintenance RunのStep処理 |
| Snapshot | `OrbitStoreSnapshot.cycles` | Cycleのstatus / startsAt / endsAt / completedAtを保持 | Owner scoped | 次回Bootstrapへ反映 |

自動Active化ではUpcomingの`startsAt` / `endsAt`を変更しない。Cooldown中はCycle Mapを変更しない。

## 実装配置

- `src/server/store.ts`: `runCycleTransition`とscheduled activation
- `src/server/store.test.ts`: Cycle繰越・境界遷移・冪等性
- `src/server/store-session.test.ts`: production Snapshotの状態保持

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| Activeの期限前 | Cycle Mapを変更せず処理数0 |
| Upcomingの開始前 | Cycle Mapを変更せずCooldown状態を維持 |
| Run以外のlock context | `assertUnlocked`で423、Cycle / Issue / History / Outbox不変 |
| Owner外Cycle | `listCycles(userId)`の対象外として無視し、参照・更新しない |
| 同じ境界の再実行 | Active / Upcomingの現在状態に収束し、Cycle固有のOutbox / Historyを増やさない |

## テストケース（技法注記付き）

- [状態遷移] 期限到来ActiveをRunで処理し、Unstarted / Startedだけが次Cycleへ移る。
- [状態遷移] 期限前Activeでは何も変更しない。
- [状態遷移] Activeなし・Upcoming開始前ではCooldownを維持し、Activeを作らない。
- [状態遷移] Activeなし・Upcoming開始日時到来では予定日時を保持してActive化する。
- [状態遷移/冪等性] 同じRunの再送後もCycle、History、Outboxが増えない。
- [データ境界] Owner AのRunがOwner BのCycleを変更しない。
