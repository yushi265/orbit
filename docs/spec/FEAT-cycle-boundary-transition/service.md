# FEAT-cycle-boundary-transition: service 詳細設計

## 担保 AC（index.mdからの引用）

- **AC-1**: Maintenance Runの`cycle_transition` Stepが、`endsAt <= now`のOwner scopedなActive Cycleを既存の完了・繰越処理へ渡し、Unstarted / Startedだけを次Cycleへ移動し、Backlog / Completed / Canceledは元Cycleへ残す。次Cycleは既存行を再利用し、不足時だけ1件生成する。
- **AC-2**: Active Cycleがなく、次のUpcoming Cycleの`startsAt <= now`になった場合、対象Upcomingだけを保存済みの`startsAt` / `endsAt`のままActiveへ遷移する。Cooldown中（次の`startsAt > now`）はActive Cycleを作らず、Upcomingを変更しない。
- **AC-3**: 同じRunの`cycle_transition`再送・同時相当の再実行・Lease復旧後の再開では、Cycle状態、Issue繰越、Cycle履歴、Cycle Outboxを重複させず、Owner外のCycleへ副作用を発生させない。Run自身の有効なlock contextだけが処理を通過する。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| Continue | `POST /api/v1/background-runs/:runId/continue` | 既存`{ idempotencyKey, expected_cursor }` → `ContinueRunResponse` | Owner / Run / lock / Lease | Cycle境界Stepを最大Chunk内で実行 |
| Bootstrap | `GET /api/v1/bootstrap` | 既存`BootstrapPayload` | Owner scoped | Active / Upcomingと次回開始時刻を表示 |

`cycle_transition`は公開APIから直接呼び出さず、既存Runの有効な`runId`を内部処理へ渡す。Runのstep順、cursor、公開Token除外は変更しない。

## 実装配置

- `src/server/store.ts`: Runから呼ばれるCycle境界遷移
- `src/server/api.ts`: 既存Continue APIのResponse回帰
- `src/server/api-foundation.test.ts`: Run continueのCycle結果回帰

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| 期限前 / Cooldown中 | 200でRunを次Stepへ進め、業務Cycleは変更しない |
| Lease期限切れ / lock不一致 | 423または既存Lease expiryのpausedへ収束し、古い処理は書き込まない |
| Run不存在・Owner不一致 | 404、Cycleを変更しない |
| Cycle処理障害 | 既存Step失敗契約に従いRun failed、後続Step skipped |

## テストケース（技法注記付き）

- [状態遷移] ContinueのCycle Stepで期限到来Activeを完了し、ResponseのStep / cursorが既存契約どおり進む。
- [状態遷移] Cooldown中のContinueは200で副作用なし、次回BootstrapでUpcomingを保持する。
- [状態遷移] 開始日時到来UpcomingのContinueはActive化し、次のContinueでも重複Activity / Outboxを作らない。
- [デシジョンテーブル] Run所有者一致 / 不一致、lock有効 / 期限切れを既存404 / 423 / paused契約へ分岐する。
