# PHASE2-issue-core: Issue core 不足機能の完了

## 概要

Phase 2「Issue core」のうち、先行実装で不足しているIssue属性・親子階層・ライフサイクル導線・検索履歴・Command / Shortcutを完成させる。既存のIssue CRUD、Detail、Label / Bulk、Project割り当て、手動順、Owner / Lock / Version / Receipt境界は再利用し、重複実装しない。

## 対象範囲

- 対象レイヤー: [shared.md](./shared.md)、[data.md](./data.md)、[service.md](./service.md)、[ui.md](./ui.md)
- 対象ドメイン: Issue属性、親子Issue、Issue lifecycle、検索、最近履歴、Command palette、Keyboard shortcut
- 対象外（やらないこと）:
  - Cycleの自動遷移・繰越、Project / Viewの新規機能、Inbox通知、Release hardening
  - 外部検索基盤・FTS5専用Migration・ページング基盤の新設
  - Rich Text HTML editor、ファイル添付、複雑なAND / OR Filter、Shift範囲選択
  - 既存のIssue CRUD / Detail / Label / Bulk / Project / reorderの再実装

## ユニット計画

| # | ユニット | 含むAC | 依存 | 状態 |
|---|---|---|---|---|
| 1 | Issue属性・親子階層 | AC-1 | 既存Issue契約 | 完了 |
| 2 | Issue lifecycle導線 | AC-2 | 既存archive / restore / trash API | 完了 |
| 3 | Search・Recent | AC-3, AC-4 | Unit 1のIssue summary | 完了 |
| 4 | Command・Shortcut | AC-5 | Unit 3の検索UI / Unit 1の選択状態 | 完了 |
| 5 | 縦断回帰 | AC-6 | Unit 1〜4 | 完了 |

## 受け入れ基準（AC）

- [x] **AC-1**: 本人がIssue作成・一覧・詳細からEstimate（未設定 / `1 / 2 / 3 / 5 / 8`）とDue date（未設定または日付）を設定・解除でき、親Issueを同一OwnerのIssueへ設定・解除できる。ServerはEstimate / Due dateの値域、親のOwner・削除状態・自己参照・子孫参照を検証し、循環する親子関係を400で拒否する。Issue詳細は親Issue、直下のSub-issue、Completed / Canceledを考慮した子Issue進捗を返す。
- [x] **AC-2**: 本人がIssueをArchiveでき、通常一覧から除外されたArchived Filterで確認・Restoreできる。Trashへ移動したIssueは通常一覧とArchived Filterから除外され、Settings配下のTrashで確認・Restoreできる。Archive / Trash / RestoreはOwner・Lock・冪等性を既存契約どおり守り、他Owner・不存在・削除済み対象では業務データを変更しない。
- [x] **AC-3**: 全体検索はIssue ID・title・descriptionを対象に、300msデバウンス後にStatus / Priority / Project / Cycle / Label / Dueの既存Filterを適用して検索できる。検索結果はOwner scopedで、削除済み・Archived Issueを含めず、入力不正・通信失敗時は現在の入力と結果を壊さず再試行できる。
- [x] **AC-4**: 最近開いたIssueと最近の検索条件をOwner単位で保存し、各20件まで新しい順に表示する。同じIssueまたは正規化済み検索条件は時刻だけを更新し、削除済みIssueは表示しない。再読み込み・別端末のSnapshot再取得後も復元でき、保存失敗は検索・画面遷移を妨げない。
- [x] **AC-5**: `Cmd/Ctrl + K`でCommand paletteを開き、入力したコマンドをArrow Up / Down・Enter・Escapeで操作できる。Navigation、Issue作成、検索、単一選択中Issueの詳細表示・Archive・選択解除を検索できる。`C`、`Cmd/Ctrl + F`、`F`、`Shift + V`、`Cmd/Ctrl + B`、`X`、`Esc`、`?`を提供し、入力欄・textarea・contenteditableフォーカス中は単一キーShortcutを発火させない。Shortcut表記はOSに応じて`⌘` / `Ctrl`を表示する。
- [x] **AC-6**: AC-1〜AC-5の正常系・400 / 404 / 409 / 423 / 500・Owner境界・version競合・同一Key再送を、shared / data / service / UIのテストで担保する。既存Issue CRUD、Detail、Label / Bulk、Project割り当て、手動並び替え、Background Run lockの挙動を退行させない。

## アーキテクチャ / レイヤー間フロー

```text
Issue list / detail / settings / command palette
  ├─ shared Zod contract + public view model
  ├─ GET /api/v1/issues?scope=...
  ├─ GET /api/v1/search?... ── POST /api/v1/recent-searches
  ├─ POST /api/v1/recent-issue-views ── GET /api/v1/recent
  └─ existing Issue PATCH / action routes
       ↓
Owner-scoped service boundary
  ├─ existing Version / Lock / Receipt / Activity / Outbox
  ├─ parent cycle / estimate / due validation
  └─ recent upsert + max 20 normalization
       ↓
OrbitStore Snapshot (D1 CAS)
  ├─ existing issues / hierarchy
  └─ optional recentIssueViews / recentSearches arrays
```

Recent履歴は既存のD1 Snapshot bridgeへ追加し、旧Snapshotに配列が無い場合は空配列として読み込む。既存の`recent_issue_views` / `recent_searches`正規化Schemaは変更せず、Phase 2ではSnapshotをMVPの永続化境界とする。

## エラー・ログ方針（横断サマリ）

| シナリオ | shared | data / service | 表示層の挙動 |
|---|---|---|---|
| Estimate / Due / parent入力不正 | strict contract + fieldErrors | 400、Issue / Activity / Outbox / Receipt不変 | 該当フィールドへエラー、入力保持 |
| 親の自己参照・子孫参照 | parentId contract | 400 `VALIDATION_ERROR` + `parentId` fieldError、副作用なし | 循環を作らずエラー表示 |
| Owner外・不存在・Archived / Trash境界 | scope / public summary | 404、対象外データを返さない | Not Foundまたは一覧へ戻る |
| Issue version競合 | 既存Update contract | 409、副作用なし | 最新値再取得、入力を確定しない |
| Background lock | 既存Mutation contract | 423、副作用なし | Overlay / Retryを維持 |
| Search / Recent保存障害 | response schema | 検索結果を壊さずrequestId付き500またはbest effort失敗 | 検索・遷移は継続し、履歴だけ省略 |
| Command入力・検索0件 | command state | API呼び出しなしまたは空結果 | Empty state、Arrow / Escapeを維持 |

PrivateなToken、Cookie、メールアドレス、内部mutation keyはResponse・Activity・Recent record・通常ログへ含めない。

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | 親子循環判定、日付 / Estimate mapper、進捗計算 | Store Update / Detail APIのOwner・値域・version・lock |
| AC-2 | scope filter mapper、lifecycle表示状態 | Issue scope API、archive / restore / trashのOwner・再送・lock |
| AC-3 | 検索Query正規化、デバウンス・Filter mapper | Search APIのFilter・Owner・Archived / Trash除外 |
| AC-4 | Recent upsert / max20 / canonical query | Snapshot round-trip、Recent APIのOwner・削除済み除外 |
| AC-5 | shortcut判定、command selection、OS表示 | UI runtimeのArrow / Enter / Escape / input guard / selected action |
| AC-6 | 既存契約回帰 | 全テスト・品質ゲート・production build |

正常系のUIは既存のVitest構造・JSDOM runtime smokeを一次証跡とし、実Access・実D1・実ブラウザの詳細計測はRelease hardeningへ残す。検索性能の300ms debounceはFake Timerで、API p95はPreview計測で確認する。

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `OrbitStore`のIssue Version / Lock / Receipt / Activity / Outbox、`src/shared/contracts/issues.ts`、Issue Detail、`IssuesView`、`CommandPalette`、`api-client`、D1 Snapshot CAS。
- 差分: Issueの`estimate` / `dueAt` / `parentId`検証・Detail hierarchy response、Issue scope query、Recent contract / Store state / API、検索FilterとKeyboard UIを追加する。
- 既存のarchive / restore / trash APIは維持し、UIと一覧scopeだけを追加する。外部APIの別名や重複Repositoryは作らない。
- `src/db/schema.ts`のRecent用テーブルは既存Migrationを再利用し、Snapshot bridgeに配列を追加して旧Snapshotとの後方互換を保つ。
- 既存の未コミット変更（`src/styles.css`のページモーション、`src/components/motion.test.ts`）は本ボルトの対象外として保持する。

## 実装に効く制約

- すべてのIssue・Recentは解決済みOwnerのIDでscopeし、BrowserへD1 Binding・Access JWT・内部Tokenを露出しない。
- Issue Mutationは既存の`version`、`idempotencyKey`、Runtime lock、Activity / Outbox / Receiptを必ず通る。Recent保存も同一Owner境界を使う。
- Parentは同一Ownerの未削除・未Archived Issueだけを受け付け、親自身または任意の子孫を親にできない。進捗は直下の未削除子Issueを対象にし、Canceledを分母から除外する。
- Archived / Trashのscopeは既定のactive一覧へ混入させない。SearchもArchived / Trashを除外する。
- Recentの上限はIssue view / Search各20件。正規化済み同一条件は重複させず、保存失敗は本体操作を止めない。
- Shortcutは単一キーだけ入力フォーカスを除外し、修飾キー操作とEscapeは既存のDialog / Overlay契約を壊さない。
- 390pxで横overflowを発生させず、主要操作は44px以上のPointer領域とvisible focusを持つ。

## 判断根拠 / 未決事項

- **RecentはSnapshotへ追加する**: 本番の既存永続化境界がOwner単位Snapshot CASであり、Recentだけ別D1書き込みにするとVersion競合・Owner境界・障害時の整合性が二重化するため。旧Snapshotには空配列を補完し、Migrationを増やさない。
- **Recent保存は明示POSTへ分離する**: Search / DetailのGETに副作用を持たせず、Service Workerや再検証による意図しない履歴更新を避けるため。履歴保存の失敗は本体の検索・遷移を妨げない。
- **Parent進捗は直下のみ・Canceled除外**: 再帰集計や循環グラフの複雑さを持ち込まず、Issue detailで説明可能な最小契約にする。深い階層の全体集計は対象外とする。
- **Lifecycle UIは既存APIを再利用する**: Archive / Restore / Trashの認可・冪等性を新Routeへ複製せず、一覧scopeとSettings Trashを表示層へ追加する。
- **Commandは既存paletteを拡張する**: 新しいMenuライブラリを導入せず、commands配列・active index・Focus管理だけで要件を満たす。
- 未決事項なし。Gate 1承認済みのPhase 2範囲を、上記契約でspec化してGate 2へ進む。
