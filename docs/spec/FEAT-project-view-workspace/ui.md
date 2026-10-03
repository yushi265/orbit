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

## 2026-10-03 Saved View実行の補完（依頼に基づくUI変更）

- Views作成・編集ではStatus / Priority / Project / Cycle / Labelのdetails内チェックボックスによる複数選択、検索語、期限、mode、order、group、空Group、表示項目を設定する。異なる条件はAND、同種の選択はOR、Labelは全選択一致、選択0件はすべてとし、既存IssueQueryと同じ判定にする。
- 選択したViewの実際のIssue結果をList / Boardで表示する。行を開くと既存Issue詳細へ遷移する。
- `/views?view=<id>`が選択状態の正本。再読み込み・戻る操作で同じViewが選択される。削除成功時にその選択を解除し、不存在IDは安全な案内を表示する。
- 更新で触れていないfilter配列、created範囲、group、layout（未知キー含む）、limit、cursorを保持する。既存Estimate順はそのまま保持するが、新規選択肢には追加しない。
- 結果はOwner scopedなBootstrap Issue集合に既存Storeと同じFilter / Order / 1..500件上限を適用する。既存Storeと同様cursorによるページングは行わず、保存値を保持する。
- 条件不一致の空結果とView未作成を区別する。保存失敗時はdraftとRetryを維持し、既存Owner / lock / receipt APIを使う。API / schema / authは変更しない。

### 検証記録

- RED: `pnpm exec vitest run src/components/saved-views.test.ts`はhelper未実装で失敗（2026-10-03）。
- 判定テストは既存Storeに同じデータ・Queryを入力し、全orderと複数Filter・limitの結果を比較する。
- UI結合テストは選択復元、条件一致、Issue詳細callback、mode更新のmetadata保持、新規作成の複数Filter、423 draft/同一key再試行、削除と空一覧を検証する。
- GREEN: `saved-views.test.ts`（4件）+ `saved-views-runtime.test.ts`（6件）全10件成功。既存`store-project-view`（5件）+`project-view-workspace`（2件）も成功。新helper・tests・routeのoxlint成功、oxfmt適用済み（2026-10-03）。

- モバイル補完: native multiple selectを使わず44px行高のcheckbox選択にする。不明な既存IDも選択肢へ残す。List / Board結果は専用saved-view-issueのmain/meta構造にし、320pxではmainを縦に並べ、長い文字列を折り返す。未作成時は「Viewを作成」で直接editorを開く。InspectorはEstimateを含め保存orderを正しく表示する。
- 判定fixture補強: 異なるstatus / priority / project / cycle / labels / 作成時刻 / 更新時刻 / 期限 / estimate / positionを持つ4 Issueとarchive/delete例を使い、Filterごとの期待ID、全6 orderの期待順、limit、UTC/Tokyoの日付境界を固定する。
- 追加GREEN: Saved View専用3 files / 12 tests成功（Filter / order期待値、checkbox操作、不明ID保持、Inspector値、空状態作成、実Router URL変更とfresh Router再読み込み復元を含む）。`pnpm typecheck`成功、新helper/tests/routeのoxlint成功（2026-10-03）。
- Browserで期限付きViewの表示時にtimezoneをlocaleへ渡すRangeErrorを検出。期限非null・Owner timezone=Asia/Tokyoのruntime testでREDを再現し、既存formatterの正しい呼出（UTCカレンダー日・既定ja-JP）へ修正。Saved View専用3 files / 13 tests GREEN（2026-10-03）。
