# PHASE2-issue-core: shared 詳細設計

## 担保 AC

- **AC-1**: 本人がIssue作成・一覧・詳細からEstimate（未設定 / `1 / 2 / 3 / 5 / 8`）とDue date（未設定または日付）を設定・解除でき、親Issueを同一OwnerのIssueへ設定・解除できる。ServerはEstimate / Due dateの値域、親のOwner・削除状態・自己参照・子孫参照を検証し、循環する親子関係を400で拒否する。Issue詳細は親Issue、直下のSub-issue、Completed / Canceledを考慮した子Issue進捗を返す。
- **AC-2**: 本人がIssueをArchiveでき、通常一覧から除外されたArchived Filterで確認・Restoreできる。Trashへ移動したIssueは通常一覧とArchived Filterから除外され、Settings配下のTrashで確認・Restoreできる。Archive / Trash / RestoreはOwner・Lock・冪等性を既存契約どおり守り、他Owner・不存在・削除済み対象では業務データを変更しない。
- **AC-3**: 全体検索はIssue ID・title・descriptionを対象に、300msデバウンス後にStatus / Priority / Project / Cycle / Label / Dueの既存Filterを適用して検索できる。検索結果はOwner scopedで、削除済み・Archived Issueを含めず、入力不正・通信失敗時は現在の入力と結果を壊さず再試行できる。
- **AC-4**: 最近開いたIssueと最近の検索条件をOwner単位で保存し、各20件まで新しい順に表示する。同じIssueまたは正規化済み検索条件は時刻だけを更新し、削除済みIssueは表示しない。再読み込み・別端末のSnapshot再取得後も復元でき、保存失敗は検索・画面遷移を妨げない。
- **AC-5**: `Cmd/Ctrl + K`でCommand paletteを開き、入力したコマンドをArrow Up / Down・Enter・Escapeで操作できる。Navigation、Issue作成、検索、単一選択中Issueの詳細表示・Archive・選択解除を検索できる。`C`、`Cmd/Ctrl + F`、`F`、`Shift + V`、`Cmd/Ctrl + B`、`X`、`Esc`、`?`を提供し、入力欄・textarea・contenteditableフォーカス中は単一キーShortcutを発火させない。Shortcut表記はOSに応じて`⌘` / `Ctrl`を表示する。
- **AC-6**: AC-1〜AC-5の正常系・400 / 404 / 409 / 423 / 500・Owner境界・version競合・同一Key再送を、shared / data / service / UIのテストで担保する。既存Issue CRUD、Detail、Label / Bulk、Project割り当て、手動並び替え、Background Run lockの挙動を退行させない。

## このレイヤーが公開する契約（外部インターフェース）

### Issue hierarchy response

```ts
type IssueSummary = {
  id: string;
  identifier: string;
  title: string;
  statusId: string;
};

type IssueChildProgress = {
  total: number;
  completed: number;
  canceled: number;
  progressPercent: number;
};

type IssueDetailResponse = {
  issue: IssueViewModel;
  parent: IssueSummary | null;
  children: IssueSummary[];
  childProgress: IssueChildProgress;
  notes: IssueNoteViewModel[];
  relations: IssueRelationViewModel[];
  activity: ActivityViewModel[];
};
```

### Search / recent contract

- `issueFilterSchema`へ`text?: string`を追加し、既存Filter（status / priority / project / cycle / label / due / created）と同じcanonical normalizationを使う。
- `issueSearchQuerySchema`: `{ text: string, filter: IssueFilter }`。textはtrim後1〜255 Unicode code point、filterは既存のstrict schema。
- `recentSearchMutationSchema`: `{ idempotencyKey: string, query: IssueSearchQuery }`。
- `recentIssueViewMutationSchema`: `{ idempotencyKey: string, issueId: string }`。
- `recentSearchViewSchema`: `{ id: string, query: IssueSearchQuery, searchedAt: number }`。
- `recentIssueViewSchema`: `{ issue: IssueSummary, viewedAt: number }`。

### Issue list scope

`issueListScopeSchema = z.enum(["active", "archived", "trash"])`。省略時は`active`。Searchは常に`active`相当とし、Archived / Trashを返さない。

## このレイヤーが依存する下位の契約

- `src/shared/contracts/issues.ts`の既存Issue create / update / query schema
- `src/shared/contracts/issue-detail.ts`の既存Detail / Activity schema
- `src/shared/canonical-json.ts`のcanonical request / filter normalization

## 実装配置

- `src/shared/contracts/issues.ts`: text Filter、Issue scope、hierarchy / recent input-output schema
- `src/shared/contracts/issue-detail.ts`: Detail hierarchy responseの追加フィールド
- `src/shared/contracts/index.ts`: 新規Schema / 型のexport
- `src/shared/view-models.ts`: IssueSummary、ChildProgress、Recent view model
- `src/shared/issue-core.ts`（必要な純粋変換のみ）: shortcut / date mapperを置く場合の共有関数

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| Estimate / Due / scope / Recent body不正 | strict schemaのfieldErrorsを返し、下位の業務処理を呼ばない |
| Detail responseにToken / private field混入 | public schemaでdecode失敗し、raw payloadを返さず安全な内部エラーへ変換 |
| 旧SnapshotにRecent配列なし | data層が空配列を補完し、shared responseは空Recentとして返す |
| Search query空文字 | Search APIは空結果またはRecent記録なし。UIは入力を保持する |

## テストケース（技法注記付き）

- [同値分割 + 境界値] Estimateの`null / 1 / 2 / 3 / 5 / 8`を受理し、`0 / 4 / 13`を拒否する。
- [同値分割 + 境界値] Recent search textの1 / 255 / 256 Unicode文字を検証する。
- [代表値] IssueFilterのtextと既存属性Filterをcanonicalな順序・値へ正規化する。
- [デシジョンテーブル] Issue scopeのactive / archived / trashをstrictにdecodeし、未知scopeを拒否する。
- [代表値] Detail responseへparent / children / childProgressを追加してpublic schemaでdecodeする。
- [セキュリティ境界] Recent / Detailのpublic schemaがToken、Cookie、email、mutationKeyを受け付けない。
