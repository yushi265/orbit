# FEAT-cycle-auto-add: data 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: `PATCH /api/v1/cycle-settings` は`autoAddToCurrentCycle`（boolean）を受け付け、BootstrapとSnapshot再読込で保存値を返す。未知フィールド・boolean以外・Owner外・Runtime lock中・同一Keyの異なるRequestは既存の400 / 404 / 409 / 423契約どおり拒否し、旧Snapshotで値が欠落している場合は`false`へ補完する。
- **AC-3**: 自動割当は通常のIssue Activity / Outboxと同じ成功Mutationへ含まれ、`cycle.auto_assigned`・`system:automation`・`before.cycleId = null`・`after.cycleId = Current Cycle ID`を持つAutomation Activityと、重複しない`issue.cycle.auto_assigned` Outboxを記録する。同じidempotencyKeyの再送は保存済みIssueを返し、二重割当・二重履歴・二重Outboxを発生させない。
- **AC-4**: Issue更新は既存のOwner、Runtime lock、version conflict、入力検証、Snapshot Version CAS境界を維持し、入力不正・権限外・lock中・競合時はIssue、Activity、Outbox、Receiptを増やさない。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| Snapshot | `OrbitStoreSnapshot.cycleSettings[]` | `autoAddToCurrentCycle: boolean`を必須化。旧Snapshotの欠落値はfalse | Owner scoped | 設定の永続化 |
| Activity schema | `activity_events.actor_type` | `user` / `system:manual-run` / `system:automation` | Owner scoped | Automation actorを保存 |
| Migration | `drizzle/0003_*.sql` | 既存Activity tableのcheck constraintだけを拡張し、既存行を保持 | D1 migration | 正規化D1との契約整合 |

`cycle_settings.auto_add_to_current_cycle`列は初期Migrationに存在するため、新規列追加Migrationは作らない。Activity actor typeの追加は既存tableを再作成するSQLite Migrationで行う。

## 実装配置

- `src/server/model.ts`: `CycleSettings.autoAddToCurrentCycle`、`ActivityEvent.actorType`
- `src/server/store.ts`: `ensureOwner` default、`fromSnapshot`旧値補完、`isSnapshot` type guard
- `src/db/schema.ts`: Activity actor type check
- `drizzle/0003_*.sql` / `drizzle/meta/0003_snapshot.json` / `drizzle/meta/_journal.json`: generated migration
- `src/db/migration.test.ts`: actor type migrationの存在確認

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| 旧Snapshotの`autoAddToCurrentCycle`欠落 | falseへ補完して読み込み、次回成功persistで明示値を保存する |
| Snapshotの設定型不正 | `Invalid OrbitStore snapshot`として読み込みを拒否する |
| Migration適用前のactor type | `system:automation`を書き込まず、Migrationを適用してから利用する |

## テストケース（技法注記付き）

- [状態遷移] `autoAddToCurrentCycle`を含むSnapshotを保存し、production Sessionで再読込する。
- [後方互換] fieldが欠落した旧Snapshotを読み込み、falseへ補完する。
- [代表値] `system:automation` actor typeを許可するSchemaとMigrationを確認する。
- [回帰] 既存の`user` / `system:manual-run` ActivityがSnapshot往復後も維持される。
