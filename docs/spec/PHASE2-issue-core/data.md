# PHASE2-issue-core: data 詳細設計

## 担保 AC

- **AC-1**: 本人がIssue作成・一覧・詳細からEstimate（未設定 / `1 / 2 / 3 / 5 / 8`）とDue date（未設定または日付）を設定・解除でき、親Issueを同一OwnerのIssueへ設定・解除できる。ServerはEstimate / Due dateの値域、親のOwner・削除状態・自己参照・子孫参照を検証し、循環する親子関係を400で拒否する。Issue詳細は親Issue、直下のSub-issue、Completed / Canceledを考慮した子Issue進捗を返す。
- **AC-2**: 本人がIssueをArchiveでき、通常一覧から除外されたArchived Filterで確認・Restoreできる。Trashへ移動したIssueは通常一覧とArchived Filterから除外され、Settings配下のTrashで確認・Restoreできる。Archive / Trash / RestoreはOwner・Lock・冪等性を既存契約どおり守り、他Owner・不存在・削除済み対象では業務データを変更しない。
- **AC-4**: 最近開いたIssueと最近の検索条件をOwner単位で保存し、各20件まで新しい順に表示する。同じIssueまたは正規化済み検索条件は時刻だけを更新し、削除済みIssueは表示しない。再読み込み・別端末のSnapshot再取得後も復元でき、保存失敗は検索・画面遷移を妨げない。
- **AC-6**: AC-1〜AC-5の正常系・400 / 404 / 409 / 423 / 500・Owner境界・version競合・同一Key再送を、shared / data / service / UIのテストで担保する。既存Issue CRUD、Detail、Label / Bulk、Project割り当て、手動並び替え、Background Run lockの挙動を退行させない。

## このレイヤーが公開する契約（外部インターフェース）

### Snapshot additions

```ts
interface RecentIssueViewRecord {
  id: string;
  userId: string;
  issueId: string;
  viewedAt: number;
}

interface RecentSearchRecord {
  id: string;
  userId: string;
  query: IssueSearchQuery;
  searchedAt: number;
}

interface OrbitStoreSnapshot {
  // existing fields
  recentIssueViews: RecentIssueViewRecord[];
  recentSearches: RecentSearchRecord[];
}
```

`fromSnapshot`は旧Snapshotの欠落フィールドを`[]`へ補完してから既存のSnapshot validationを行う。Owner scoped loadではRecent recordの`userId`もOwner一致を要求する。

### Store operations

| 操作 | 入力 | 結果 |
|---|---|---|
| `listIssues(userId, query, scope)` | `scope: active \| archived \| trash` | scopeに合うOwnerのIssueをposition / orderで返す |
| `getIssueHierarchy(userId, issueId)` | Issue ID | parent、直下children、childProgress |
| `recordRecentIssueView(userId, issueId, key)` | Owner / Issue / idempotency | Issueをupsertし、最新20件へtrim |
| `recordRecentSearch(userId, query, key)` | Owner / canonical query / idempotency | 同一queryをupsertし、最新20件へtrim |
| `listRecent(userId)` | Owner | Issue summaryとsearch recordを各20件で返す |

Recentのupsertは業務IssueのVersionを変更しないが、Runtime lock中は通常Mutationと同じく423として扱う。履歴保存の失敗をUIがbest effortで無視できるよう、API境界で本体操作と分離する。

## このレイヤーが依存する下位の契約

- `src/server/store.ts`のOwner / Runtime lock / Receipt / Activity / Outbox
- `src/db/repositories/store-snapshot.ts`のD1 Version CAS
- `src/shared/contracts/issues.ts`のIssue / Filter / Recent contract

## 実装配置

- `src/server/model.ts`: Recent record、hierarchy / recent public型、Issue scope型
- `src/server/store.ts`: parent cycle validation、Issue scope、hierarchy progress、Recent Map / arrays、Snapshot compatibility
- `src/server/store-session.ts`: Recent更新を含むSnapshot dirty判定（既存Version CASを再利用）
- `src/db/repositories/store-snapshot.ts`: SQL変更なし。JSON Snapshotをそのまま保存
- `src/db/schema.ts`: 既存Recent tableのSchemaは変更しない

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| 親が不存在・他Owner・Archived・Trash | 404 `RESOURCE_NOT_FOUND`、Issue / hierarchy / Recent不変 |
| 自己参照・子孫参照 | 400 `VALIDATION_ERROR` + `parentId` fieldError、Issue version / Activity / Outbox / Receipt不変 |
| Estimate / Dueの不正 | 400 `VALIDATION_ERROR`、Issue version不変 |
| scopeとOwnerの不一致 | Owner外を列挙せず、scope結果を空または404相当へ変換 |
| Recent同一Key再送 | 同一requestなら保存済みresponse、異なるrequestなら409 |
| RecentのSnapshot CAS競合 | 既存`D1_WRITE_CONFLICT`へ変換し、後続再取得を促す |
| 旧Snapshot | Recentを空配列で復元し、既存データの読込を失敗させない |

## テストケース（技法注記付き）

- [状態遷移] active Issueへparent設定 → detailのparent / children / progressへ反映 → parent解除。
- [デシジョンテーブル] parentが同一Owner active / 他Owner / archived / trash / 不存在 / 自分 / 子孫の各条件を検証する。
- [状態遷移] childrenのactive / completed / canceledを追加し、completed数・分母・percentを検証する。
- [同値分割 + 境界値] Estimateの許可値・不許可値、Dueの整数timestamp / 小数 / NaN / nullを検証する。
- [デシジョンテーブル] active / archived / trash scopeがOwner・deletedAt・archivedAtの組み合わせで正しく列挙される。
- [状態遷移] Recent issue viewを1件→同一件更新→21件追加し、重複なし・最大20件・新しい順を検証する。
- [状態遷移] Recent searchを同じcanonical queryで再記録し、1件の時刻更新になることを検証する。
- [代表値] Recent付きSnapshotの保存・読込と、Recent配列なし旧Snapshotの読込を検証する。
- [セキュリティ境界] Owner AのIssue / RecentをOwner Bのscope・detail・recent listから取得できないことを検証する。
