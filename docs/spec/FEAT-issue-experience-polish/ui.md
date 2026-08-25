# FEAT-issue-experience-polish: ui契約

## 担保 AC（[index.md](./index.md) の引用）

- **AC-1**: PCの新規Issue composerでIME変換中にEnterを押してもIssueを作成せず、変換確定後のEnterで1回だけ作成する。Shift + Enterは改行として扱い、既存の空タイトル拒否を維持する。
- **AC-2**: IssuesのList表示でPriorityを文字バッジではなく、No priority / Low / Medium / High / Urgentを識別できるアイコンで表示する。アイコンには画面読み上げ用のPriority名を付け、既存のインライン更新操作は維持する。
- **AC-3**: IssuesのList表示でOrderを「手動」にすると、Issueをドラッグ＆ドロップで別の位置へ移動でき、移動後の順序がBootstrap再取得・再読み込み後も保持される。Board表示は既存のList / Board共通Orderに従うが、Board内のDnD操作は追加しない。
- **AC-4**: 手動順の変更はOwner境界、Issue version、Runtime lock、冪等性を既存のMutation規約に従って検証し、競合・ロック・不正入力時は業務データを部分更新しない。ListではKeyboardの上移動・下移動も利用できる。
- **AC-5**: SettingsのAppearanceで既存の表示モード（Light / Dark / System）とは別に、Coral / Ocean / Violet / Forest / Amberからカラーテーマを1つ選択でき、選択値がユーザー設定として保存・再取得される。初期値はCoralとする。
- **AC-6**: 選択したカラーテーマがデスクトップ、タブレット、スマートフォンの主要画面へ反映され、390px幅で横overflowを発生させない。テーマ保存の400 / 423 / 500系失敗時は選択を確定せず、既存のエラー通知・再試行導線を表示する。既存のProject詳細（`/projects/:projectId`）は引き続き利用できる。

## このレイヤーが公開・利用する契約

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 初期データ | `GET /api/v1/bootstrap` | `issues.position`、`preferences.colorTheme`を含むBootstrap | 既存Owner境界 | List / Settingsの初期表示 |
| 手動順変更 | `POST /api/v1/issues/reorder` | `issueId`、`version`、`beforeIssueId` | 既存Owner / lock / idempotency | ListのDnD・上移動・下移動 |
| 外観保存 | `PATCH /api/v1/preferences` | `colorTheme: ColorTheme` | 既存Owner / lock / idempotency | カラーテーマの保存 |

## 実装配置

- `src/components/OrbitApp.tsx`: IME-aware composer、PriorityIcon表示、List DnD / Keyboard reorder、colorTheme更新とBootstrap cache反映。
- `src/components/issue-list.ts`: manual sort、DnDの挿入先・Keyboard移動の純粋関数。
- `src/components/issue-list.test.ts` / `src/components/issue-priority.test.ts`: reorder / icon labelの単体テスト。
- `src/components/theme.ts`: colorThemeの解決とCSS datasetの契約。
- `src/components/theme.test.ts`: 5 paletteと表示モードの解決テスト。
- `src/styles.css`: Priority icon、drag state、colorTheme CSS variables、responsive settings。

## UI/UX 方針

- **画面フロー / 導線**: Issue composerのタイトルtextareaはEnterで作成、Shift+Enterで改行する。Issues toolbarのOrderで「手動」を選ぶとList rowのDnDと上／下ボタンを有効にし、Boardは同じOrderを表示するがDnD操作を表示しない。Settings > Appearanceに表示モードとカラーテーマを分けて表示する。
- **主要操作とフィードバック**: DnD / 上下移動は成功後にBootstrapを再取得して順序を確定し、成功Toastを表示する。失敗時は順序を確定せず、既存Issue mutationと同じ競合・lock・Retry表示を使う。テーマは選択時に楽観反映せず、API成功後にdatasetとPreferences cacheを更新する。
- **状態設計（出し分け）**: 初期Bootstrap中は既存loading、手動順の移動中は対象rowと上下操作をdisabled、0件は既存EmptyState、400 / 404 / 409 / 423 / 500はToastまたはalertで表示する。IME変換中は作成せず入力値を維持する。
- **既存デザインシステムとの整合**: 既存`filter-select`、`issue-row`、`priority-badge`の配置、`button`、`toast`、`settings-card`、`resolveTheme`を再利用する。Priorityのアイコン自体は新しい共有UI部品として1つだけ追加する。

### レスポンシブ / アクセシビリティ

- Desktop >=1200pxはListのdrag handleと上下操作をIssue列の前に置く。Tablet 768..1199pxは既存tableの折返しを維持し、Mobile <=767pxはDnDに依存せず上／下ボタンで同じ順序変更を実行する。
- 390pxでtoolbar、settings row、priority icon、row操作が横にはみ出さない。カラーテーマswatchは可視名を併記する。
- Priority iconは`aria-label`または`role="img"`の名前を持ち、selectの`aria-label`も維持する。DnDには上／下のKeyboard代替を必ず提供し、フォーカスリングを消さない。
- 色テーマ・Priority・Statusは色だけで判断できないよう、Priority名のaccessible name、テーマ名、Status名をテキスト／支援技術へ提供する。

## 異常系挙動

| シナリオ | 本レイヤーの挙動 |
|---|---|
| IME composing中のEnter | `preventDefault`もsubmitも行わず、変換確定をブラウザへ渡す |
| 空タイトル / Shift+Enter | 空タイトルはsubmitしない。Shift+Enterは改行し、APIを呼ばない |
| Reorder 409 | 現在のdrag stateを解除し、Bootstrapを再取得して最新順を表示する |
| Reorder 423 / 500 | 順序を確定せず、エラーToastにRetryを表示する |
| colorTheme 400 / 423 / 500 | 選択済み保存値を維持し、選択中のdraftを戻してRetryを表示する |
| Project detail | `/projects/:projectId`の既存詳細表示・編集導線を変更しない |

## テストケース（技法注記付き）

- [状態遷移] `isComposing=true`のEnter → submitしない、`isComposing=false`のEnter → 1回だけsubmitする。
- [状態遷移] Shift+Enter → 改行、API呼び出しなし。
- [境界値] 空白だけのtitle → submitしない。1文字title → 既存作成処理へ渡す。
- [同値分割] 5 Priorityすべて → 固有のiconとaccessible labelが返る。
- [代表値] manual orderでrowをdrop → `beforeIssueId`が正しく計算され、成功後に表示順が更新される。
- [境界値] 先頭の上移動 / 末尾の下移動 → disabledまたはNo-op、順序不変。
- [状態遷移/失敗系] reorder 409 / 423 / 500 → 順序を確定せず、最新値またはRetryを表示する。
- [同値分割] Coral / Ocean / Violet / Forest / Amber → datasetへ反映される。
- [状態遷移/失敗系] colorTheme保存成功 → BootstrapとCSS dataset更新、失敗 → 保存済み値を維持。
- [アクセシビリティ] Tab / Enterで上下移動、Priority名の読み上げ、390 / 768 / 1200pxで横overflowなし。

`src/components/issue-experience.test.ts`は、現行Vitest Node環境で実行できるUI構造スモークとして、Reorder成功後refresh、409 Retryのlatest version、colorThemeのdataset / draft rollback、ARIA属性、responsive CSS、既存Project routeを確認する。実ブラウザ操作は任意Browser Smokeで補完する。
