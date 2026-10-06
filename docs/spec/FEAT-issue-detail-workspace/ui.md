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

- Desktop: 2カラムPanel。左は本文（Description / Notes / Sub-issue / Relations / Activity の順、Activityは一番下）、右はプロパティ（Priority / Status / Project / Cycle / 日付 / Label / Parent）。
- Mobile: full-screen相当の1カラム、プロパティ / Description / Notes / Sub-issue / Relations / Activityを縦に並べる。
- 開いた直後のFocusはDialog自身に置く（タイトルや入力には当てない。Mobileでキーボードを出さないため）。
- アーカイブ / ゴミ箱へ と自動保存ステータスはPanel最下部の固定フッターに置く（Desktop / Mobile共通）。閉じる操作は右上の×とEscape。
- 初期: Issue属性とSkeleton、空Notes / Relationsには作成導線。
- 保存中: pending表示。成功はServer responseで確定、409 / 423 / 5xxはrollback + Retry。
- Note / Relation追加後は入力をクリアし、対象カードへfocusを戻す。
- EscapeでPanelを閉じ、Focusを起点のIssue rowへ返す。Button / textarea / selectにはlabelを付ける。

### タイトル・Descriptionの自動保存

- タイトルとDescriptionは編集欄からフォーカスが外れた時に自動保存し、変更がない場合はAPIを呼ばない。
- タイトルからDescription、またはDescriptionからタイトルへフォーカスを移す場合は、編集中のdraftを維持し、同じ内容を重複保存しない。
- 自動保存中もタイトルとDescriptionは編集できる。保存中に追加された変更は、先行保存の完了後に最新versionで続けて保存する。
- 保存成功時はServer responseでDetail / Bootstrap cacheを確定し、保存中・保存済みを`aria-live`で通知する。409 / 423 / 5xxは既存どおりrollbackと再試行を表示する。Archive / Trash / Issue切替 / Closeは保存完了後に離脱する。
- 「説明を保存」ボタンは表示しない。Project選択と作業メモ編集の保存操作は今回変更しない。
- Issues一覧では「Issues」見出しと新規Issueボタンを表示し、補足説明文は表示しない。

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
- [状態遷移] タイトルまたはDescriptionを編集して編集領域の外へフォーカス移動 → 1回だけ自動保存
- [状態遷移] タイトルとDescription間のフォーカス移動 → 重複保存なし、draft保持
- [状態遷移/失敗系] 自動保存中の追加入力、409 / 423 / 5xx → 最新draftまたは既存値を契約どおり保持し、再試行を表示
- [代表値] 「説明を保存」ボタンは存在せず、Project / 作業メモの既存保存導線は維持
- [状態遷移] Archive / Trash / Issue切替 → 自動保存完了後に離脱し、未保存draftを失わない

### 今回のテスト対応

| 観点 | 証跡 |
|---|---|
| タイトル・Descriptionのblur保存、両方向のフォーカス移動、重複抑制 | `src/components/issue-detail-autosave.test.ts` の「タイトルを編集してフォーカスを外すと自動保存する」「タイトルとDescription間の移動では重複保存せず、外側で1回保存する」「Descriptionからタイトルへ移動して外側で自動保存する」 |
| 保存中の追加draft、元値復帰、最新version、親mutation待機 | 同ファイルの「保存中の追加入力を最新versionで続けて保存する」「保存中にblurせず追加したdraftも続けて保存する」「保存中にdraftを元の値へ戻した場合も後続保存する」「別属性更新後は最新versionで自動保存する」「親のIssue更新中は自動保存を待機し、完了後に保存する」 |
| 400 / 409 / 423 / 500、close成功・失敗、Escape | `issue-detail-autosave.test.ts` の「自動保存失敗時は値を戻し、再試行でdraftを保存する」「version競合時は最新値を再取得して再試行を残す」「Runtime lock中は自動保存をrollbackして再試行を表示する」「Escapeで閉じる場合も保存失敗時はパネルを維持する」「編集中に閉じる操作をして保存に成功した場合は閉じる」 |
| Issues見出し、Project / 作業メモ導線 | `src/components/issue-experience.test.ts` の「Issues見出しの補足文を表示しない」、`issue-detail-autosave.test.ts` の「変更がないblurでは保存せず、説明の保存ボタンだけを廃止する」「Project保存はDescriptionの自動保存完了後に実行する」 |
| Archive / Trash / Issue切替 | `issue-detail-autosave.test.ts` の「Archiveは自動保存完了後に実行する」「Trashは自動保存完了後に実行する」「Issue切替はDescriptionの自動保存完了後に実行する」 |
