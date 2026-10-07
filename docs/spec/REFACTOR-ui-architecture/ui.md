# REFACTOR-ui-architecture: ui 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: 既存の 12 ページ URL（`/`, `/inbox`, `/search`, `/views`, `/cycles`, `/cycles/$cycleId`, `/issues`, `/issues/$issueId`, `/projects`, `/projects/$projectId`, `/settings`, `/settings/$section`）と各 `validateSearch` の search params は、移行後も同じページコンポーネントを描画し、同じ正規化結果になる。
- **AC-2**: 表示中の画面とナビゲーションの選択状態（`aria-current`）はルーターの現在地だけから決まり、`src/routes`・`src/features`・`src/components`（テストを除く）に `section` の useState・`getInitialSection`・`location.pathname` の解析は存在しない。サイドバー / MobileNav / CommandPalette の画面遷移は URL を変え、その URL に対応する画面が表示される。
- **AC-3**: ページ間を遷移しても AppShell（Sidebar / MobileNav / ToastRegion / CommandPalette / RunOverlay / IssueComposer）の DOM ノードは同一のまま保たれる。遷移前に表示した Toast は表示開始から 3,500ms で消え、遷移によって延長も消去もされない。作成中の Composer 入力は遷移後も保持される。
- **AC-4**: `/issues` と `/issues/$issueId` の間を開閉・切替しても Issue 一覧の DOM ノードは同一のまま保たれ、フィルタと選択を保持する。詳細を閉じるとフォーカスは開いた行のトリガーへ戻り、`sessionStorage` は使わない。別ページへ遷移して戻ると選択は空になる。
- **AC-5**: `src/routes`・`src/features`・`src/components`・`src/lib`（テストを除く）に `as never` は存在せず、ルーター遷移（`navigate` / `<Link>`）の `to` / `params` / `search` は `tsc` の型検査を受ける。
- **AC-6**: TanStack Query のキーは `queryKeys` ファクトリ経由で生成され、形状は現行どおり（`["bootstrap"]`、`["issues", scope]`、`["issue-detail", id]`、`["recent"]`）。Issue 更新の反映は `syncIssueCaches` だけが担い、一覧のインライン更新・詳細保存のどちらでも bootstrap / `["issues", active|archived|trash]` / `["issue-detail", id]` の所属が更新後の archivedAt・deletedAt と一致する。
- **AC-7**: 各 Phase の前後で、Phase 0 開始時に記録したテスト名一覧（ベースライン）の全テストが同名で存在して pass し（ベースラインで fail 済みの `scripts/local.test.mjs` の EACCES テスト 1 件を除く）、`skip` / `only` / `todo` は 0 件である。描画方法を変えたテストは、変更前後の assert を PR の対応表で 1 対 1 に示し、各 assert が同じ matcher かより強い検証へ置き換わっている。
- **AC-8**: 移行完了時、`src/components/OrbitApp.tsx` は存在せず、`src/features/` と `src/components/ui/` の各 `.ts` / `.tsx`（テストを除く）は 800 行以下で、静的 import と re-export は ui.md の依存方向表の許可リストだけに従う（動的 `import()` なし）。

## このレイヤーが公開する契約（外部インターフェース）

### ルーティング（URL は不変・ファイル構成だけ変える）

| 操作 | パス | ルートファイル | 描画 | validateSearch |
|------|------|---------------|------|---------------|
| 変更 | (root) | `src/routes/__root.tsx` | `<html>` + `QueryClientProvider` + `AppShell` > `<Outlet/>` | — |
| 変更 | `/` | `index.tsx` | `features/home/HomePage` | — |
| 変更 | `/inbox` | `inbox.tsx` | `features/inbox/InboxPage` | — |
| 変更 | `/search` | `search.tsx` | `features/search/SearchPage` | — |
| 変更 | `/views` | `views.tsx` | `features/views/ViewsPage` | `normalizeViewSearch`（不変） |
| 変更 | `/cycles` / `/cycles/$cycleId` | `cycles/index.tsx` / `cycles/$cycleId.tsx` | `features/cycles/CyclesPage`（`cycleId` は `Route.useParams`） | — |
| 追加 | `/issues`（layout） | `issues.tsx` | `features/issues/IssuesPage` + `<Outlet/>`。`validateSearch: normalizeIssueSearch` をここへ移す | `normalizeIssueSearch`（不変） |
| 変更 | `/issues/` | `issues/index.tsx` | `null`（一覧は親が描画） | 親から継承 |
| 変更 | `/issues/$issueId` | `issues/$issueId.tsx` | `features/issues/IssueDetailOverlay` | 親から継承 |
| 変更 | `/projects` / `/projects/$projectId` | `projects/index.tsx` / `projects/$projectId.tsx` | `features/projects/ProjectsPage` | `normalizeProjectSearch`（不変） |
| 変更 | `/settings` / `/settings/$section` | `settings/index.tsx` / `settings/$section.tsx` | `features/settings/SettingsPage`（`$section` は現行どおり未使用） | — |

- ナビゲーション項目の対応は `features/shell/navigation.ts` の 1 か所で定義する: `{ id: "home"|"issues"|…, to: "/"|"/issues"|…, label, icon }`。現在地は `useMatchRoute()` で判定する（`fuzzy: true`）。
- `navigate(next)` が行っていた「Issues へ遷移するとき `completed` を既定値で補う」処理は、`<Link to="/issues" search={{ completed: completedFallback }}>` として navigation 定義に持たせる。
- ページ遷移時の選択解除（現 `setSelected([])`）は、選択 state を IssuesPage / ProjectsPage のローカル state に移すことで自然に満たす。

### AppShell が提供する context（features から使う公開フック）

| フック | 返り値 | 用途 | 現行の対応 |
|---|---|---|---|
| `useToast()` | `{ showToast(kind, message, action?) }` | 全 feature の成功・失敗通知 | `OrbitApp.tsx` の `useToast` / `ToastRegion` |
| `useIssueComposer()` | `{ open(options?: { projectId?: string; parentId?: string; cycleId?: string }) }` | Home / Issues / Projects / Cycles / CommandPalette からの新規作成 | `openIssueComposer` と Composer の state（`:328-334`） |
| `useCommandPalette()` | `{ open() }` | ショートカット・ヘッダー | `commandOpen` |
| `useClockNow()` | `number`（1 分ごと更新） | 期限・相対日付の表示 | `clockNow`（`:386-397`） |
| `useBackgroundRun()` | 既存フックをそのまま AppShell で 1 回だけ起動し、`run` / `busy` を context で配る。引数は AppShell が読む `bootstrap.background.run`、`onSucceeded` は `queryKeys.bootstrap` の invalidate（現行 `:686-696` と同じ） | Settings の Manual Run・RunOverlay | `:681-696` |
| `useShortcut(action, handler)` | 登録解除関数 | ページ固有のショートカット（Issues の `toggle-board` 等・`close` 時の選択解除） | `:702-802` の keydown effect |

- キーボードショートカット（`issue-core-ui.ts` の `shortcutActionFor`）の配置:
  - 共通の抑止条件（IME 変換中、入力欄・select・combobox 上の判定は `shortcutActionFor` に従う、Background Run が pending / running、Composer / CommandPalette / Project 作成モーダル / ショートカット一覧の表示中）は現行（`OrbitApp.tsx:702-728`）と同じ条件を AppShell の 1 か所で判定し、ページ側のハンドラは AppShell から `useShortcut(action, handler)` で登録する（抑止判定を重複させない）。
  - AppShell: `command`（⌘/Ctrl+K）・`create`（c）・`help`（?）・`focus-search`（⌘/Ctrl+F）・`close`（Esc）。CommandPalette・ショートカット一覧・Composer は表示中にショートカット自体が抑止されるため、Esc で閉じる処理は現行どおり各ダイアログの dialog-boundary が担う。`close` は登録されたページ側ハンドラ（Issue 一覧の選択解除。bulk 実行中は解除しない）だけを呼ぶ（現行 `OrbitApp.tsx:735-739` の `setCommandOpen(false)` / `setShortcutsOpen(false)` は抑止条件により到達しないため移植しない）。`focus-search` は現行どおり、`/issues` では一覧のテキストフィルタ、`/search` では `#global-search-input` にフォーカスし、それ以外では `/search` へ遷移してから検索入力にフォーカスする（現在地は `useMatchRoute` で判定）。
  - Issue 一覧部品（IssuesPage・Projects 詳細の一覧）: `toggle-board`（⌘/Ctrl+B）・`focus-display`（Shift+V）・`focus-filter`（f）は現行どおり `/issues` でだけ効く。`toggle-selection`（x）はフォーカス中の Issue がある一覧で効く。
  - 単一キー ON/OFF の localStorage 設定（`orbit.singleKeyShortcuts`）は現行どおり。
- `document.title`・テーマ適用・`html lang`・beforeinstallprompt・ServiceWorker 登録は AppShell の effect に置く。

### データ層（`src/lib/queries/`）

```ts
// src/lib/queries/keys.ts — 形状は現行と同一（テストがこの形でキャッシュを仕込む）
export const queryKeys = {
  bootstrap: ["bootstrap"] as const,
  issues: (scope: IssueListScope) => ["issues", scope] as const,
  issueDetail: (id: string) => ["issue-detail", id] as const,
  recent: ["recent"] as const,
  // 前方一致で 3 scope の一覧をまとめて invalidate する（bulk・lifecycle 変更・trash の後。現行どおり）
  issuesAll: ["issues"] as const,
};

// src/lib/queries/bootstrap.ts
export function useBootstrap<T>(select: (data: BootstrapPayload) => T): UseQueryResult<T>;
// feature 側の例: const issues = useBootstrap((data) => data.issues).data ?? EMPTY_ISSUES;

// src/lib/queries/issue-cache.ts — Issue 更新の唯一の反映口（AC-6）
export function syncIssueCaches(queryClient: QueryClient, updated: Issue): void;
// bootstrap.issues: active なら置換/追加、archived・trash なら除去
// ["issues", "active" | "archived" | "trash"]: 所属 scope だけに置換/追加し、他 scope から除去
// ["issue-detail", updated.id]: 存在すれば issue を置換
// キャッシュに無い Issue は配列の末尾に追加する（現行の詳細保存の同期と同じ。既存テスト「409/Scope所属」が固定）
// Issue 作成（createIssue）は「更新の反映」ではないため対象外とし、現行どおり呼び出し側で bootstrap の先頭に追加する（Phase 2 実装中に人間と合意）
// 楽観更新（onMutate）と失敗時のロールバックは「反映」ではないため対象外（現行どおり呼び出し側に置く）
export function removeIssueFromCaches(queryClient: QueryClient, issueId: string): void; // trash 後（UI に Issue の purge 操作は無い）
// trash 後は removeIssueFromCaches の後に queryKeys.issuesAll を invalidate し、ゴミ箱一覧を再取得する（現行どおり）
```

- feature 別の mutation 関数は `src/features/<domain>/mutations.ts` に置く（例: `useIssueMutations()` が create / update / reorder / bulk / lifecycle / notes / relations を返す）。既に `useMutation` のもの（Issue create / update / reorder）はそのまま移す。それ以外を `useMutation` へ書き換えることは本 spec の対象外。
- 冪等キーの保持は、現行 9 か所の `*MutationKeyRef` を `useMutationKey()`（`src/lib/queries/mutation-key.ts`）に集める。
  - 入力比較型の 4 か所（Cycle schedule / preference / cycleSettings / Workflow）は、現行の比較対象（patch の JSON・signature）をそのまま signature に渡す。
  - 保持型の 5 か所（bulk / display / label / 現行名 `mutationKeyRef` の 2 か所）は、現行どおり入力に関係なくキーを保持するため、呼び出し箇所ごとの固定文字列を signature に渡す（例: `keyFor("bulk")`。Gate 1 で決定・挙動不変）。
  - `keyFor` はキーを保持し、どの結果でキーを捨てるか（`reset()`）は現行の分岐のまま呼び出し側に置く。
- Phase 2 では `src/lib/queries/*` を作り `OrbitApp.tsx` 内の呼び出しを置き換えるまでとし、`features/<domain>/mutations.ts` への移動は Phase 4 で行う。

```ts
// 同じ signature（入力の canonical JSON）の再試行では同じキーを返し、signature が変わるか reset() で新しいキーになる
export function useMutationKey(): { keyFor(signature: string): string; reset(): void };
```

- 409 / 423 / `IDEMPOTENCY_KEY_REUSED` の分岐と `saving` の扱いは、呼び出し側ごとに Toast 文言や再取得が異なるため共通化しない（現行どおり各 feature に置く）。
- 全体再取得 `refresh()` は `queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })` に統一する。現行（`OrbitApp.tsx:804`）も `["bootstrap"]` の invalidate だけなので、キーの出どころを変えるだけで挙動は同一。呼び出す箇所（Cycle close / start、Project 作成・並べ替え、bulk、通知など）は現行と同じにする。

### ディレクトリ構成（Phase 5 完了時）

```
src/
  routes/                       # 画面ルートは features の Page を描画するだけ
  features/
    shell/      AppShell.tsx, Sidebar.tsx, MobileNav.tsx, CommandPalette.tsx, RunOverlay.tsx,
                IssueComposer.tsx, navigation.ts, shortcuts.ts, context.tsx
    home/       HomePage.tsx, home.ts
    issues/     IssuesPage.tsx, IssueList.tsx（一覧本体。Projects 詳細からも使う）, IssueRow.tsx, IssueCard.tsx, IssueDetailOverlay.tsx,
                IssueDetailPanel/（Panel.tsx, Notes.tsx, Relations.tsx, Properties.tsx）,
                mutations.ts, issue-list.ts, issue-hierarchy.ts, issue-helpers.ts
    cycles/     CyclesPage.tsx, CycleIssueCard.tsx, CycleBreakdownSection.tsx, mutations.ts, cycle-breakdown.ts
    projects/   ProjectsPage.tsx, mutations.ts, project-workspace.ts
    search/     SearchPage.tsx, useIssueSearch.ts
    inbox/      InboxPage.tsx, mutations.ts
    views/      ViewsPage.tsx, SavedViewFilters.tsx, SavedViewResults.tsx, saved-views.ts
    settings/   SettingsPage.tsx, WorkflowSettingsCard.tsx, LabelSettingsCard.tsx, mutations.ts
  components/ui/                # feature に依存しない部品
    Modal.tsx, EmptyState.tsx, PriorityIcon.tsx, Toast.tsx, OrbitSelect.tsx, OrbitDatePicker.tsx,
    OrbitIcon.tsx, LinkifiedText.tsx, options.tsx（priority / state / project / cycle の <option>）,
    date-format.ts（formatDate 系。暦日は shared/issue-dates を再利用）, dialog-boundary.ts,
    useKeyboardReorderFocus.ts, browser-storage.ts
  lib/
    queries/    keys.ts, bootstrap.ts, issue-cache.ts, mutation-key.ts
    api-client.ts, query.ts, url-state/
```

### 依存方向（AC-8）

| from \ to | components/ui | lib | shared | features/issues | 他 features | features/shell |
|---|---|---|---|---|---|---|
| components/ui | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| features/issues | ✓ | ✓ | ✓ | ✓ | ✗ | context フックのみ |
| features/projects | ✓ | ✓ | ✓ | `features/issues/IssueList.tsx` と `features/issues/mutations.ts` のみ（現 ProjectsView → IssuesView と同じ関係） | ✗ | context フックのみ |
| 他 features | ✓ | ✓ | ✓ | ✗ | ✗ | context フックのみ |
| features/shell | ✓ | ✓ | ✓ | `features/issues/mutations.ts` のみ（IssueComposer の create） | ✗ | ✓ |
| routes | — | — | — | Page のみ | Page のみ | `AppShell` のみ |

- `context フックのみ`: `features/shell/context.tsx` の `useToast` / `useIssueComposer` / `useCommandPalette` / `useClockNow` / `useBackgroundRun` / `useShortcut`。shell の画面部品を feature から import しない。
- 許可リストは上表がすべて。検査は静的 import と re-export を対象にし、動的 `import()` は使わない。`routes` → `features/*` は各 Page と `features/shell/AppShell.tsx` だけを許可する。

## このレイヤーが依存する下位の契約（呼び出す相手）

- `/api/v1/**`（変更なし）。`src/lib/api-client.ts` の `apiGet` / `apiPost` / `apiPatch` / `apiDelete` / `apiRequest`。
- `src/shared/contracts`・`src/shared/view-models`・`src/shared/issue-dates`（変更なし）。

## 実装配置（Phase 別）

| Phase | 主な変更ファイル | 完了条件 |
|---|---|---|
| 0 | `scripts/test-baseline.mjs`（新規: `vitest --reporter=json` からテスト名一覧を出力し、ベースライン JSON と突合。`skip` / `only` / `todo` を検出）と `scripts/test-baseline.json`（`package.json` に `test:baseline` を追加）、`src/components/render-app.test-fixtures.ts`（新規: `renderApp({ url, container, seed?, strict? })` が本番 `routeTree`・`createMemoryHistory` で `container` に描画する。jsdom と fetch のスタブは各テストが用意する。`seed(client)` は clear の後・描画の前にキャッシュを仕込む〔キャッシュ有無が前提のテスト 3 例が根拠〕。`strict` は StrictMode で包む〔StrictMode の effect 二重実行を検証する既存テスト用〕。root コンポーネントだけはテスト内で `Outlet` に差し替える〔`__root` の `<html>` を div 内に描画すると React が入れ子の警告を出すため。head は `pwa.test.ts` が検証〕。QueryClient は現行 OrbitApp がモジュールのシングルトンを使うため、Phase 0 では描画前後の `queryClient.clear()` で分離する）、OrbitApp を描画する runtime テスト 22 本の描画部分、`detail-select-size.test.ts` | ベースライン突合が一致。各テストの assert 対応表を PR に記載。`vi.mock("@tanstack/react-router")` は View 単体テストだけに残る |
| 1 | `src/components/ui/*`（新規。OrbitApp.tsx 内の部品のみ切り出し、既存の独立ファイル〔orbit-select / orbit-date-picker / orbit-icon / linkified-text / dialog-boundary〕の ui/ への移動は Phase 5）、`OrbitApp.tsx` から該当部品を削除して import に置換し、テストが import している export は OrbitApp から再 export | 見た目・DOM 不変。日付 helper の重複（`dateInputValueInTimeZone` ↔ `calendarDateKeyInTimeZone`、`formatDateOnly` ↔ `formatIssueDueDate`）を出力一致テストで確認してから統合 |
| 2 | `src/lib/queries/*`（新規）、`OrbitApp.tsx` の useQuery / setQueryData / `*MutationKeyRef` | AC-6 と `useMutationKey` のテスト追加。キャッシュ操作が `syncIssueCaches` / `removeIssueFromCaches` / `queryKeys` に集約 |
| 3 | `src/routes/__root.tsx`、`src/routes/issues.tsx`（新規 layout）、全画面ルート、`src/routeTree.gen.ts`（生成物）、`features/shell/*`（新規）、`docs/architecture.md` | AC-1〜AC-5 のテスト追加。`section` / `getInitialSection` / `orbit.issue-focus` を削除。`docs/architecture.md` のレイヤー表を更新 |
| 4 | `features/<domain>/*`（1 PR 1〜2 domain）、`OrbitApp.tsx` は再 export のみへ縮小 | 各 domain 移動後も既存テスト pass |
| 5 | `OrbitApp.tsx` 削除、既存の独立 UI ファイル（orbit-select / orbit-date-picker / orbit-icon / linkified-text / dialog-boundary / issue-priority）の `components/ui/` への移動〔Phase 1〜4 の間 `components/ui` がこれらを `../` で参照するのは移行中の暫定として許容〕、テストの import 更新、`docs/ai-dlc/codekb/shared.md` | AC-8 の計測（`wc -l`・import 方向）を Gate 3 で提示 |

## UI/UX 方針

- **画面フロー / 導線**: 現行と同一。URL 直アクセス・ブラウザの戻る/進む・通知からの遷移・CommandPalette からの遷移はすべて URL 経由になる。
- **主要操作とフィードバック**: 現行と同一（Toast の文言・undo/retry、楽観更新、409 時の再取得）。
- **状態設計（出し分け）**:
  - 初期 / ローディング: Bootstrap 未取得時は現行と同じ全画面 loading。
  - 空: 各ページの EmptyState は現行の文言・導線のまま。
  - エラー: 初回失敗は全画面エラー + 再試行、再取得失敗はバナー（現行どおり）。
  - 成功: Toast（現行どおり）。
- **意図した改善（挙動差）**: ページ遷移で AppShell が再マウントされなくなるため、Toast と Composer 入力が遷移をまたいで残る（AC-3）。Issue 詳細の開閉で一覧が再マウントされなくなる（AC-4）。一覧のインライン更新でもアーカイブ・ゴミ箱の一覧キャッシュが同期される（AC-6）。
- **既存デザインシステムとの整合**: クラス名・DOM 構造は変えない（styles.css と CSS テストへの影響をなくすため）。Modal の 5 つの独自実装は、初期フォーカスや `DIALOG_ITSELF` の扱いが異なるので Phase 1 では統合しない。統合は振る舞いテストを足したうえで別 spec とする。

### レスポンシブ / アクセシビリティ

- 対象端末・ブレークポイント（〜767px / 768〜1023px / 1024〜1199px / 1200px〜）・タブレットとスマホの方針は現行のまま変えない。CSS は変更しない。
- MobileNav の 5 列構成・Menu シート・フィルタシートの挙動は現行どおり。
- a11y: `aria-current` は現在地から算出する（AC-2）。dialog-boundary（初期フォーカス・Tab トラップ・Escape・フォーカス復帰・inert）は既存実装をそのまま使う。Issue 詳細を閉じたときのフォーカス復帰は、一覧が再マウントされないので ref だけで行う（AC-4）。

## 異常系挙動

| シナリオ | 本レイヤーの挙動 |
|---|---|
| 存在しない `issueId` / `projectId` / `cycleId` | 現行どおり（Issue 詳細は「Issueが見つかりません」と閉じる導線、Project / Cycle は「Projectが見つかりません」「Cycleが見つかりません」の見出し） |
| 不正な search params | `validateSearch` の正規化（現行と同一）で既定値へ寄せる |
| Bootstrap 取得失敗 | 「エラー・ログ方針」の表どおり |
| `/settings/$section` の未知の section | 現行どおり Settings を表示（`$section` は未使用） |
| Mutation の 409 / 423 / IDEMPOTENCY_KEY_REUSED | 各 feature が現行と同じ Toast・再試行を行う。冪等キーの再利用・更新は `useMutationKey` が現行と同じ規則で行う |

## テストケース（技法注記付き）

Phase ごとの PR で追加する。既存テストは全件を回帰テストとして維持する（AC-7）。jsdom の制約として、レイアウト計算・実スクロール・`inert` の完全な挙動は検証範囲外とし、DOM ノードの同一性と `document.activeElement` で観測する。非同期の遷移は `act` + `findBy*` / `waitFor` で待つ。

AC-7（Phase 0 で先に整備し、以後の全 Phase で実行）:
- [代表値] `scripts/test-baseline.mjs record` が Phase 0 開始時の main で `scripts/test-baseline.json`（ファイルパス + describe + it 名の一覧、fail 済みテスト名の一覧）を出力する
- [同値分割] 突合: ベースラインと同名・同数 → 合格 / テストが 1 件消えた → 不合格（消えた名前を表示）/ 新規テストの追加 → 合格 / ベースライン外の fail → 不合格
- [同値分割] 実行結果が skipped / pending / todo のテストがある（`it.skip`・`describe.skip`・`it.todo` と、`it.only` による他テストの除外を含む）→ 不合格
- [境界値] it.each 等で同名のテストが複数ある ID は件数で突合する: 2 件 → 1 件に減ったら不合格 / 2 件のままなら合格
- [代表値] `renderApp` が本番 `routeTree` を使う: 描画後の `router.routeTree` が `routeTree.gen` の export と同一参照
- [代表値] `renderApp` の描画前に `queryClient` のキャッシュが空になり、`unmount` 後も空になる（キャッシュがテスト間で漏れない）。別インスタンス化は AppShell が QueryClient を持つ Phase 3 で行い、そのときこのケースを「2 回の呼び出しで別インスタンス」に置き換える
- [代表値] `renderApp` で描画した画面で `console.error` が呼ばれない（root を `Outlet` に差し替えた効果の確認）
- [代表値] `seed` で仕込んだキャッシュ（fetch スタブと異なる Bootstrap）が描画に使われる
- [代表値] `strict: true` は `followup-shell-runtime.test.ts` の StrictMode 計測テストで検証する（`strict` を無視する改変で同テストが fail することを確認済み）
- [代表値] 描画方法を移した 22 本は、PR の対応表（変更前 assert → 変更後 assert、matcher 名）で 1 対 1 に対応する。`toBeTruthy` / `toBeDefined` への置き換えは不可（人間がレビューで確認）

Phase 1（AC-7 の一部）:
- [境界値] `dateInputValueInTimeZone` と `calendarDateKeyInTimeZone` が同じ出力: UTC 日付境界の前後（23:59:59.999 / 00:00:00.000）× Timezone（`Asia/Tokyo` / `UTC` / `America/Los_Angeles`）で一致を確認してから統合する
- [同値分割] `formatDateOnly(value)`: 値あり → `formatIssueDueDate(value)` と同一出力 / `null` → 「未設定」（`formatIssueDueDate` は null を受けないため、`null` 分岐だけを持つ薄いラッパーにする）

Bootstrap の状態表示（Phase 3・AppShell 化の回帰）:
- [状態遷移] 取得中 → 全画面 loading（Sidebar なし）/ 初回失敗 → エラー画面 → 再試行で成功 → 通常画面。現行の `cycle-history.test.ts` の「Bootstrapのloading/error/retry導線」3 テストが担保し、Phase 0 で `renderApp` 描画へ移したうえで、Sidebar が描画されていないことの assert を追加する
- [代表値] キャッシュありの再取得失敗 → 画面を維持したまま非ブロッキングのバナーと再試行

AC-1（Phase 3）:
- [同値分割] 12 URL それぞれ → 対応するページの見出しが表示される（期待値は Phase 3 着手前に現行アプリで描画した `h1` テキストを固定値として書く）
- [同値分割] 存在しない `/issues/<id>`・`/projects/<id>`・`/cycles/<id>` → それぞれ「Issueが見つかりません」「Projectが見つかりません」「Cycleが見つかりません」、未知の `/settings/<section>` → Settings
- [代表値] `/issues?status=all&order=updated_desc&completed=false` → `status`・`order` が除去され `completed: false` の一覧
- [代表値] 子ルートが親の正規化を継承: `/issues/<id>?status=all&completed=false` → 詳細が開き、背後の一覧は `completed: false`・`status` 除去で描画される
- [代表値] `/projects?active=true`・`/views?<既存 saved view の search>` → 現行と同じ正規化結果
- [代表値] `/issues/<存在するID>` を直接開く → 一覧の上に詳細オーバーレイが開く

AC-2（Phase 3）:
- [ペアワイズ] 起点（Sidebar / MobileNav / MobileMenuSheet / CommandPalette）× 行き先（8 ページ）: 各起点と各行き先が少なくとも 1 回ずつ現れる 8 ケース → URL・表示ページ・`aria-current` が一致
- [同値分割] 子ルート `/issues/<id>`・`/cycles/<id>`・`/projects/<id>`・`/settings/<section>` → 親のナビ項目だけが `aria-current="page"`
- [代表値] memory history の back → 前のページと `aria-current` に戻る
- [デシジョンテーブル] ⌘/Ctrl+F（`focus-search`）× 現在地（`/issues` / `/search` / その他）→ 一覧フィルタにフォーカス / 検索入力にフォーカス / `/search` へ遷移して検索入力にフォーカス
- [デシジョンテーブル] `toggle-board`・`focus-display`・`focus-filter` × 現在地（`/issues` / `/projects/<id>` / `/`）→ `/issues` でだけ効き、他では何も起きない
- [デシジョンテーブル] Esc × 状態（CommandPalette 表示 / ショートカット一覧表示 / Issue 一覧で選択あり・bulk 実行中でない / 選択あり・bulk 実行中）→ パレットが閉じ選択は残る / 一覧が閉じ選択は残る / 選択が空になる / 選択が残る
- [代表値] `/issues` で Issue 行にフォーカスして `x`（`toggle-selection`）→ 選択に追加、もう一度 `x` → 選択から外れる
- [デシジョンテーブル] ショートカット（`c`）× 抑止条件（IME 変換中 / Background Run が running / Composer 表示中 / CommandPalette 表示中 / Project 作成モーダル表示中 / ショートカット一覧表示中 / なし）→ 抑止条件のいずれかがあれば無視、なしなら Composer が開く
- [代表値] リポジトリ検査: `src/routes`・`src/features`・`src/components`（テスト除く）に `setSection` / `getInitialSection` / `location.pathname` が 0 件（コメント行も対象。`src/lib/api-client.ts` の 401 処理は対象ディレクトリ外）

AC-3（Phase 3）:
- [代表値] Sidebar / MobileNav / ToastRegion / CommandPalette / RunOverlay / IssueComposer のルート要素が、`/` → `/issues` → `/settings` の遷移前後で同一参照（`toBe`）。この検査は Phase 3 着手時に現行構造で RED になることを確認する
- [境界値]（fake timers）Toast 表示 → 3,000ms 後に別ページへ遷移 → 3,499ms 時点で表示されている → 3,500ms で消える
- [状態遷移] Composer に入力 → 閉じずに別ページへ遷移 → Composer が開いたまま入力が残る

AC-4（Phase 3）:
- [状態遷移] 一覧で 2 件選択・フィルタ入力 → 詳細を開く → 閉じる → 一覧の行要素が同一参照、選択・フィルタが保持され、`document.activeElement` が開いた行のタイトルボタン
- [状態遷移] `/issues/A` → `/issues/B` へ直接切替 → 一覧の行要素が同一参照、詳細は B
- [状態遷移] 詳細を開く → memory history の back → 詳細が閉じ、一覧は保持
- [状態遷移] 一覧で選択 → `/projects` → `/issues` → 選択が空
- [代表値] サイドバーから `/issues` へ遷移すると、search に `completed` の既定値（`completedFallback`）が入る
- [代表値] 開閉の間に `sessionStorage.setItem` が `orbit.issue-focus` で呼ばれない（スパイで確認）

AC-5（Phase 3）:
- [代表値] リポジトリ検査: `src/routes`・`src/features`・`src/components`・`src/lib` の非テスト `.ts` / `.tsx` に `as never` が 0 件（コメント行も対象）
- [代表値] `pnpm typecheck` が pass（`to` / `params` / `search` の型検査）

AC-6（Phase 2）:
- [デシジョンテーブル] `syncIssueCaches` × (`archivedAt`, `deletedAt`) = (null, null) → active / (値, null) → archived / (null, 値) → trash / (値, 値) → trash。各ケースで bootstrap・3 scope・detail の所属を確認
- [状態遷移] 更新前の所属（active / archived / trash）× 更新後の所属（active / archived / trash）の 9 遷移 → 旧 scope から消え、新 scope にだけ存在する
- [同値分割] キャッシュ未作成（bootstrap なし / scope なし / detail なし）→ 未作成のキャッシュは作らない
- [同値分割] キャッシュに無い Issue（scope 間の移動で初めて入る）→ 所属 scope と bootstrap（active のとき）の末尾に追加される
- [代表値] `removeIssueFromCaches` → bootstrap と 3 scope から消え、detail キャッシュが削除される
- [代表値] 一覧のインライン更新でアーカイブ → `["issues","archived"]` に入り、`["issues","active"]` と bootstrap から消える
- [代表値] 詳細保存でゴミ箱へ移した Issue → `["issues","trash"]` に入り、他から消える
- [代表値] `queryKeys` の各キー（`issuesAll` を含む）が現行リテラルと deepEqual
- [代表値] 詳細からゴミ箱へ移した後、bootstrap と detail キャッシュから消え、`["issues", …]` が invalidate される（ゴミ箱一覧の再取得）

`refresh()`（Phase 2）:
- [代表値] Cycle close 成功後に `invalidateQueries` が `queryKeys.bootstrap` だけで呼ばれ、`["issues", …]`・`["issue-detail", …]`・`["recent"]` は invalidate されない（`queryClient.invalidateQueries` のスパイで確認。現行も同じ挙動なので Phase 2 着手時に現行で GREEN になることを確認してから置換する）

`useMutationKey`（Phase 2）:
- [状態遷移] 同じ signature で 2 回 `keyFor` → 同じキー / signature 変更 → 新しいキー / `reset()` 後に同じ signature → 新しいキー
- [代表値] 再レンダー後も保持したキーが変わらない（`useRef` 相当）
- [代表値] 既存 9 か所の置換後も、409 / 423 / `IDEMPOTENCY_KEY_REUSED` を扱う既存テスト（ベースラインに含まれる）が pass

AC-8（Phase 5）:
- [境界値] 行数検査関数の自己検証: 800 行 → 合格 / 801 行 → 不合格
- [代表値] `src/features/**` と `src/components/ui/**` の非テスト `.ts` / `.tsx` がすべて 800 行以下、`src/components/OrbitApp.tsx` が存在しない
- [同値分割] 依存方向検査関数の自己検証: 許可リスト内の import → 合格 / 表の ✗ に当たる import → 不合格 / re-export 経由の ✗ → 不合格 / 動的 `import()` → 不合格
- [代表値] リポジトリ全体で依存方向検査が 0 件
