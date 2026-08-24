# FEAT-project-view-workspace: ui契約

## 担保AC

- **AC-1**: 本人がProjects画面でProjectを選択すると、Project名・説明・Status・期限、Owner scopedなIssue一覧を詳細表示できる。存在しない / 他OwnerのProjectは404相当の安全な表示になる。
- **AC-2**: Project詳細でname（Unicode 1〜100）、description（0〜2,000）、statusId、targetAtを保存でき、既存Project APIのOwner / Runtime lock / idempotency契約を維持する。失敗時は入力を保持してRetryできる。
- **AC-3**: 本人がSaved Viewをname（1〜80）・IssueQuery・layout付きで作成・編集・削除でき、同じKeyの再送はNo-op、異なるRequestは409、Runtime lock中は423になる。
- **AC-4**: Saved View一覧はOwner scopedで表示され、Viewを選択すると保存したmode / order / filterの内容を確認できる。削除後は一覧から除外される。
- **AC-5**: Project詳細のprogressはCompleted / Canceledを考慮し、Canceled Issueを完了率分母から除外する。Estimate合計も同じmetrics関数で算出する。
- **AC-6**: Desktop / Tablet / MobileでProject detail / View操作がPointerとKeyboardで実行でき、390pxで横overflowがなく、保存中 / 空 / 400 / 409 / 423を明示する。

## UI/UX方針

- Projectカードクリックで`/projects/:projectId`へ遷移し、Project detailを表示する。無効IDはNot FoundとProjectsへ戻る導線。
- Viewは作成 / 編集パネルと選択Inspectorを持ち、mode / order / filter summary / limitを表示する。
- 保存中は操作をdisabledにし、失敗時は入力を保持し、Error alertを表示する。削除後は一覧とInspectorを更新する。

### レスポンシブ / アクセシビリティ

- Desktop >=1200、Tablet 768..1199、Mobile <=767。390pxでProject cards / View rowsが横にはみ出さない。
- Card / View selectはbuttonでKeyboard操作可能。Edit / Delete / Saveは可視テキストまたはaria labelを持つ。
- Metricsは割合・件数をテキスト併記し、Status / Modeは色だけに依存しない。

## 異常系挙動

| シナリオ | UI挙動 |
|---|---|
| Loading / empty | skeleton / 作成導線 |
| 404 | Not Found + Projects / Viewsへ戻る |
| 400 | 入力値保持 + field error |
| 409 | 最新Bootstrap再取得 + Conflict |
| 423 | 操作を確定せずRetry / overlay |

## テストケース

- [状態遷移] Project card → detail → metadata save / cancel。
- [状態遷移] View create → select inspector → edit → delete。
- [アクセシビリティ] Keyboard Escape / Tab / Enter、390 / 768 / 1200px overflow。
