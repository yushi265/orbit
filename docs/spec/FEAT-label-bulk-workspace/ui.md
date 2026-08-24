# FEAT-label-bulk-workspace: ui契約

## 担保AC

- **AC-3**: Issues画面のBulk barで対象属性と値を選択して適用・解除でき、成功後に選択解除と再取得を行う。400 / 404 / 409 / 423時は選択と入力を保持し、Error alertと再試行導線を表示する。
- **AC-4**: Issue行にLabel名・色を表示し、Label filterで絞り込める。SettingsのLabel管理とIssuesのBulk選択は同じBootstrap情報を使う。
- **AC-5**: Desktop / Tablet / MobileでLabel管理とBulk操作をPointer / Keyboardで実行でき、390pxで横overflowがなく、空・保存中・lock中を明示する。

## UI/UX方針

- SettingsにLabelsカードを追加し、Label一覧・名前入力・hex色入力・作成・削除を同一カードで行う。編集は行内入力でEscapeキャンセル、Enter保存とする。
- Issues toolbarにLabel filterを追加する。Issue行はLabel chip（色の丸＋名前）を表示する。
- 1件以上選択するとBulk barを表示し、属性（Status / Priority / Cycle / Project / Label）と値、適用ボタン、選択解除を並べる。Labelは一つ選択または「Labelなし」で解除する。
- 成功時はToast、selection clear、Bootstrap再取得。400 / 404 / 409 / 423では選択・属性・値を保持し、alertと再試行ボタンを表示する。

## レスポンシブ / アクセシビリティ

- Desktop >=1200はIssues toolbar直下にBulk barを横並びで表示し、Tablet 768..1199は2行、Mobile <=767は縦積みにする。
- Bulk controlsはlabel / aria-labelを持つnative select / buttonとし、Tabで移動、Enterで適用、Escapeで選択解除できる。
- 390pxで`.bulk-bar`とLabel chipが横にはみ出さず、colorだけに依存せずLabel名を常に表示する。

## 異常系挙動

- 初期 / 空Label / 空Issueは作成導線と説明を表示する。
- 保存中はLabel入力、Bulk controls、Issue選択をdisabledにする。
- Runtime lockはError alertの「再試行」を残し、入力・選択を破棄しない。

## テストケース

- [状態遷移] Label create → Issue表示 → Label filter → Bulk label assign / clear。
- [状態遷移] Issue multi-select →各Bulk属性適用→ selection clear / refresh。
- [アクセシビリティ] Escape / Tab / Enter、390 / 768 / 1200px overflow。
