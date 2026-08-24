# FEAT-project-view-workspace Browser Smoke

## 実行条件

- 実行日: 2026-08-24
- URL: `http://localhost:3000`
- データ: ローカル開発用の既存 dev owner
- 対象幅: 390px / 768px / 1200px

## 手順と結果

1. `/projects` を開き、Projectカードを押す。
   - `/projects/:projectId` へ遷移し、Project名・説明・Status・Target・metrics・Owner scoped Issue一覧が表示された。
   - 無効な `/projects/project_missing` では「Projectが見つかりません」と「Projectsへ戻る」が表示された。
2. Project詳細の「編集」で名前を変更し、Escapeを押す。
   - 編集が閉じ、保存前の名前へ戻った。保存中は編集入力と周辺操作がdisabledになる。
3. `/views` で「Viewを保存」から名前を入力して保存する。
   - Saved Viewが一覧に表示された。選択するとmode / filter / order / limitのInspectorが表示された。
4. Saved Viewの編集を開き、名前入力からTabで次の操作へ移動し、Escapeで閉じてから削除する。
   - 編集内容は保存されず、削除後に一覧から消えた。
5. Saved Viewが空の状態を確認する。
   - 空状態と「Issuesで条件を作る」導線が表示された。
6. 各対象幅で `document.documentElement.scrollWidth === document.documentElement.clientWidth` を確認する。
   - 390px / 768px / 1200px のすべてで一致し、横overflowはなかった。

400（fieldErrors）、409（同一idempotency keyの内容違い）、423（Runtime lock）の応答と副作用なしは、同機能のservice/APIテストで検証する。UI側は同じErrorEnvelopeをalertへ表示し、入力を保持してSave / Retryできる実装を確認した。実D1 / Access / Playwright自動化はRelease hardeningで行う。
