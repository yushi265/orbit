# FEAT-label-bulk-workspace: Label管理とIssue一括操作

## 概要

SettingsでLabel（名前・色）を管理し、Issues画面で選択した複数IssueへStatus / Priority / Cycle / Project / Labelを一括適用できるようにする。既存のOwner境界、Runtime lock、冪等性、Issue version、Activity / Outbox / Receiptを維持する。

## 対象範囲

- 対象レイヤー: shared / data / service / ui
- 対象ドメイン: labels / issues / bulk mutation
- 対象: Memory Store、Bootstrap、Label CRUD API、Issue bulk API、Settings / Issues UI、Label表示・Filter
- 対象外: D1 repository / migration、複数選択のShift範囲選択、Bulk undo、複合AND/OR filter、Label階層、カスタム色パレット

## ユニット計画

| # | ユニット | 含むAC | 依存 | 状態 |
|---|---|---|---|---|
| 1 | Label shared / data | AC-1, AC-4 | — | 完了 |
| 2 | Bulk service / data | AC-2 | 1 | 完了 |
| 3 | Label / Bulk UI | AC-3, AC-4, AC-5 | 1,2 | 完了 |

## 受け入れ基準（AC）

- [x] **AC-1**: 本人がLabelをname（Unicode 1〜50）・color（`#RRGGBB`）で作成・編集・削除できる。一覧はOwner scopedで、削除時はIssueから該当Label参照を除去する。同じKeyの再送はNo-op、内容違いは409、Runtime lock中は423になる。
- [x] **AC-2**: 本人が1〜100件の自分のIssueを選択し、status / priority / cycle / project / labelのいずれか1つを一括更新できる。参照先のOwner、Issueの存在・未削除を検証し、全件成功または全件不変の原子性を保つ。成功した各Issueはversionを1増やす。
- [x] **AC-3**: Issues画面のBulk barで対象属性と値を選択して適用・解除でき、成功後に選択解除と再取得を行う。400 / 404 / 409 / 423時は選択と入力を保持し、Error alertと再試行導線を表示する。
- [x] **AC-4**: Issue行にLabel名・色を表示し、Label filterで絞り込める。SettingsのLabel管理とIssuesのBulk選択は同じBootstrap情報を使う。
- [x] **AC-5**: Desktop / Tablet / MobileでLabel管理とBulk操作をPointer / Keyboardで実行でき、390pxで横overflowがなく、空・保存中・lock中を明示する。

## アーキテクチャ / レイヤー間フロー

```text
Settings / Issues UI
  ├─ Bootstrap: labels + issues.labelIds
  ├─ POST/PATCH/DELETE /api/v1/labels/:labelId
  └─ POST /api/v1/issues/bulk
       ↓
OrbitStore (owner-scoped Memory MVP)
  ├─ labels Map
  ├─ issue.labelIds
  └─ atomic snapshot → Issue version / Activity / Outbox / Receipt
```

## エラー・ログ方針

| シナリオ | HTTP / code | データ | UI |
|---|---|---|---|
| 入力不正・空選択・上限超過 | 400 `VALIDATION_ERROR` + fieldErrors | Map / Issue / Activity / Outbox / Receipt不変 | 入力と選択を保持 |
| Owner外 / 不存在 / 削除済み | 404 `RESOURCE_NOT_FOUND` | 全件不変 | Error alert + 再試行 |
| 同一Keyの内容違い | 409 `IDEMPOTENCY_KEY_REUSED` | 全件不変 | Conflict表示 + 最新再取得 |
| Runtime lock | 423 `OPERATION_IN_PROGRESS` | version / Map / Activity / Outbox / Receipt不変 | 保存中表示を解除、再試行可能 |

Bulk成功時はIssueごとに`issue.bulk_updated` Activity / Outboxを記録し、Bulk全体を`issue.bulk` Receiptへ保存する。Label作成・更新・削除も既存のActivity / Outbox / Receipt方針に従う。

## テスト戦略

| AC | 単体 | レイヤー内結合 / Browser smoke |
|---|---|---|
| AC-1 | Label schema・色・Unicode境界 | Store / API CRUD、Owner、lock、replay |
| AC-2 | Bulk payload正規化 | Store原子性、参照先Owner、version / activity / outbox / receipt |
| AC-3 | Bulk UI mapper | local browserで選択→適用→再取得、400/409/423保持 |
| AC-4 | Label表示 / filter mapper | Bootstrap、Issue row / filter |
| AC-5 | — | 390 / 768 / 1200px、Keyboard Escape / Tab / Enter |

UIのAC-3 / AC-5は既存testing ruleに従いlocal browser smokeを受入証跡とし、実Playwright・D1・AccessはRelease hardeningへ延期する。

## 既存実装との関係

- `Issue.labelIds`、`issueFilterSchema.labelIds`、`listIssues`のAND filterを再利用する。
- `updateIssue`のStatus / Priority / Project / Cycle / labelIdsのOwner検証を共通化し、Bulkは同じ参照検証を使う。
- `BootstrapPayload`へlabelsを追加し、Label管理とBulk pickerの二重取得を避ける。
- `db/schema.ts`のlabels / issue_labels定義は存在するが、現段階は既存Memory StoreのPreview境界を維持し、D1 migrationはRelease hardeningへ延期する。

## 判断根拠 / 未決事項

- Labelは既存DB定義に合わせて名前・色だけに限定し、色は検証可能なhex文字列とする。
- Bulkは選択Issueを全件検証してからsnapshot付きで適用し、部分成功を許さない。Version CASは既存単体Updateとの競合を次の明示的再取得で検知するため、今回のMemory MVPではBulk requestの単一receiptを正本にする。
- Label bulk操作は選択Label一つへの置換または「Labelなし」への解除とし、複数Label builderは追加機能へ分離する。
- 未決事項なし。ユーザーの自律実行指示によりGate 2委任で進める。
