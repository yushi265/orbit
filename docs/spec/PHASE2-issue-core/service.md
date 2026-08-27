# PHASE2-issue-core: service 詳細設計

## 担保 AC

- **AC-1**: 本人がIssue作成・一覧・詳細からEstimate（未設定 / `1 / 2 / 3 / 5 / 8`）とDue date（未設定または日付）を設定・解除でき、親Issueを同一OwnerのIssueへ設定・解除できる。ServerはEstimate / Due dateの値域、親のOwner・削除状態・自己参照・子孫参照を検証し、循環する親子関係を400で拒否する。Issue詳細は親Issue、直下のSub-issue、Completed / Canceledを考慮した子Issue進捗を返す。
- **AC-2**: 本人がIssueをArchiveでき、通常一覧から除外されたArchived Filterで確認・Restoreできる。Trashへ移動したIssueは通常一覧とArchived Filterから除外され、Settings配下のTrashで確認・Restoreできる。Archive / Trash / RestoreはOwner・Lock・冪等性を既存契約どおり守り、他Owner・不存在・削除済み対象では業務データを変更しない。
- **AC-3**: 全体検索はIssue ID・title・descriptionを対象に、300msデバウンス後にStatus / Priority / Project / Cycle / Label / Dueの既存Filterを適用して検索できる。検索結果はOwner scopedで、削除済み・Archived Issueを含めず、入力不正・通信失敗時は現在の入力と結果を壊さず再試行できる。
- **AC-4**: 最近開いたIssueと最近の検索条件をOwner単位で保存し、各20件まで新しい順に表示する。同じIssueまたは正規化済み検索条件は時刻だけを更新し、削除済みIssueは表示しない。再読み込み・別端末のSnapshot再取得後も復元でき、保存失敗は検索・画面遷移を妨げない。
- **AC-6**: AC-1〜AC-5の正常系・400 / 404 / 409 / 423 / 500・Owner境界・version競合・同一Key再送を、shared / data / service / UIのテストで担保する。既存Issue CRUD、Detail、Label / Bulk、Project割り当て、手動並び替え、Background Run lockの挙動を退行させない。

## このレイヤーが公開する契約（外部インターフェース）

| Method | Path | Request / Query | Success |
|---|---|---|---|
| GET | `/api/v1/issues?scope=active\|archived\|trash` | 既存Issue query + optional scope | `200 { items: IssueViewModel[] }` |
| GET | `/api/v1/search` | `q`, `status`, `priority`, `project`, `cycle`, `label`, `due`, `limit` | `200 { items: IssueViewModel[] }` |
| POST | `/api/v1/recent-issue-views` | `{ idempotencyKey, issueId }` | `200 { recentIssueView: RecentIssueView }` |
| POST | `/api/v1/recent-searches` | `{ idempotencyKey, query }` | `200 { recentSearch: RecentSearch }` |
| GET | `/api/v1/recent` | — | `200 { issueViews, searches }` |
| GET | `/api/v1/issues/:issueId` | — | `200 { issue, parent, children, childProgress, notes, relations, activity }` |

Existing `POST /api/v1/issues/:id?action=archive|restore|trash` and `PATCH /api/v1/issues/:id` remain the lifecycle / attribute mutation入口。全MutationはOwner、`X-Requested-With`、idempotency、Runtime lockを既存のHTTP境界で検証する。

Search queryは次へ変換する。

```text
q → filter.text
status / priority / project / cycle / label / due → existing IssueFilter
scope omitted → active
limit → 1..100 (server cap 500 for existing list)
```

## このレイヤーが依存する下位の契約

- `shared.md`のIssue scope、Issue hierarchy response、Search / Recent schema
- `data.md`の`OrbitStore.listIssues`、hierarchy、Recent操作
- `src/server/http.ts`のOwner / ErrorEnvelope / requestId

## 実装配置

- `src/server/api.ts`: query parser、scope list、hierarchy response、Search / Recent handlers
- `src/routes/api/v1/issues/index.ts`: scope query配線
- `src/routes/api/v1/recent.ts`: Recent GET route
- `src/routes/api/v1/recent-issue-views.ts`: Issue view POST route
- `src/routes/api/v1/recent-searches.ts`: Search POST route
- `src/routes/api/v1/search.ts`: existing Search GET routeはFilter付きへ拡張
- `src/shared/contracts/index.ts`: serviceが使うschema export

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| Request query / body不正 | 400 `VALIDATION_ERROR` + fieldErrors。Storeへ到達しない |
| Issue / parent / recent issue不在・Owner外 | 404 `RESOURCE_NOT_FOUND`。存在推測可能な詳細を返さない |
| archived / trash scopeへの不正なLifecycle操作 | 状態に応じた400または404。対象外の業務効果なし |
| Version競合 | 409 `ISSUE_VERSION_CONFLICT`。勝者以外は副作用なし |
| Background lock | 423 `OPERATION_IN_PROGRESS`。Issue / Recentを書き込まない |
| Recent保存のSnapshot障害 | 500 + requestId。UIはbest effortで本体操作を継続 |
| Search D1 / Snapshot障害 | 500 + requestId。raw query・本文・Tokenをログへ出さない |

## テストケース（技法注記付き）

- [デシジョンテーブル] Issue scope active / archived / trash × archivedAt / deletedAtをAPI responseで検証する。
- [代表値] Searchのqだけ、q + 各属性Filter、q空文字、limit境界を検証する。
- [デシジョンテーブル] Searchがactive Owner Issueだけを返し、Archived / Trash / 他Ownerを除外する。
- [状態遷移] Recent issue view POST → GET recent → Snapshot再読込で同じ順序を検証する。
- [状態遷移] Recent search POST → 同一canonical query再送 → max20 trimを検証する。
- [デシジョンテーブル] Recentの同一Key同一Request / 異なるRequestを200 replay / 409で検証する。
- [代表値] Detail APIがparent / children / childProgressと既存notes / relations / activityを同時に返す。
- [デシジョンテーブル] Owner不一致、未認証、lock中、Snapshot障害を401 / 404 / 423 / 500へ変換する。
