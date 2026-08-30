# FEAT-home-project-inbox-ux: shared 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-3**: ProjectごとのIssue workspace表示設定（List / Board、検索、Status / Priority / Label / 期限Filter、並び順、完了Issue表示切替）はOwner scopedなサーバー状態として保存され、別端末のBootstrap再取得後に同じProjectで復元される。設定未保存のProjectは定義済み初期値で表示する。
- **AC-4**: Project表示設定のMutationは既存のOwner境界、same-origin、idempotencyKey、Runtime lockを守る。同じKey・同じRequestの再送は同じ設定を返し、同じKey・異なるRequestは409、入力不正は400、存在しないまたはOwner外Projectは404、Runtime lock中は423になり、設定を部分更新しない。Inboxは既存通知の既読化・対象遷移を維持したまま、Inboxの役割、通知の読み方、通知がない場合の次の行動を画面上で説明する。
- **AC-5**: Home、Project詳細、InboxはLoading、空、保存中、400 / 404 / 409 / 423 / 500系エラー、成功状態を既存のエラー表示方針で示し、Pointer / Keyboardの双方で主要操作を実行できる。Desktop（1200px以上）、Tablet（768〜1199px）、Mobile（767px以下、390pxを含む）で横方向の表示崩れを起こさない。

## このレイヤーが公開する契約（外部インターフェース）

### Project表示設定値

```ts
type ProjectIssueDisplayMode = "list" | "board";
type ProjectIssueDisplayOrder =
  | "manual"
  | "updated_desc"
  | "created_desc"
  | "title_asc"
  | "status_asc"
  | "priority_desc"
  | "due_asc";
type ProjectIssueDueFilter = "all" | "none" | "overdue" | "today" | "upcoming";

interface ProjectIssueDisplaySettings {
  mode: ProjectIssueDisplayMode;
  filterText: string; // Unicode 0..255
  statusFilter: string; // "all" or an Owner workflow state ID
  priorityFilter: "all" | "no_priority" | "low" | "medium" | "high" | "urgent";
  labelFilter: string; // "all" or an Owner label ID
  dueFilter: ProjectIssueDueFilter;
  showCompleted: boolean;
  order: ProjectIssueDisplayOrder;
}
```

初期値は次の固定値とする。

```json
{
  "mode": "list",
  "filterText": "",
  "statusFilter": "all",
  "priorityFilter": "all",
  "labelFilter": "all",
  "dueFilter": "all",
  "showCompleted": true,
  "order": "updated_desc"
}
```

### Public model

```ts
interface ProjectDisplayPreferenceViewModel {
  id: string;
  userId: string;
  projectId: string;
  settings: ProjectIssueDisplaySettings;
  updatedAt: number;
}
```

`BootstrapViewModel`は`projectDisplayPreferences: ProjectDisplayPreferenceViewModel[]`を持ち、返却対象は本人のProjectに紐づく設定だけとする。

### Schema

- `projectIssueDisplaySettingsSchema`はstrict objectとする。
- `filterText`はUnicode code pointで0〜255文字。
- `statusFilter` / `labelFilter`は1文字以上のopaque IDまたは`all`。
- `priorityFilter`、`dueFilter`、`mode`、`order`は列挙値以外を拒否する。
- `projectDisplayPreferencesMutationSchema`はstrict object `{ idempotencyKey: string(1..200), displayPreferences: ProjectIssueDisplaySettings }` とする。

## このレイヤーが依存する下位の契約

- `src/shared/contracts/enums.ts`のPriority enum。
- 既存`BootstrapViewModel`、Issue / Workflow / Label view model。

## 実装配置

- `src/shared/contracts/project-display.ts`: 表示設定のenum、初期値、Zod schema、公開型。
- `src/shared/contracts/index.ts`: schema / type export。
- `src/shared/view-models.ts`: Project表示設定view modelとBootstrap field。
- `src/shared/contracts/*.test.ts`: schemaの同値分割・境界値・strictness。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| 不明なsettings key | strict schemaで失敗し、serviceが400へ変換する |
| filterTextが256文字 | schemaで失敗し、`fieldErrors.displayPreferences.filterText`相当の入力エラーへ変換する |
| 不明なmode / order / dueFilter | schemaで失敗し、保存値を変更しない |
| 旧Snapshotに設定配列がない | data layerが空配列として補完し、初期値を返す |

## テストケース（技法注記付き）

- [同値分割] `list` / `board`、全Order、全DueFilter、Priority `all` / 5値は受理する。
- [境界値] `filterText` 0文字・255文字は受理し、256文字は拒否する。
- [デシジョンテーブル] `showCompleted=true / false`を保持し、他の設定値を変更しない。
- [契約] 未知キー、配列、null、数値のdisplayPreferencesはstrict schemaで拒否する。
- [代表値] 設定未保存時の初期値が全フィールドで安定して返る。
