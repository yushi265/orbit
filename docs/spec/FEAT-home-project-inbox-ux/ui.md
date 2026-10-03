# FEAT-home-project-inbox-ux: ui 詳細設計

> 2026-10-02の追加依頼で、Homeの表示名入り挨拶を除去し、主要カードの遷移条件を[FEAT-review-followup AC-1 / AC-8](../FEAT-review-followup/index.md)へ更新する。以下は初回実装時の記録。

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: Homeは本人の表示名と本人のTimezoneに基づく日付を表示し、期限超過、今日が期限、今日から7日以内が期限、Current Cycleの未完了Issue、更新日時順の最近更新Issueを、該当するものから確認できる。各Issueと主要カードからIssue一覧、Issue詳細、Cycle、Projectへ移動でき、該当0件の状態では次の操作を案内する。
- **AC-2**: `/projects/:projectId` はProject一覧の下に詳細を埋め込まず、Project概要・Status・期限・進捗と、対象Projectに限定したIssue workspaceを表示する。Issue workspaceは既存Issue一覧と同じList / Board、検索、Status / Priority / Label / 期限Filter、並び順、完了Issue表示切替、インライン更新、一括更新、手動並び替えを提供し、完了カテゴリだけを非表示にできる。CanceledカテゴリのIssueは完了Issueとして扱わない。
- **AC-3**: ProjectごとのIssue workspace表示設定（List / Board、検索、Status / Priority / Label / 期限Filter、並び順、完了Issue表示切替）はOwner scopedなサーバー状態として保存され、別端末のBootstrap再取得後に同じProjectで復元される。設定未保存のProjectは定義済み初期値で表示する。
- **AC-4**: Project表示設定のMutationは既存のOwner境界、same-origin、idempotencyKey、Runtime lockを守る。同じKey・同じRequestの再送は同じ設定を返し、同じKey・異なるRequestは409、入力不正は400、存在しないまたはOwner外Projectは404、Runtime lock中は423になり、設定を部分更新しない。Inboxは既存通知の既読化・対象遷移を維持したまま、Inboxの役割、通知の読み方、通知がない場合の次の行動を画面上で説明する。
- **AC-5**: Home、Project詳細、InboxはLoading、空、保存中、400 / 404 / 409 / 423 / 500系エラー、成功状態を既存のエラー表示方針で示し、Pointer / Keyboardの双方で主要操作を実行できる。Desktop（1200px以上）、Tablet（768〜1199px）、Mobile（767px以下、390pxを含む）で横方向の表示崩れを起こさない。

## このレイヤーが公開する契約（外部インターフェース）

### Route / component flow

- `/`は`HomeView`を表示し、BootstrapからHome summaryを導出する。Home専用APIは追加しない。
- `/projects`はProjectカード一覧を表示する。
- `/projects/:projectId`はProjectカード一覧を表示せず、Project header、Overview metrics、Issue workspace、Projectsへ戻る導線を表示する。
- Project workspaceは`IssuesView`または同じ操作部品を使い、固定Project scopeを指定する。
- `/inbox`は説明パネル、既存Notification list、未読数、既読化、対象遷移を表示する。
- Inboxは「すべて / 未読」タブで表示を切り替え、各行に通知種別と既読 / 未読状態を表示する。通知行の末尾には対象を開く明示的な文言を置き、意味のない三点メニューは置かない。

### Project workspace state

UI draftはshared `ProjectIssueDisplaySettings`と1対1で対応する。選択変更は即時に表示へ反映し、250ms debounce後に既存Project PATCHへ保存する。Project workspaceの`upcoming` Due Filterは今日より後の期限をすべて対象とし、Homeの「7日以内」表示とは別の意味にする。

- 保存成功: Bootstrap cacheのrecordを更新し、「表示設定を保存しました」を補助表示する。
- 保存中: 対象workspaceの設定操作をdisabledにし、保存中表示を出す。
- 保存失敗: draftは保持し、Error alertとRetryを出す。409はBootstrap再取得後に最新値を表示する。
- Project scope: `projectId`をUI側の固定条件とし、表示設定のfilterへ別Project IDを保存しない。
- 完了表示OFF: Workflow categoryが`completed`のIssueだけを除外する。Canceledは残す。

### Home contents

上から順に次を表示する。

1. 今日の概要（表示名・Timezone基準の日付・新規Issue導線）
2. 期限超過、今日、7日以内の期限Issue
3. Current Cycleの進捗と未完了Issue
4. 最近更新されたIssue（`updatedAt`降順）
5. Projectの進捗・期限への導線

期限・Issueが0件の場合は空メッセージとIssues / Createへの導線を表示する。

### Inbox contents

Inbox冒頭に次の説明を表示する。

> Inboxは、期限やCycleなどOrbitからのお知らせを確認する場所です。通知を開くと既読になり、関連するIssue・Cycle・Projectへ移動できます。

通知行には種別、タイトル、本文、作成日時、未読状態を表示する。通知0件の場合は、Inboxの用途説明とIssuesを見る導線を表示する。既存の「すべて既読」と個別クリックによる既読化・対象遷移は維持する。

## このレイヤーが依存する下位の契約

- service `GET /api/v1/bootstrap`、Project PATCH display preference、既存Issue PATCH / Bulk / Reorder、既存Notification API。
- shared display settings、Issue view model、Workflow / Label / Project view model。

## 実装配置

- `src/components/home.ts`: Home summary、期限分類、最近更新選択。
- `src/components/issue-list.ts`: Project scope、Status / Due filter、既存完了判定・sortとの共通関数。
- `src/components/OrbitApp.tsx`: HomeView、IssuesViewの再利用、ProjectsViewの専用詳細、Inbox guidance、保存状態。
- `src/styles.css`: Home sections、Project workspace toolbar、Inbox guidance、responsive / state styles。
- `src/components/home.test.ts`、`src/components/project-workspace.test.ts`、既存UI test: 表示・操作・状態検査。

## UI/UX 方針

- **画面フロー / 導線**: HomeのIssueはIssue詳細へ、Current CycleカードはCyclesへ、Projectカードは専用Project detailへ遷移する。Project detailにはProjectsへ戻る明示導線を置く。Inboxの通知は既存対象へ遷移し、対象なし通知はInboxに留める。
- **主要操作とフィードバック**: Project Issue workspaceのFilter / sort / List・Board / 完了表示は即時反映し、サーバー保存はdebounceする。Issue属性更新・Bulk・Reorderは既存optimistic / rollback / retryを再利用する。表示設定の保存失敗は設定を成功扱いにせず、Retryを提示する。
- **状態設計（出し分け）**: Bootstrap loadingは既存loading、Project不存在はNot Found、Project Issue 0件はscope説明付きEmpty、Homeの各section 0件は個別Empty、保存中はdisabled、400 / 409 / 423 / 500は既存alert / toastとRetry、成功はcache反映と補助Toastとする。
- **既存デザインシステムとの整合**: `page-heading`、`detail-card`、`toolbar`、`filter-select`、`view-toggle`、`issue-row`、`issue-card`、`bulk-bar`、`detail-live-error`、`EmptyState`、既存color themeを再利用する。Project専用の別Issue listを複製しない。

### レスポンシブ / アクセシビリティ

- Desktop `>=1200px`はProject headerとIssue toolbarを高密度に並べ、KeyboardでFilter、表示切替、選択、Bulk、並び替えを実行できる。
- Tablet `768..1199px`はtoolbarを折り返し、Project概要とIssue workspaceを縦方向に配置する。必須操作をHoverだけに隠さない。
- Mobile `<=767px`はProject詳細をFull screen相当の1列へし、toolbarは複数行またはSheet相当で表示する。Boardは既存の横スクロール方針を使い、390pxでページ全体の横overflowを作らない。
- HomeのカードとInbox説明は1列化し、Issue rowのタップ領域は44px以上とする。
- Status、Priority、未読、完了非表示は色だけに依存せず、ラベル・アイコン・`aria-label`を併用する。Dialog / Menu / Checkboxは既存のFocus ring、Escape、Keyboard操作を維持する。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| Project不存在 / Owner外 | Project detail全体をNot Foundにし、Projectsへ戻る導線を表示する |
| 表示設定400 | draftを保持し、該当設定のError alertを表示する |
| 表示設定409 | draftを成功確定せず、Bootstrap再取得後にConflictを表示する |
| 表示設定423 | draftを成功確定せず、既存Run Overlay / Retryを表示する |
| Home / Inbox 0件 | sectionごとの説明と次の操作を表示し、空の白領域だけにしない |
| 500 / Timeout | 既存表示を保持できる場合は保持し、Retryを表示する |

## テストケース（技法注記付き）

- [代表値] Homeに表示名・Timezone日付・期限超過 / 今日 / 7日以内・Current Cycle・最近更新が正しい順で表示される。
- [境界値] 期限が今日の開始直前、今日、7日目、7日目の翌日にあるIssueをそれぞれ正しいsectionへ分類する。
- [デシジョンテーブル] Project display `showCompleted=true / false` × completed / canceled / activeで、completedだけが除外される。
- [代表値] Project card → `/projects/:projectId`で一覧下埋め込みではなく専用詳細とProject scoped workspaceを表示する。
- [状態遷移] Project settings change → debounce save success → 別Bootstrapで同じdraftを復元する。
- [状態遷移/失敗系] settings save 400 / 409 / 423 / 500でdraft保持、ConflictまたはRetryを表示する。
- [代表値] Project workspaceのStatus / Priority / Project / Due / Bulk / Reorder操作が既存Issue APIへ正しいscopeで接続する。
- [代表値] Inbox説明、通知種別・本文・未読状態、個別既読、すべて既読、対象遷移、0件案内を表示する。
- [アクセシビリティ] Tab / Enter / Spaceと390 / 768 / 1200pxで主要操作と横overflowなしを確認する。
