# FEAT-cycle-workspace: Cycleワークスペース強化

## 概要

既存のCycles画面を、Current / Upcoming / Pastの切り替え、Cycleメタデータ編集、Issueの追加・解除、進捗メトリクスを備えたCycleワークスペースへ拡張する。既存のMemory Store、Issue CAS、Runtime lock、idempotency、手動Runによる繰越処理を再利用する。

## 対象範囲

- 対象レイヤー: shared / data / service / ui（各詳細は [shared.md](./shared.md) / [data.md](./data.md) / [service.md](./service.md) / [ui.md](./ui.md)）
- 対象ドメイン: cycles / issues / background
- 対象画面: `/cycles` のCycle workspace
- 対象外: 実D1 adapter、CycleSettingsの全項目編集、Graphの時系列Snapshot、複数IssueのBulk割当、Realtime、外部Scheduler

## ユニット計画

単一ユニット（Cycle workspace vertical slice）。既存BootstrapのCycle / Issueを読み、Cycle metadata APIと既存Issue PATCHをUIから呼び出す。

## 受け入れ基準（AC）

- [ ] **AC-1**: 本人がCyclesを開くと、Current / Upcoming / Pastを切り替えられ、各タブはOwner scopedなCycleだけを表示し、Cycleがない場合は空状態と次の導線を表示する。
- [ ] **AC-2**: Cycle詳細でnameOverride（nullまたはUnicode 1〜100文字）とdescription（0〜2,000文字）を保存でき、成功時は同じCycleの再表示に反映され、同じidempotencyKeyの再送はNo-op、異なるRequestは409になる。Runtime lock中は423で副作用がない。
- [ ] **AC-3**: Current / Upcoming Cycleの詳細で、Cycle未所属の本人所有Issueを追加し、所属Issueを解除できる。Issue version CAS、Owner境界、Runtime lock、409 / 423の既存契約を維持する。
- [ ] **AC-4**: Cycle詳細にIssue総数、Completed数、進捗率、Canceledを除外したEstimate合計を表示し、Canceled Issueは完了率の分母から除外する。Active Cycleの完了操作は既存の繰越処理を呼び出し、処理中は画面をブロックする。
- [ ] **AC-5**: Desktop / Tablet / Mobileでタブ、編集、Issue追加・解除、完了操作がPointerとKeyboardで実行でき、390pxで横overflowがなく、Status / Progress / Errorを色だけに依存しない。

## アーキテクチャ / レイヤー間フロー

```text
Cycles UI
  ├─ Bootstrap: cycles + issues + workflowStates
  ├─ PATCH /api/v1/cycles/:cycleId → Cycle metadata
  ├─ PATCH /api/v1/issues/:issueId → Cycle assignment (existing CAS)
  └─ POST /api/v1/cycles/:cycleId → close / handoff (existing manual Run contract)
       ↓
     owner-scoped OrbitStore / Memory Store
```

## エラー・ログ方針（横断サマリ）

| シナリオ | shared | service / data | UI |
|---|---|---|---|
| Cycle不存在・Owner外 | `RESOURCE_NOT_FOUND` / 404 | Map / DBを変更しない | Not Found相当のエラーとCyclesへ戻る導線 |
| Metadata入力不正 | `VALIDATION_ERROR` / 400 + fieldErrors | Cycle / Activity / Outbox / Receiptを変更しない | 入力値を保持してエラー表示 |
| 同一Keyの異なるRequest | `IDEMPOTENCY_KEY_REUSED` / 409 | 業務効果なし | Conflictと再試行導線 |
| Issue version競合 | `ISSUE_VERSION_CONFLICT` / 409 | Issue / Activity / Outboxを変更しない | 最新Bootstrapを再取得 |
| Runtime lock | `OPERATION_IN_PROGRESS` / 423 | 全Mutationの副作用なし | 操作を確定せずRetryを表示 |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | Cycle status tab mapper | Store owner filter / Bootstrap |
| AC-2 | Metadata boundary / idempotency hash | API + Store metadata CRUD / lock |
| AC-3 | Progress and assignment mapper | Issue CAS assignment |
| AC-4 | Metrics reducer | Cycle detail aggregation / close delegation |
| AC-5 | — | local browser smoke（E2E自動化は任意） |

AC-1 / AC-5の画面状態・Keyboard・responsiveは、既存testing ruleの「Browser E2Eは任意」を適用し、local browser smokeを受入証跡とする。React component test runnerは今回追加しない。

## 既存実装との関係（再利用 / 差分 / 衝突）

- `OrbitStore.listCycles` / `closeCycle` / `updateIssue` / Bootstrapを再利用する。
- `src/db/schema.ts` の既存 `cycles` / `cycle_settings` と同じMemory Store契約を使い、Migrationは追加しない。
- 既存 `/api/v1/cycles/:cycleId` のPOST（完了）へPATCH（metadata）を追加する。既存POSTの意味は変更しない。
- `CyclesView`を拡張し、Projects / Issues / Settingsの既存デザインTokenを再利用する。
- 実D1のCAS・timezone判定・Preview同時実行はRelease hardeningへ延期する。

## 実装に効く制約

- 全Cycle / Issue MutationはOwner scoped、same-origin、idempotency、Runtime lockを通す。
- Metadata更新は`nameOverride`と`description`以外を受け付けない。
- Issue割当は既存Issue versionを必須とし、UI側の楽観更新で別のIssueを巻き戻さない。
- Canceled Issueは進捗率の分母から除外し、Estimate未設定は0として合計する。

## 判断根拠 / 未決事項

- CycleSettings全項目やGraph Snapshotを同時に追加せず、既存データで観測できるWorkspace表示とMetadata / Assignmentに絞る。これにより既存の手動Run・D1延期境界を広げない。
- MetadataにCycle versionを新設せず、既存Schemaに無いMigrationを避ける。idempotencyとRuntime lockで再送・実行中競合を担保し、実D1 adapterでのCASはRelease hardeningで確定する。
- 完了処理は既存`closeCycle`を呼び出し、今回のUIから別の繰越ロジックを再実装しない。
- 未決事項なし。Gate 2はユーザーの自律実行指示に基づき要点提示後に委任する。
