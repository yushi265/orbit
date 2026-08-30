# FEAT-home-project-inbox-ux: data 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-3**: ProjectごとのIssue workspace表示設定（List / Board、検索、Status / Priority / Label / 期限Filter、並び順、完了Issue表示切替）はOwner scopedなサーバー状態として保存され、別端末のBootstrap再取得後に同じProjectで復元される。設定未保存のProjectは定義済み初期値で表示する。
- **AC-4**: Project表示設定のMutationは既存のOwner境界、same-origin、idempotencyKey、Runtime lockを守る。同じKey・同じRequestの再送は同じ設定を返し、同じKey・異なるRequestは409、入力不正は400、存在しないまたはOwner外Projectは404、Runtime lock中は423になり、設定を部分更新しない。Inboxは既存通知の既読化・対象遷移を維持したまま、Inboxの役割、通知の読み方、通知がない場合の次の行動を画面上で説明する。

## このレイヤーが公開する契約（外部インターフェース）

### Snapshot record

```ts
interface ProjectDisplayPreference {
  id: string;
  userId: string;
  projectId: string;
  settings: ProjectIssueDisplaySettings;
  updatedAt: number;
}
```

`OrbitStoreSnapshot`へ`projectDisplayPreferences: ProjectDisplayPreference[]`を追加する。既存D1の`orbit_store_snapshots.state_json`へ含めるため、新しい正規化D1 table / Migrationは作らない。

### Store behavior

- `getProjectDisplayPreferences(userId, projectId)`はProjectの存在・Owner・未削除を確認し、既存recordまたは初期値を返す。
- `listProjectDisplayPreferences(userId)`は本人のrecordだけを返し、Projectが存在しないrecordは返さない。
- `updateProjectDisplayPreferences(userId, projectId, input)`は`assertOwner`、`assertUnlocked`、receipt、Project Owner境界の順に検証する。
- Recordの識別子はStore内で一意な`id`を持ち、`userId + projectId`につき1件だけ保持する。
- 設定更新は既存recordを置き換え、`updatedAt`をStore clockで更新する。Activity / Outboxは作らない。
- Project detailの手動reorderは既存Issue positionを再利用し、`projectId` scopeがある場合は同じProjectのactive Issueだけをposition再採番する。

### Snapshot互換

- `fromSnapshot`で`projectDisplayPreferences`が欠落している旧Snapshotは空配列へ補完する。
- Snapshot validationは各recordの`id`、`userId`、`projectId`、`updatedAt`とsettings schemaを検証する。
- Owner指定付き`fromSnapshot`では全recordの`userId`がOwnerと一致しないSnapshotを拒否する。
- `toSnapshot` / `fromSnapshot`往復で設定値、Project ID、更新日時を保持する。

## 実装配置

- `src/server/model.ts`: `ProjectDisplayPreference`、`BootstrapPayload.projectDisplayPreferences`。
- `src/server/store.ts`: Snapshot field、Map、legacy補完、validation、list / get / update。
- `src/server/store-project-view.test.ts`または専用test: owner、snapshot、初期値、更新、再送。
- `src/db/schema.ts` / `drizzle/`: 変更なし（Snapshot bridgeを利用する判断）。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| Project不存在 / Owner外 / 削除済み | `notFound()`、Map / Snapshot / Receipt不変 |
| Runtime lock | `assertUnlocked`で`locked()`、設定不変 |
| 同一Key・同一Request | receiptの保存済みresponseを返し、更新日時を再変更しない |
| 同一Key・異なるRequest | `IDEMPOTENCY_KEY_REUSED`、設定不変 |
| Snapshotの設定配列欠落 | 空配列へ補完し、初期値として扱う |
| 設定recordのOwner不一致 | Snapshotを無効として拒否し、他Ownerの設定を返さない |

## テストケース（技法注記付き）

- [代表値] 未保存Projectのgetは初期値を返し、Snapshotに不要なrecordを作らない。
- [状態遷移] 初期値 → 更新値 → list / getで更新値を返す。
- [代表値] `toSnapshot` → `fromSnapshot`で設定が同値復元される。
- [境界値] 旧Snapshotの配列欠落は空配列へ補完され、既存Snapshotは破壊しない。
- [デシジョンテーブル] Owner一致 / Owner外 / 不存在 / 削除済みをそれぞれ成功・404へ分岐する。
- [デシジョンテーブル] lock idle / running、同じKey同じRequest / 同じKey異なるRequestを200 / 423 / 409へ分岐する。
- [代表値] 表示設定更新でIssue、Project、Activity、Outboxの件数が変化しない。
- [整合性] Snapshot内の同一Owner・Project重複recordは復元時に拒否する。
