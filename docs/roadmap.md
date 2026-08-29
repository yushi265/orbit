# orbit 開発タスク台帳

> 実装の正本は各 `docs/spec/<TICKET>-*/index.md`、プロダクト上の完了条件は
> [`requirements/05-acceptance-and-delivery.md`](./requirements/05-acceptance-and-delivery.md)を参照する。
> この台帳は、specのチェック状態が古い場合でも、実装済みコミットと実コードを基準に現在の優先順位を示す。

## 現在地

- 基準日: 2026-08-28
- ブランチ: `main`
- 最新コミット: CYC-10反映済み（確定値は`git log`を参照）
- 現在の重点: Phase 3 Cycleの残タスクを閉じる
- 次に着手: `CYC-17` CycleのStatus / Priority / Project別内訳

## 完了済み

| 領域 | 実装・証跡 |
|---|---|
| Foundation | 本人限定Access、Owner bootstrap、Preferences、Workflow、Runtime lock / Run UI |
| Issue core | Issue CRUD、Detail、属性、Parent、検索、Recent、Command、Archive / Trash、Label / Bulk、Project割当、手動順 |
| Project / View | Project detail、Project metadata、Saved View CRUD |
| Inbox / UI | Inbox通知、Theme / ColorTheme、PWA asset、レスポンシブ修正、Issue操作性改善 |
| D1 | Owner単位Snapshot永続化、production deploy、初回OwnerのSnapshot / Cycle backfill |
| Cycle基盤 | Current / Upcoming / Past、metadata、Issue割当、metrics、初回Cycle生成 |
| Cycle設定 | 期間、開始曜日、Cooldown、将来Cycle数、Timezone / DST対応 |
| Cycle境界 | Maintenance Runで期限到来Activeを繰越し、開始日時到来Upcomingを予定日時のままActive化。Cooldown中はActiveなし |
| Cycle自動追加 | Started / Completedへ遷移した未所属IssueのCurrent Cycle自動追加、ON/OFF設定、Automation Activity / Outbox |

## Phase 3 Cycle 残タスク

### 完了した直近タスク

| ID | 内容 | 依存 | 優先度 |
|---|---|---|---|
| CYC-06 | Upcoming Cycleの開始日・終了日を個別調整し、期間重複を拒否。`scheduleOverridden`を後続自動計算のアンカーにする | Cycle設定・境界遷移 | 完了 |
| CYC-10 | Started / Completedになった未所属Issueの現在Cycle自動追加と設定UI | Cycle設定UI | 完了 |
| CYC-11 | Issueの繰越回数・元CycleをIssue詳細とCycle履歴へ表示 | 既存`cycleHistory` | 完了 |
| CYC-14 | Cycle内Issueの並び替えをList / Boardへ追加 | 既存Issue position / reorder | 完了 |

### 次タスク

| ID | 内容 | 依存 | 優先度 |
|---|---|---|---|
| CYC-17 | CycleのStatus / Priority / Project別内訳 | Cycle metrics | P2 |

### 次の候補

| ID | 内容 | 依存 | 優先度 |
|---|---|---|---|
| CYC-17 | CycleのStatus / Priority / Project別内訳 | Cycle metrics | P2 |
| CYC-16 | 開始時点・追加削除履歴から日別Completed / Remaining / Scope changeを表示 | 時系列Snapshotまたは履歴モデル | P2 |

## 横断・Release hardening

| ID | 内容 | 状態 |
|---|---|---|
| ASYNC-09〜13 | D1のlock CAS、Chunk dedupe、Lease復旧、失敗Step再開、全Mutation lock matrixを実D1で担保 | 未着手 / 既存Memory実装あり |
| REL-01 | `REL-d1-persistence`のAC・progress記録を実装実態に合わせて監査し、正規化Repository移行範囲を確定 | 要監査 |
| REL-02 | Access実環境、PWA、390px / Keyboardのbrowser smoke | 未実施 |
| REL-03 | D1 backup / restore drill、rollback、障害確認手順 | 手順整備待ち |
| REL-04 | 1万IssueのCycle集計、検索、API latency / Core Web Vitals計測 | 未計測 |

## Phase 4以降

Project / Viewの主要実装は既に完了しているため、Phase番号上はPhase 4に相当する成果物を先行消化済みとして扱う。CycleのP0 / P1を閉じた後、未実施のRelease hardeningを優先し、実測で残課題を絞る。

## 運用ルール

- `done`: 実装・テスト・必要な品質ゲート・コミットまで完了。
- `next`: 次に実装する1チケット。CYC-14のコミット後はCYC-17。
- `backlog`: 要件は確定しているが、依存または優先順位待ち。
- `release`: 実Access / 実D1 / 実ブラウザ / backup・性能など、機能実装後に検証する項目。
- 各タスクの実装中は専用specの`progress.md`を使い、完了時に揮発ファイルをコミットへ残さない。
