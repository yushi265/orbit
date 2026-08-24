# FEAT-label-bulk-workspace Browser Smoke

## 実行条件

- 実行日: 2026-08-24
- URL: `http://localhost:3000`
- 対象: Settings / Issues / Label filter / Bulk bar

## 手順と結果

1. SettingsのLabelsカードで`Frontend`（`#E05252`）を作成する。
   - 一覧へ表示され、名前・色入力と追加ボタンが機能した。
2. Issuesで`TASK-1`を選択し、Bulk属性をLabel、値をFrontendにして「一括適用」を押す。
   - 成功Toast、選択解除、Issue行のLabel chip表示を確認した。
3. 同じIssueを再選択し、Bulk値を「Labelなし」にして適用する。
   - Label chipが消え、選択解除された。
4. Label filterでFrontendを選択する。
   - `TASK-1`だけが表示された。
5. SettingsでFrontendを削除する。
   - Label一覧から消え、IssueのLabel chipも消えた。
6. Bulk barの属性選択・値選択・適用・選択解除をTab / Enterで操作し、Escapeで選択を解除する。
   - native select / buttonのKeyboard focus対象を確認する。390pxではBulk barが縦積みになる。
7. `document.documentElement.scrollWidth` と `clientWidth` を `/issues` / `/settings` で確認する。
   - 390px: Issues `390 / 390`、Settings `375 / 375`。
   - 768px: Issues `768 / 768`、Settings `753 / 753`（vertical scrollbar分を含む）。
   - 1200px: Issues `1200 / 1200`、Settings `1200 / 1200`。いずれも横overflowなし。
8. Label色へ`red`を入力して追加し、Error alertの再試行を確認してから`#E05252`へ直して保存する。
   - 400のalert、入力保持、再試行後の保存成功を確認した。409 / 423のcode・副作用不変はAPIテストで確認する。

400（入力不正）、404（Owner外 / 不存在）、409（idempotency conflict）、423（Runtime lock）と副作用不変はservice/APIテストで検証する。実Playwright・D1・AccessはRelease hardeningへ延期する。
