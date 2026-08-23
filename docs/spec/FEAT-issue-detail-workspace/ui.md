# FEAT-issue-detail-workspace: ui契約

## 担保AC

- **AC-1**: 本人が `/issues/$issueId` を開くと、対象Issueの主要属性、Markdown互換の説明、Notes、Relations、ActivityがOwner scopedで表示され、存在しないIssueまたは他OwnerのIssueは404相当の安全な詳細表示になる。
- **AC-2**: Issue詳細で説明を編集して保存すると、versionが1増えActivityが1件追加され、同じversionを使った競合Mutationは409になり既存の説明・Activity・Outboxを変更しない。保存中は入力を編集でき、失敗時は直前の内容へ戻して再試行を表示する。
- **AC-3**: 本人が1〜10,000文字のMarkdown互換メモを追加・編集・論理削除でき、空文字・10,001文字・他OwnerのNoteは拒否され、成功した追加・編集・削除はIssue Activityへ1件だけ記録される。
- **AC-4**: 本人が別の本人所有Issueへ `blocking / blocked_by / related / duplicate` Relationを追加・削除でき、自己参照・他Owner参照・同一Relationの重複は業務データを変更せず安全なエラーまたはNo-opになる。詳細画面ではRelation先のIssue番号とタイトルを表示する。
- **AC-5**: Background Runがrunningの間、説明・Note・RelationのMutationは423 `OPERATION_IN_PROGRESS`で拒否され、Issue version・Activity・Outbox・Note・Relationを増やさない。読み取りは継続できる。
- **AC-6**: Desktop / Tablet / Mobileの詳細画面で、主要操作がキーボードとPointerの両方で実行でき、Mobile幅390pxで横方向の表示崩れがなく、DialogをEscapeで閉じた後に元のIssue一覧へ戻れる。

## 公開契約 / 配置

- 既存 `/issues/$issueId` を利用し、`IssueComposer`の既存詳細分岐を `IssueDetailPanel`へ置き換える。
- `IssueDetailPanel`は `['issue-detail', issueId]` Query keyでDetail responseを保持する。
- 説明更新は既存Issue PATCH、Note / Relationは専用APIを同一Origin fetchで呼ぶ。
- URLを直接開いた場合もDetail APIから同じIssueを復元する。

## UI/UX方針

- Desktop: 2カラムPanel（本文 / Activity）とRelations / Notesのカード。
- Mobile: full-screen相当の1カラム、Description / Notes / Relations / Activityを縦に並べる。
- 初期: Issue属性とSkeleton、空Notes / Relationsには作成導線。
- 保存中: pending表示。成功はServer responseで確定、409 / 423 / 5xxはrollback + Retry。
- Note / Relation追加後は入力をクリアし、対象カードへfocusを戻す。
- EscapeでPanelを閉じ、Focusを起点のIssue rowへ返す。Button / textarea / selectにはlabelを付ける。

### レスポンシブ / アクセシビリティ

- Mobile `<=767px`、Tablet `768..1199px`、Desktop `>=1200px`。390pxで横overflowを発生させない。
- 主要操作はPointerとKeyboard両方で実行可能。DialogはEscape、visible focus ring、ARIA labelを持つ。
- Status / Relation type / errorは色だけで伝えず、テキストを併記する。

## 異常系

| シナリオ | UI挙動 |
|---|---|
| Loading | Detail skeleton / 既存Issue snapshot保持 |
| 404 | Not Found cardとIssuesへ戻る |
| 400 | body field error、入力値を保持 |
| 409 | 最新Detail再取得、Conflict banner |
| 423 | Background overlay、入力を確定しない |
| 500 / offline | rollback、Retry、focus / scrollを保持 |

## テストケース

- [代表値] 専用URLを再読込してDetail / Notes / Relations / Activityを描画
- [状態遷移] Description optimistic → success / 409 rollback / 423 rollback
- [状態遷移] Note create / edit / deleteと空状態表示
- [デシジョンテーブル] Relation valid / self / duplicate / missing
- [境界値] 390 / 768 / 1200pxで横overflowなし
- [アクセシビリティ] Escape close、Focus、label、Keyboard submit
