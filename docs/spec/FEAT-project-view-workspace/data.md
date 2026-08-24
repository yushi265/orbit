# FEAT-project-view-workspace: data契約

## 担保AC

- **AC-1**: 本人がProjects画面でProjectを選択すると、Project名・説明・Status・期限、Owner scopedなIssue一覧を詳細表示できる。存在しない / 他OwnerのProjectは404相当の安全な表示になる。
- **AC-3**: 本人がSaved Viewをname（1〜80）・IssueQuery・layout付きで作成・編集・削除でき、同じKeyの再送はNo-op、異なるRequestは409、Runtime lock中は423になる。
- **AC-5**: Project詳細のprogressはCompleted / Canceledを考慮し、Canceled Issueを完了率分母から除外する。Estimate合計も同じmetrics関数で算出する。

## 公開契約 / 境界

- Project / Viewは`userId`一致でのみ取得・更新・削除する。
- Project metricsはshared `calculateCycleMetrics`を再利用し、Projectに属するIssueだけを渡す。
- Viewの`layout`はtop-levelと`query.layout`を同じ値へ正規化する。
- 実D1のRepository / batch / CASはRelease hardeningへ延期する。

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| Owner外 Project / View | 404、Map / Activity / Outbox / Receipt不変 |
| Runtime lock | 423、業務状態不変 |
| Delete replay | 同じKeyは200 No-op、対象は既に削除済み |

## テストケース

- [代表値] Project detail metrics / issue listはOwner scoped。
- [状態遷移] View create → update → delete → delete replay。
- [デシジョンテーブル] Owner一致 / 外部Owner / 不存在 / lock中。
- [同値分割] query.layout / top-level layoutの片側更新を同期。
