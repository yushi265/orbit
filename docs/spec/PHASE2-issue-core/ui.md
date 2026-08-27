# PHASE2-issue-core: ui 詳細設計

## 担保 AC

- **AC-1**: 本人がIssue作成・一覧・詳細からEstimate（未設定 / `1 / 2 / 3 / 5 / 8`）とDue date（未設定または日付）を設定・解除でき、親Issueを同一OwnerのIssueへ設定・解除できる。ServerはEstimate / Due dateの値域、親のOwner・削除状態・自己参照・子孫参照を検証し、循環する親子関係を400で拒否する。Issue詳細は親Issue、直下のSub-issue、Completed / Canceledを考慮した子Issue進捗を返す。
- **AC-2**: 本人がIssueをArchiveでき、通常一覧から除外されたArchived Filterで確認・Restoreできる。Trashへ移動したIssueは通常一覧とArchived Filterから除外され、Settings配下のTrashで確認・Restoreできる。Archive / Trash / RestoreはOwner・Lock・冪等性を既存契約どおり守り、他Owner・不存在・削除済み対象では業務データを変更しない。
- **AC-3**: 全体検索はIssue ID・title・descriptionを対象に、300msデバウンス後にStatus / Priority / Project / Cycle / Label / Dueの既存Filterを適用して検索できる。検索結果はOwner scopedで、削除済み・Archived Issueを含めず、入力不正・通信失敗時は現在の入力と結果を壊さず再試行できる。
- **AC-4**: 最近開いたIssueと最近の検索条件をOwner単位で保存し、各20件まで新しい順に表示する。同じIssueまたは正規化済み検索条件は時刻だけを更新し、削除済みIssueは表示しない。再読み込み・別端末のSnapshot再取得後も復元でき、保存失敗は検索・画面遷移を妨げない。
- **AC-5**: `Cmd/Ctrl + K`でCommand paletteを開き、入力したコマンドをArrow Up / Down・Enter・Escapeで操作できる。Navigation、Issue作成、検索、単一選択中Issueの詳細表示・Archive・選択解除を検索できる。`C`、`Cmd/Ctrl + F`、`F`、`Shift + V`、`Cmd/Ctrl + B`、`X`、`Esc`、`?`を提供し、入力欄・textarea・contenteditableフォーカス中は単一キーShortcutを発火させない。Shortcut表記はOSに応じて`⌘` / `Ctrl`を表示する。
- **AC-6**: AC-1〜AC-5の正常系・400 / 404 / 409 / 423 / 500・Owner境界・version競合・同一Key再送を、shared / data / service / UIのテストで担保する。既存Issue CRUD、Detail、Label / Bulk、Project割り当て、手動並び替え、Background Run lockの挙動を退行させない。

## このレイヤーが公開する契約（外部インターフェース）

| 画面 / UI | 使用API | 表示・操作 |
|---|---|---|
| Issue composer / detail | existing Issue POST / PATCH | Estimate、Due date、Parentを入力・解除。保存成功はServer値で確定し、400 / 409 / 423はrollback + Retry |
| Issues list | `GET /api/v1/issues?scope=...`、existing lifecycle action | Active / Archived Filter、Archive / Restore。TrashはSettingsへ誘導 |
| Settings > Trash | `GET /api/v1/issues?scope=trash`、restore action | Trash一覧、Issue識別子・タイトル・削除時刻、Restore、空状態 |
| Search | `GET /api/v1/search?...`、`POST /api/v1/recent-searches`、`GET /api/v1/recent` | q入力、属性Filter、300ms debounce、結果・Recent searches・Recent issues |
| Issue open | `POST /api/v1/recent-issue-views` | 保存失敗を無視して既存のDetail遷移を実行 |
| Command palette | Navigation / Issue mutation callbacks | Arrow、Enter、Escape、選択Issue操作 |

## このレイヤーが依存する下位の契約

- `shared.md`のIssue detail / Search / Recent public schema
- `service.md`のAPI response / ErrorEnvelope / requestId
- 既存`OrbitApp`のQueryClient、optimistic update、Focus restore、Run Overlay

## UI/UX 方針

- **画面フロー / 導線**: IssuesのtoolbarにActive / Archived Filterを置き、SettingsにTrash入口を置く。Issue DetailではPropertiesにEstimate / Due / Parent、本文下にChild progressとSub-issue一覧を置く。Searchは検索入力の下にFilter、Recent、Resultsの順で表示する。
- **主要操作とフィードバック**: 属性変更は既存Issue PATCHのoptimistic updateを使う。Archive / Restore / Trashは既存actionを呼び、成功後にscopeの一覧を再取得する。検索は入力を保持し、通信失敗時は結果を消さずRetryを表示する。Recent保存失敗は画面遷移を止めない。
- **状態設計（出し分け）**: 初期は既存Issue snapshotを表示し、Detail / Search / RecentはSkeletonを表示する。0件は説明付きEmpty state、保存中は該当操作だけdisabled、400はfield error、404はNot Found、409は最新値再取得、423はRun Overlay、500 / OfflineはRetryとする。
- **既存デザインシステムとの整合**: 既存`toolbar`、`filter-select`、`detail-properties`、`button`、`modal-backdrop`、`EmptyState`、`ApiError`、Toast / Retryを再利用する。新規Menuライブラリや状態管理Storeは追加しない。

### レスポンシブ / アクセシビリティ

- Mobile `<=767px`は1列のDetail / Search / Trash、Tablet `768..1199px`は既存Sheet相当、Desktop `>=1200px`は既存Panel / 高密度Listを維持する。
- 390pxで横overflowを発生させず、Estimate / Due / Parentの入力は折り返し可能な1列にする。主要ButtonとShortcut操作領域は44px以上にする。
- Command paletteは`role="dialog"`、検索欄へlabel、候補へ`role="option"`相当の選択状態、Arrow / Enter / Escape、visible focusを持つ。単一キーはinput / textarea / contenteditable内で発火しない。
- Archive / Trash / Restore、Parent、Progress、Search Filterは色だけに依存せず、可視ラベルとARIA labelを付ける。

## 異常系挙動

| シナリオ | UI挙動 |
|---|---|
| Estimate / Due / Parent validation | 入力欄のfield error、送信前値を保持、未保存値を確定しない |
| Parent cycle / Owner外 | Parent変更をrollbackし、循環・対象なしを説明する |
| Archive / Restore / Trash 404 | 一覧を壊さず対象を除外し、Not Found / 最新再取得を提示 |
| Version conflict | 最新Issueを取得してDraftを保持し、明示Retryを提示 |
| Runtime lock | 入力を確定せずRun Overlayを表示。Logout / 再認証は既存例外を維持 |
| Search error / Recent error | Searchの入力・直前結果を保持してRetry。Recentだけ失敗した場合は無音または控えめなstatus |
| Command 0件 | Empty stateを表示し、Escapeで閉じる |

## テストケース（技法注記付き）

- [状態遷移] Composer / DetailのEstimate・Due・Parentを変更 → successでServer値を反映、解除でnullへ戻す。
- [デシジョンテーブル] Estimate disabled / enabled、Due未設定 / 設定済み、Parent未設定 / valid / cycle errorを表示する。
- [状態遷移] Active IssueをArchive → Archived Filterで表示 → Restore → Activeへ戻る。
- [状態遷移] IssueをTrash → Settings Trashへ表示 → Restore → Activeへ戻る。空Trashを表示する。
- [状態遷移] Search入力 → 300ms前はrequestなし → debounce後にFilter付きrequest → 結果を描画する。
- [失敗系] Search 400 / 500 / Offlineで入力と結果を保持しRetryを表示する。
- [状態遷移] Issue open / Search submitでRecentをbest effort記録し、GET recentの再読込結果を表示する。
- [状態遷移] Command open → query → Arrow Down / Up → Enterで候補を実行し、Escapeで閉じる。
- [デシジョンテーブル] Shortcut × target（body / input / textarea / contenteditable）で発火可否を検証する。
- [代表値] Mac / non-MacのShortcut表示、単一選択中IssueのOpen / Archive / Clear actionを検証する。
- [境界値] 390 / 768 / 1200pxの属性Editor、Search、Trash、Commandでoverflowなしを構造検証する。
