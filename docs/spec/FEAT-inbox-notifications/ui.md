# FEAT-inbox-notifications: ui契約

## 担保AC

- **AC-2**: 個別通知のクリックで既読化し、Issue / Cycle / Projectの対象画面へ遷移できる。「すべて既読」で未読を一括既読化し、未読badgeが0になる。
- **AC-3**: Loading / empty / 400 / 404 / 423を明示し、mobileを含む各幅で横overflowがなく、notification rowと操作をKeyboardで実行できる。

## UI/UX方針

- Notification row全体をbutton相当として、クリック / Enterで既読化と対象遷移を行う。対象なしはInboxに留まる。
- 「すべて既読」は未読がある時だけ有効化し、成功後にBootstrapを再取得する。
- 個別失敗時は未読状態・一覧を保持し、alertと再試行を表示する。

## レスポンシブ / アクセシビリティ

- Desktop / Tabletは既存Inbox list幅、Mobileはrowを縦に縮める。390 / 768 / 1200pxで横overflowなし。
- rowはnative button、既読操作はvisible label / aria-labelを持つ。Tab / Enterで実行、Escapeで編集を壊さない。

## 異常系挙動

- Emptyは「新しい通知はありません」を表示する。
- API 400 / 404 / 423はalertを出し、未読と選択位置を保持する。

## テストケース

- [状態遷移] unread row → click → read / target navigation。
- [状態遷移] all read → unread badge 0。
- [アクセシビリティ] Tab / Enter / Escape、390 / 768 / 1200px。
