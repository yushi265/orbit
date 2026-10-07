# REFACTOR-ui-architecture: UI層の再設計（実ルーティング化・OrbitApp 分割）

## 概要

`src/components/OrbitApp.tsx`（9,439 行・35 コンポーネント）に集中した UI を、TanStack Router の実ルーティング（共通 AppShell + `<Outlet/>`）と `src/features/<domain>/` 単位のファイルへ段階的に移す。URL・API・見た目・操作は変えない。本 spec は目標構造・契約・段階移行計画を定め、実装は Phase ごとの後続ボルトで行う。

## 対象範囲

- 対象レイヤー: ui のみ（[ui.md](./ui.md)）。service / data / shared の契約は変更しない。
- 対象ドメイン: shell（ナビゲーション・Toast・Composer・CommandPalette・Background Run）、home / issues / cycles / projects / search / inbox / views / settings
- 対象外（やらないこと）:
  - API の分割・変更（Bootstrap 単一 API を維持）
  - URL・search params の変更
  - 見た目・文言・操作手順の変更（AC-3 / AC-4 の「再マウントしない」改善と AC-6 のキャッシュ同期の統一を除く）
  - `styles.css` の分割・トークン化（別 spec）
  - `src/server/` の OrbitStore 分割（監査 P3。別 spec）

## ユニット計画

単一ユニット（UI 再設計）を 6 Phase に分けて実装する。Phase ごとに 1 PR を目安とし、PR 単位は各 Gate 3 で人間が決める。

| # | Phase | 含む AC | 依存 | 状態 |
|---|-------|--------|------|------|
| 0 | テスト基盤: ベースライン記録・実ルーター描画 helper へ移行 | AC-7 | — | 完了（PR #26） |
| 1 | ui-shared 抽出（Modal / EmptyState / PriorityIcon / Toast / 日付・選択肢 helper） | AC-7 | 0 | 完了（PR #28） |
| 2 | データ層: queryKey ファクトリ・feature 別 hook・Issue キャッシュ同期の一本化 | AC-6, AC-7 | 0 | 着手 |
| 3 | AppShell + 実ルーティング（`section` 廃止・Issues レイアウトルート） | AC-1〜AC-5, AC-7 | 1, 2 | 未着手 |
| 4 | feature 分割（home → inbox → search → views → settings → cycles → issues → projects） | AC-7, AC-8 | 3 | 未着手 |
| 5 | 後片付け（OrbitApp barrel 削除・docs/architecture.md と codekb 更新） | AC-8 | 4 | 未着手 |

## 受け入れ基準（AC）

- [ ] **AC-1**: 既存の 12 ページ URL（`/`, `/inbox`, `/search`, `/views`, `/cycles`, `/cycles/$cycleId`, `/issues`, `/issues/$issueId`, `/projects`, `/projects/$projectId`, `/settings`, `/settings/$section`）と各 `validateSearch` の search params は、移行後も同じページコンポーネントを描画し、同じ正規化結果になる。
- [ ] **AC-2**: 表示中の画面とナビゲーションの選択状態（`aria-current`）はルーターの現在地だけから決まり、`src/routes`・`src/features`・`src/components`（テストを除く）に `section` の useState・`getInitialSection`・`location.pathname` の解析は存在しない。サイドバー / MobileNav / CommandPalette の画面遷移は URL を変え、その URL に対応する画面が表示される。
- [ ] **AC-3**: ページ間を遷移しても AppShell（Sidebar / MobileNav / ToastRegion / CommandPalette / RunOverlay / IssueComposer）の DOM ノードは同一のまま保たれる。遷移前に表示した Toast は表示開始から 3,500ms で消え、遷移によって延長も消去もされない。作成中の Composer 入力は遷移後も保持される。
- [ ] **AC-4**: `/issues` と `/issues/$issueId` の間を開閉・切替しても Issue 一覧の DOM ノードは同一のまま保たれ、フィルタと選択を保持する。詳細を閉じるとフォーカスは開いた行のトリガーへ戻り、`sessionStorage` は使わない。別ページへ遷移して戻ると選択は空になる。
- [ ] **AC-5**: `src/routes`・`src/features`・`src/components`・`src/lib`（テストを除く）に `as never` は存在せず、ルーター遷移（`navigate` / `<Link>`）の `to` / `params` / `search` は `tsc` の型検査を受ける。
- [ ] **AC-6**: TanStack Query のキーは `queryKeys` ファクトリ経由で生成され、形状は現行どおり（`["bootstrap"]`、`["issues", scope]`、`["issue-detail", id]`、`["recent"]`）。Issue 更新の反映は `syncIssueCaches` だけが担い、一覧のインライン更新・詳細保存のどちらでも bootstrap / `["issues", active|archived|trash]` / `["issue-detail", id]` の所属が更新後の archivedAt・deletedAt と一致する。
- [ ] **AC-7**: 各 Phase の前後で、Phase 0 開始時に記録したテスト名一覧（ベースライン）の全テストが同名で存在して pass し（ベースラインで fail 済みの `scripts/local.test.mjs` の EACCES テスト 1 件を除く）、`skip` / `only` / `todo` は 0 件である。描画方法を変えたテストは、変更前後の assert を PR の対応表で 1 対 1 に示し、各 assert が同じ matcher かより強い検証へ置き換わっている。
- [ ] **AC-8**: 移行完了時、`src/components/OrbitApp.tsx` は存在せず、`src/features/` と `src/components/ui/` の各 `.ts` / `.tsx`（テストを除く）は 800 行以下で、静的 import と re-export は ui.md の依存方向表の許可リストだけに従う（動的 `import()` なし）。

## アーキテクチャ / レイヤー間フロー

```
src/routes/__root.tsx      <html> + QueryClientProvider + <AppShell><Outlet/></AppShell>
  ├─ index.tsx             → features/home/HomePage
  ├─ issues.tsx (layout)   → features/issues/IssuesPage + <Outlet/>
  │    ├─ issues/index.tsx → null（一覧のみ）
  │    └─ issues/$issueId.tsx → features/issues/IssueDetailOverlay
  ├─ cycles/…, projects/…, search, inbox, views, settings/… → 各 features/*Page
  └─ api/v1/**             （変更なし）

features/* ──▶ lib/queries（queryKeys・useBootstrap・mutation hooks）──▶ lib/api-client ──▶ /api/v1（不変）
features/* ──▶ components/ui（Modal・EmptyState・PriorityIcon・Toast・options・date-format）
features/shell ──▶ features/*（ページ非依存の Composer・CommandPalette のみ。逆方向禁止）
```

## エラー・ログ方針（横断サマリ）

| シナリオ | ui の挙動 |
|---|---|
| Bootstrap 初回取得中 | 現行と同じ全画面の loading 表示（「Orbitを準備しています…」）。AppShell はデータ到着まで Sidebar 等を描画しない |
| Bootstrap 初回取得失敗 | 現行と同じエラー画面と再試行ボタン（`bootstrap.refetch()`） |
| Bootstrap 再取得失敗（キャッシュあり） | 現行どおりキャッシュを表示し、非ブロッキングのエラーバナーと再試行 |
| Mutation 失敗 | 現行どおり Toast（409/423/IDEMPOTENCY_KEY_REUSED の分岐・undo/retry 含む） |
| 401 | 現行どおり `api-client` が再ログインへ遷移 |

ログ出力は追加しない。

## テスト戦略

| AC | 単体 | レイヤー内結合（jsdom + 実ルーター） |
|----|------|--------------|
| AC-1 | `normalizeIssueSearch` 等の既存単体テスト | `renderApp({ url })` で 12 URL と異常系 URL を描画 |
| AC-2 | リポジトリ検査テスト（禁止パターン 0 件） | 起点 × 行き先・子ルートの `aria-current`・ショートカット |
| AC-3 | — | AppShell 6 部品のノード同一性・Toast の期限（fake timers）・Composer 入力 |
| AC-4 | — | 詳細の開閉・切替・戻る・存在しない ID・ページ往復での選択解除 |
| AC-5 | リポジトリ検査テスト（`as never` 0 件）＋ `pnpm typecheck` | — |
| AC-6 | `queryKeys`・`syncIssueCaches`・`removeIssueFromCaches` の単体テスト | 一覧インライン更新・詳細保存の両経路 |
| AC-7 | ベースライン突合スクリプト（テスト名一覧・skip/only/todo 検出） | 既存全テスト |
| AC-8 | リポジトリ検査テスト（行数・依存方向。検査関数自体を境界値で自己検証） | — |

ケース詳細は [ui.md](./ui.md) の「テストケース」節。

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `lib/url-state/issues.ts`（search 正規化）、`background-run.ts`（useBackgroundRun）、`dialog-boundary.ts`、`orbit-select.tsx` / `orbit-date-picker.tsx`、`issue-list.ts` 等の純粋関数、`shared/issue-dates.ts`。
- 差分: `section` の二重管理・各ルートでの OrbitApp 再マウント・sessionStorage によるフォーカス受け渡しを廃止する。
- 衝突:
  - 一覧のインライン更新（`OrbitAppInner.updateIssue`）は `["issues", scope]` を同期せず、詳細保存（`IssueDetailPanel.applyUpdatedIssue`）は 3 scope を同期している。AC-6 で後者（上位互換）に一本化する。
  - テスト 22 本が `<OrbitApp initialSection>` を直接描画し、うち 15 本は `@tanstack/react-router` を `Link`/`useRouter` だけモックしている。実ルーティング化でこれらは動かなくなるため、Phase 0 で実ルーター描画 helper へ移す。`issues-url-runtime.test.ts` など 7 本は既に実ルーター（独自ツリー）で描画しており、helper はこの方式を本番 `routeTree` に置き換えて一般化する。
  - `detail-select-size.test.ts` が `styles.css` を文字列で検査している（PR #23 以後に追加）。Phase 0 で `css-rules.test-fixtures.ts` へ置換する。

## 実装に効く制約

- 各 Phase の PR は「見た目・操作の差分なし」を前提に、既存テストを弱めない（AC-7）。
- 新しい抽象化は Rule of Three を満たすものだけ: `queryKeys`（キー直書き 20 か所超）、`useMutationKey`（`*MutationKeyRef` 9 か所）、`syncIssueCaches`（Issue 差し替え 6 か所）、`renderApp`（OrbitApp 描画テスト 22 本）、options helper（`<option>` 生成 20 か所超）。
- `docs/architecture.md` のレイヤー表（ui = `src/routes/` `src/components/`）に `src/features/` を加える更新は Phase 3 の PR に含め、Phase 3 の完了条件とする（設計方針の変更のため、Phase 3 の Gate 1 で再確認する）。
- ルート追加に伴う `src/routeTree.gen.ts` の再生成は手で編集せず、`pnpm dev` / `vite build` の生成結果をコミットする。

## 判断根拠 / 未決事項

- **AppShell の置き場所は `__root.tsx`**: pathless レイアウト（`_app.tsx`）を挟む案はファイル移動が増えるだけで利点が無いため却下。API ルートはコンポーネントを描画しないので影響しない。
- **Issue 詳細は `/issues` レイアウトの子ルート**: 一覧と詳細を兄弟ルートのまま残す案は、詳細の開閉で一覧が再マウントされる現状を固定してしまうため却下。URL は変わらない。一覧の状態が保持される点は「操作の改善」として AC-4 に明記する。
- **Bootstrap は単一 API のまま、feature 別 hook は `select` で切り出す**（Gate 1 決定）: API 分割は service 契約の変更で、本 spec の規模を超える。
- **Query key の形状は変えない**: テストがキー形状で直接データを仕込んでおり、形状変更は AC-7 の検証を不必要に揺らすため。
- **冪等キーは `useMutationKey` に集約し、`useMutation` のラッパーは作らない**: 既存の mutation の大半は `apiPost` 直呼び + `*MutationKeyRef` で、共通しているのは「同じ入力の再試行では同じキー」という鍵管理だけ。409 / 423 の分岐は呼び出し側で文言が異なるため共通化しない。
- **Issue キャッシュ同期は 3 scope 同期に統一**: 一覧のインライン更新でアーカイブ等が反映されない現状は不整合であり、詳細保存側の挙動が上位互換。挙動差はこの 1 点だけで、AC-6 のテストで固定する。
- **OrbitApp.tsx は Phase 4 の間 barrel として残す**: テストの import（約 18 種の export）を 1 PR ごとに書き換えずに済む。Phase 5 で削除する。
- **テスト基盤を先に作る（Phase 0）**: 実ルーティング化と同じ PR でテスト描画方法を変えると、回帰と書き換えミスを区別できないため。
- 未決事項: なし（URL 完全互換・API 不変・spec のみのボルト・Gate 2 委任は Gate 1 で確定）。
