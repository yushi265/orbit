# FEAT-project-view-workspace: Project詳細とSaved View管理

## 概要

Projects画面からProject詳細を開き、Project metadata・Issue一覧・進捗を確認・更新できるようにする。Views画面ではSaved Viewの作成・編集・削除をOwner scopedかつ冪等に行えるようにする。

## 対象範囲

- 対象レイヤー: shared / data / service / ui
- 対象ドメイン: projects / issues / views
- 対象外: Project status CRUD、Label管理、Viewの高度なAND/OR、D1 adapter、Realtime、Project graph snapshot

## ユニット計画

| # | ユニット | 含むAC | 依存 | 状態 |
|---|---|---|---|---|
| 1 | Project workspace | AC-1,2,5,6 | — | 完了 |
| 2 | Saved View management | AC-3,4,6 | 共有契約 | 完了 |

## 受け入れ基準（AC）

- [x] **AC-1**: 本人がProjects画面でProjectを選択すると、Project名・説明・Status・期限、Owner scopedなIssue一覧を詳細表示できる。存在しない / 他OwnerのProjectは404相当の安全な表示になる。
- [x] **AC-2**: Project詳細でname（Unicode 1〜100）、description（0〜2,000）、statusId、targetAtを保存でき、既存Project APIのOwner / Runtime lock / idempotency契約を維持する。失敗時は入力を保持してRetryできる。
- [x] **AC-3**: 本人がSaved Viewをname（1〜80）・IssueQuery・layout付きで作成・編集・削除でき、同じKeyの再送はNo-op、異なるRequestは409、Runtime lock中は423になる。
- [x] **AC-4**: Saved View一覧はOwner scopedで表示され、Viewを選択すると保存したmode / order / filterの内容を確認できる。削除後は一覧から除外される。
- [x] **AC-5**: Project詳細のprogressはCompleted / Canceledを考慮し、Canceled Issueを完了率分母から除外する。Estimate合計も同じmetrics関数で算出する。
- [x] **AC-6**: Desktop / Tablet / MobileでProject detail / View操作がPointerとKeyboardで実行でき、390pxで横overflowがなく、保存中 / 空 / 400 / 409 / 423を明示する。

## アーキテクチャ / レイヤー間フロー

```text
Projects / Views UI
  ├─ Bootstrap: projects + issues + workflowStates + views
  ├─ PATCH /api/v1/projects/:projectId → metadata
  ├─ POST/PATCH/DELETE /api/v1/views → Saved View management
  └─ shared query / metadata schema
       ↓
     owner-scoped OrbitStore / Memory Store
```

## エラー・ログ方針（横断サマリ）

| シナリオ | shared | service / data | UI |
|---|---|---|---|
| Project / View不存在・Owner外 | 404 `RESOURCE_NOT_FOUND` | 業務データ変更なし | Not Found / 一覧へ戻る |
| 入力不正 | 400 `VALIDATION_ERROR` + fieldErrors | Project / View / Activity / Outbox / Receipt不変 | 入力値保持 + field error |
| 同一Keyの異なるRequest | 409 `IDEMPOTENCY_KEY_REUSED` | 業務効果なし | Conflict + 最新再取得 |
| Runtime lock | 423 `OPERATION_IN_PROGRESS` | 全Mutation副作用なし | overlay / Retry |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | Project metrics / view mapper | Owner scoped Bootstrap / Project detail |
| AC-2 | Metadata boundaries | Project PATCH API / lock / rollback |
| AC-3 | View query schema / idempotency | View CRUD API / owner / lock |
| AC-4 | View summary mapper | Bootstrap + delete reflection |
| AC-5 | shared metrics | Store / UI aggregation |
| AC-6 | — | local browser smoke（E2E自動化は任意） |

UIのAC-1 / AC-6は既存testing ruleに従いlocal browser smokeを受入証跡とし、実D1 / Access / Playwright自動化はRelease hardeningへ延期する。

## 既存実装との関係（再利用 / 差分 / 衝突）

- `OrbitStore.createProject / updateProject / archiveProject / listProjects`、既存Project PATCHを再利用する。
- `OrbitStore.createView / deleteView / listViews` と `IssueQuery` schemaを再利用し、View updateだけ追加する。
- BootstrapのProject / Issue / Workflow / Viewを使い、新しいProject detail GETは追加しない。
- D1のProject / Saved View schemaは既存基盤を再利用し、Migrationは追加しない。

## 実装に効く制約

- Project / View全MutationはOwner scoped、same-origin、idempotency、Runtime lockを通す。
- Project metricsはCanceledを分母から除外し、Estimate未設定は0。
- Saved View queryは既存のAND filter・mode・order・layout形を厳密に受け付け、未知キーを許可しない。

## 判断根拠 / 未決事項

- Project detailはBootstrap内の既存データを使う。detail専用APIを増やすと同じOwner境界・cache更新が二重になるため見送る。
- Saved ViewはIssueQuery全体を保存するが、今回UIからは名前と現在の標準queryを作成できる範囲に絞り、高度なFilter builderは別機能にする。
- Project status / Saved View layoutの自由度は既存型に限定し、D1 schema追加を避ける。
- 未決事項なし。Gate 2は自律実行指示に基づき委任する。
