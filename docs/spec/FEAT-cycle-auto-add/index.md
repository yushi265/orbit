# FEAT-cycle-auto-add: Started / Completed IssueのCurrent Cycle自動追加

## 概要

Cycle設定で自動追加をONにすると、未所属IssueがStartedまたはCompletedへ遷移した時点で、現在ActiveなCycleへ自動的に割り当てる。
自動割当はIssue更新と同じOwner・lock・version・idempotency境界で処理し、変更履歴へAutomationとして記録する。

## 対象範囲

- 対象レイヤー: shared / data / service / ui
  - [shared.md](./shared.md)
  - [data.md](./data.md)
  - [service.md](./service.md)
  - [ui.md](./ui.md)
- 対象ドメイン: issue / cycle / cycle settings / activity / outbox
- 対象外（やらないこと）:
  - 自動追加設定をONにした時点で、既存の未所属Issueを遡及して追加する処理
  - Active CycleがないCooldown中の自動追加、またはCycleの新規生成
  - 既存Cycleの繰越履歴（CYC-09 / CYC-11）やCycle分析の変更
  - Background RunやSchedulerによる別経路の自動追加
  - 明示的な`cycleId`を同じMutationで指定した場合の上書き

## ユニット計画

単一ユニット（CycleSettingsの自動追加設定、Issue status Mutation、Automation履歴）。既存のCycleSettings API、Issue version CAS、Activity / Outbox / Receipt、Snapshotを縦に接続する。

| # | ユニット | 含む AC | 依存 | 状態 |
|---|---|---|---|---|
| 1 | status遷移時のCurrent Cycle自動追加 | AC-1〜5 | 既存CycleSettings / Issue Mutation | 進行中 |

## 受け入れ基準（AC）

- [x] **AC-1**: `PATCH /api/v1/cycle-settings` は`autoAddToCurrentCycle`（boolean）を受け付け、BootstrapとSnapshot再読込で保存値を返す。未知フィールド・boolean以外・Owner外・Runtime lock中・同一Keyの異なるRequestは既存の400 / 404 / 409 / 423契約どおり拒否し、旧Snapshotで値が欠落している場合は`false`へ補完する。
- [x] **AC-2**: `autoAddToCurrentCycle = true` かつActive Cycleが存在する時、未所属Issueが作成時にStarted / Completedとなる、または既存Issueのstatusを別statusからStarted / Completedへ変更する、または一括Status変更で同条件を満たす場合、IssueをCurrent Cycleへ割り当てる。IssueのversionはそのMutationで1回だけ進み、明示的な`cycleId`、既にCycle所属、対象外status、Active Cycleなし、設定OFFでは自動割当しない。
- [x] **AC-3**: 自動割当は通常のIssue Activity / Outboxと同じ成功Mutationへ含まれ、`cycle.auto_assigned`・`system:automation`・`before.cycleId = null`・`after.cycleId = Current Cycle ID`を持つAutomation Activityと、重複しない`issue.cycle.auto_assigned` Outboxを記録する。同じidempotencyKeyの再送は保存済みIssueを返し、二重割当・二重履歴・二重Outboxを発生させない。
- [x] **AC-4**: Issue更新は既存のOwner、Runtime lock、version conflict、入力検証、Snapshot Version CAS境界を維持し、入力不正・権限外・lock中・競合時はIssue、Activity、Outbox、Receiptを増やさない。
- [x] **AC-5**: SettingsのCycleカードで自動追加のON/OFFをキーボード操作できる。保存中は操作と保存ボタンを無効化し、成功表示、400 field error、409 conflict、423 / 500 Retryを既存の設定UIと同じ方式で表示する。Issue詳細の変更履歴では自動割当を`Automation`として識別でき、390px幅で横overflowを発生させない。

## アーキテクチャ / レイヤー間フロー

```text
Settings UI
  └─ PATCH /api/v1/cycle-settings { autoAddToCurrentCycle }
       ├─ shared strict schema
       └─ Owner-scoped OrbitStore + Snapshot

Issue create / PATCH / bulk status Mutation
  └─ existing Owner + lock + version + receipt boundary
       ├─ status category and explicit cycleId guard
       ├─ active Current Cycle lookup
       ├─ issue.cycleId assignment (version is incremented once)
       ├─ normal Issue Activity / Outbox
       └─ Automation Activity / Outbox
```

## エラー・ログ方針（横断サマリ）

| シナリオ | shared | service / data | 表示層の挙動 |
|---|---|---|---|
| 設定の入力不正・未知フィールド | strict `VALIDATION_ERROR` / 400 + fieldErrors | 設定・Cycle・Issue・Activity・Outbox・Receiptを変更しない | 入力値を保持し、該当行へエラー表示 |
| Owner外のStatus / Cycle / Issue | — | `RESOURCE_NOT_FOUND` / 404、他Ownerを返さない | 一般エラー表示 |
| Issue version競合 | — | `ISSUE_VERSION_CONFLICT` / 409、全副作用なし | Issueを再取得し、既存の競合導線を使う |
| 同じKeyの異なるRequest | — | `IDEMPOTENCY_KEY_REUSED` / 409、既存副作用を変更しない | 最新値を再取得し、Retryでは同じ操作内容を再利用しない |
| Runtime lock | — | `OPERATION_IN_PROGRESS` / 423、全状態を変更しない | 入力値を保持してRetryを表示 |
| 予期せぬ障害 | — | `INTERNAL_ERROR` / 500 + requestId、Tokenや本文をログへ出さない | 入力値を保持してRetryを表示 |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | CycleSettings schemaのboolean / strictness、旧Snapshot補完 | API / Storeの保存・再取得・Owner / lock / replay |
| AC-2 | status category判定と自動追加条件 | Issue create / PATCH / bulkのCurrent割当、除外条件、version |
| AC-3 | Automation Activity / Outboxのpayload整形 | API / Storeの冪等再送とDetail Activity |
| AC-4 | — | version / Owner / lock / validation / Snapshot CASの副作用分離 |
| AC-5 | Automation表示ラベル・設定フォーム状態 | Settings UIの保存、Retry、409、390px構造 |

## 既存実装との関係（再利用 / 差分 / 衝突）

- `cycle_settings.auto_add_to_current_cycle`は既存D1 schemaに存在するため、新しい設定列は追加せず、Memory model・Snapshot・wire契約へ接続する。
- `PATCH /api/v1/cycle-settings`、`OrbitStore.updateCycleSettings`、Issueの`createIssue` / `updateIssue` / `bulkUpdateIssues`、`recordActivity` / `recordOutbox` / `recordReceipt`を再利用する。
- Active Cycleは既存の`listCycles`からowner-scopedに解決し、Cooldown中はActiveが存在しないため自然に未割当とする。
- 既存Activityの`actorType`は`user`と`system:manual-run`だけを許可しているため、意味の異なる`system:automation`を追加し、正規化D1のcheck constraintをMigrationで更新する。既存Snapshotの`system:manual-run`は維持する。
- UIは既存Settingsの`settings-card` / `setting-row` / `button` / `role=alert` / `role=status`を再利用し、Issue DetailのActivity表示へAutomation識別だけを追加する。

## 実装に効く制約

- 全Mutationは既存のAccess / Owner、same-origin、Runtime lock、version CAS、idempotency、Snapshot persist境界を通す。
- 自動割当はstatus変更と同一のStore操作で行い、Issue versionを二重に進めない。
- `cycleId`がRequestに明示されている場合は、`null`を含めてユーザー指定を優先する。
- Active Cycleは最大1件という既存ライフサイクルを前提にし、複数件がある場合も他OwnerのCycleを参照しない。
- Activity / OutboxのAutomation効果はIssueごと・versionごとに一意なmutation / dedupe keyで記録する。
- `progress.md`は完了時に削除し、retro noteは残す。

## 判断根拠 / 未決事項

- 自動追加の判定をIssueのcreate / PATCH / bulkへ集約する。別Schedulerや後処理にすると、status更新とCycle割当の間に中間状態が生じ、既存version・lock・Receipt境界から外れるため採用しない。
- `cycleId`の明示指定（`null`を含む）はユーザーの意図として自動追加より優先する。Cycle解除とstatus変更を同じMutationで行う既存操作を、設定ONによって予期せず再割当しないためである。
- Automationは`actorType = system:automation`、`action = cycle.auto_assigned`とする。既存の`system:manual-run`を流用すると、Background Run由来と誤認するため、Activityの正規化D1制約をMigrationで拡張する。
- 設定ON/OFFは将来の自動追加にだけ効き、既存Issueの遡及処理は行わない。設定変更の副作用を小さくし、手動でCycle計画を選べる状態を保つ。
- 未決事項なし。今回の「次のタスクを進めて」という指示をGate 1の実装開始承認として扱い、既存の継続指示をGate 2のspec確認委任として扱う。Gate 3では変更対象と検証結果を提示する。
