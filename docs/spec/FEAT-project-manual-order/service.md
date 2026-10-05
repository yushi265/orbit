# FEAT-project-manual-order: service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: Projectは整数の`position`を持ち、`GET /api/v1/projects`とBootstrapの`projects`は、Ownerの未削除Projectを`position`の昇順（同値は`createdAt`の昇順、さらに同値は`id`の昇順）で返す。Projectの更新・アーカイブ・復元では順番が変わらない。
- **AC-2**: 新しく作成したProjectは、Ownerの未削除Projectの末尾（最大の`position`+1。1件も無ければ0）に入る。
- **AC-3**: `position`を持たないProjectを含むSnapshotを読み込むと、Ownerごとに、`position`を持つProjectの後ろへ、持たないProjectを`createdAt`の昇順（同値は`id`の昇順）で連番に割り当てる。全件が持たない場合は0からの連番になる。何度読み込んでも同じ結果になり、読み込んだだけでは保存を発生させない。
- **AC-4**: `POST /api/v1/projects/reorder`は、`projectId`のProjectを`beforeProjectId`のProjectの直前（`null`なら末尾）へ移動し、Ownerの未削除Project全体の`position`を0からの連番に振り直して、移動後のProjectを返す。順番が変わらない要求は成功として扱い、何も変更しない。
- **AC-5**: 並べ替えは、対象・移動先がOwnerの未削除Projectであることを検証する。存在しない・他Owner・削除済みは404 `RESOURCE_NOT_FOUND`、`beforeProjectId`が対象自身は400 `VALIDATION_ERROR`、Background Runによるロック中は423 `OPERATION_IN_PROGRESS`とし、失敗時は`position`・Activity・Outbox・Receiptを変更しない。
- **AC-6**: 並べ替えが成功して順番が変わったとき、ActivityとOutboxは対象Projectの1件ずつだけを記録し、他のProjectの`updatedAt`を変更しない。同じ`idempotencyKey`・同じ内容の再送は初回の応答を返し、順番・Activity・Outboxを変えない。同じキーで異なる内容は409 `IDEMPOTENCY_KEY_REUSED`。
- **AC-7**: `position`を追加したSnapshotは、D1 Sessionで保存して読み直しても全Projectの`position`が保たれ、rollback互換codec（`encodeStoreSnapshot` / `decodeStoreSnapshot`）の往復でも保たれる。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・制約 | 認証 | 用途 |
|---|---|---|---|---|
| 追加 | `POST /api/v1/projects/reorder` | 入力は[shared](./shared.md)の`projectReorderMutationSchema`。応答200 `{ project }` | 既存の`withOwner`（Owner必須） | 並べ替え |
| 変更 | `GET /api/v1/projects`、Bootstrapの`projects` | 並びが`position`昇順になる。各Projectに`position` | 既存 | 一覧 |

内部契約:

| 操作 | 名前 | 具体値 |
|---|---|---|
| 変更 | `Project`（`src/server/model.ts`） | `position: number`を追加 |
| 変更 | `OrbitStore.listProjects(userId)` | Ownerの未削除Projectを`position`昇順 → `createdAt`昇順 → `id`昇順（文字列比較）で返す |
| 変更 | `OrbitStore.createProject` | `position` = Ownerの未削除Projectの`position`の最大値+1（0件なら0）。他は不変 |
| 変更 | 開発用Seedの`project`（`store.ts`のSeed） | `position: 0` |
| 追加 | `OrbitStore.reorderProject(userId, input: ProjectReorderMutation): Project` | 下記の手順 |
| 変更 | `OrbitStore.fromSnapshot`の補完 | `isSnapshot`の検証より前、既存の補完（`recentIssueViews`・`colorTheme`など）と同じ場所で行う。`projects`が配列のとき、`userId`ごとに、有限な整数の`position`を持たないレコードへ、「そのOwnerの有限な整数`position`の最大値+1（無ければ0）」から、`createdAt`昇順 → `id`昇順で連番を付ける。削除済み（`deletedAt`あり）のレコードも対象に含める（検証を通すため）。入力は変更しない（既存どおりcloneに対して行う） |
| 変更 | `OrbitStore.isSnapshot` | `projects`の`numbers`に`position`を追加（補完後に検証されるため、旧Snapshotも通る） |
| 追加 | Handler `reorderProject(request)`（`src/server/api.ts`）とルート`src/routes/api/v1/projects/reorder.ts` | 既存の`reorderIssue`のHandler・`src/routes/api/v1/issues/reorder.ts`と同じ形。`parseContract(projectReorderMutationSchema, await parseBody(request))`。`src/routeTree.gen.ts`は生成物なので手で編集せず、プロジェクトの生成手順（開発サーバーまたはbuild）で更新する |

`reorderProject`の手順（既存`reorderIssue`の順序に合わせる）:

1. `assertOwner`、`assertUnlocked`、`checkReceipt(userId, "project.reorder", idempotencyKey, input)`（あれば保存済み応答を返す）。
2. 対象Projectが無い・他Owner・`deletedAt`ありは`notFound()`。
3. `beforeProjectId === projectId`は`validationError({ beforeProjectId: [...] })`。
4. `beforeProjectId`があり、そのProjectが無い・他Owner・`deletedAt`ありは`notFound()`。
5. `listProjects(userId)`の順から対象を除き、`beforeProjectId`の直前（`null`なら末尾）へ挿入した順を作る。
6. 新しい順が元の順と同じなら、Receiptだけ記録して対象を返す（`position`・Activity・Outboxは変えない）。
7. 違えば、新しい順の添字を各Projectの`position`に入れる（`updatedAt`は変えない）。対象Projectについて`recordActivity(userId, "project", id, "reordered", idempotencyKey, { position: 変更前 }, { position: 変更後 })`と`recordOutbox(userId, "project.reordered", `project.reordered:${id}:${idempotencyKey}`, { projectId: id, position: 変更後 })`を1回ずつ。最後に`recordReceipt(userId, "project.reorder", idempotencyKey, input, project)`。

- アーカイブ済み（`archivedAt`あり・未削除）のProjectは、対象にも移動先にもなれる（位置は未削除の全件で1本）。
- `updateProject`・`archiveProject`・復元・表示設定の保存は`position`に触れない。
- `store-snapshot-compat.ts`は変更しない。

## 実装配置

- `src/server/model.ts`、`src/server/store.ts`、`src/server/api.ts`
- `src/routes/api/v1/projects/reorder.ts`（新規）、`src/routeTree.gen.ts`（生成）
- テスト: `src/server/project-order.test.ts`（新規）。`listProjects`の順や`Project`の形を固定している既存テスト（`src/server/*.test.ts`、`src/db/repositories/*.test.ts`）の期待値更新は、今回の契約変更に直接起因するものに限る

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| 対象・移動先が無い／他Owner／削除済み | 404 `RESOURCE_NOT_FOUND`。`position`・Activity・Outbox・Receipt不変 |
| `beforeProjectId`が対象自身 | 400 `VALIDATION_ERROR`（`fieldErrors.beforeProjectId`）。不変 |
| 入力の形が不正・未知の項目 | 400 `VALIDATION_ERROR`。不変 |
| Background Runのロック中 | 423 `OPERATION_IN_PROGRESS`。不変 |
| 順番が変わらない要求（既に直前にいる・末尾を末尾へ） | 200で対象を返す。Receiptのみ記録 |
| 同じキー・同じ内容の再送 | 初回応答を返す。不変 |
| 同じキー・異なる内容 | 409 `IDEMPOTENCY_KEY_REUSED` |
| `X-Requested-With`なし・Origin不一致（既存の`withOwner`の検証） | 400（既存どおり） |
| 旧Snapshot（`position`なし） | 読み込み時に補完。読み込みだけでは保存しない |
| `position`が文字列・小数・NaNなど不正なSnapshot | そのレコードは「持たない」として補完する |

## テストケース（技法注記付き）

- [代表値] `listProjects`: `position`が2,0,1のProjectは0,1,2の順で返る。Bootstrapの`projects`も同じ順で、各Projectに`position`がある。
- [同値分割] 順番の不変: Projectの名前を更新／アーカイブ／表示設定を保存しても、`listProjects`の順と各`position`が変わらない。
- [境界値] 同値の並び: `position`が同じ2件は`createdAt`昇順、`createdAt`も同じなら`id`昇順。
- [境界値] `createProject`: 0件のOwnerで作ると`position` 0。0,1,2がある状態で作ると3。削除済みのProject（`position` 5）だけが大きい値を持つ場合、未削除の最大+1になる。他Ownerの`position`の影響を受けない。
- [デシジョンテーブル] `fromSnapshot`の補完: 全件が`position`なし（`createdAt`昇順で0,1,2）／一部だけなし（ありの最大+1から`createdAt`昇順）／全件あり（変更なし）／`createdAt`が同じ2件（`id`昇順）／Ownerが2人（Ownerごとに独立）／`position`が文字列・小数・NaN（なし扱い）／削除済みレコードもなしなら補完される。
- [代表値] 補完は決定的: 同じ旧Snapshotを2回`fromSnapshot`して`toSnapshot`した結果が一致する。入力のオブジェクトは変更されない。
- [レイヤー内結合] D1 Session: `position`なしの旧SnapshotをD1に置き、GETを処理しても`needsInitialPersist`がfalseでD1のversionが進まない。その後のMutationで、保存されたSnapshotの全Projectが`position`を持つ。
- [デシジョンテーブル] `reorderProject`の移動（A,B,C,Dの順から）: 末尾を先頭へ（D before A → D,A,B,C）／先頭を末尾へ（A before null → B,C,D,A）／途中を1つ上へ（C before B → A,C,B,D）／途中を1つ下へ（B before D → A,C,B,D）／既に直前（B before C → 不変）／末尾を末尾へ（D before null → 不変）。変わる場合は`position`が0からの連番になる。
- [代表値] アーカイブ済みのProjectを間に挟んでも移動でき、アーカイブ済みのProject自体も対象・移動先にできる。
- [同値分割] 失敗: 対象が無い／他Owner／削除済み、移動先が無い／他Owner／削除済みは404。移動先が自身は400。Runのロック中は423。いずれも全Projectの`position`と`updatedAt`、Activity・Outbox・Receiptの件数が不変。
- [代表値] 記録: 順番が変わる移動でActivity +1（`entityId`が対象、`action`が`reordered`、`before` / `after`が変更前後の`position`）、Outbox +1（`type`が`project.reordered`、`dedupeKey`が`project.reordered:{id}:{key}`）、Receipt +1。他のProjectの`updatedAt`と対象の`updatedAt`は変わらない。4件すべての位置がずれる移動でもActivityとOutboxは1件ずつ。
- [代表値] 順番が変わらない要求: Activity・Outboxの増分0、Receipt +1。
- [状態遷移] 再送: 同じキー・同じ内容は初回と同じProjectを返し、順番・Activity・Outboxが変わらない。同じキーで別の`beforeProjectId`は409 `IDEMPOTENCY_KEY_REUSED`。
- [レイヤー内結合] HTTP: `POST /api/v1/projects/reorder`のHandlerが200で`{ project }`を返し、続く`GET /api/v1/projects`が新しい順を返す。未知の項目を含む入力は400。
- [レイヤー内結合] 往復: `position`を持つSnapshotを`encodeStoreSnapshot` → `decodeStoreSnapshot` → `fromSnapshot`しても全Projectの`position`が同じ。D1 Sessionで保存 → 別Sessionで読み直しても同じ。
- [代表値] 旧版互換: `encodeStoreSnapshot`の出力のProjectレコードが、旧版の検証が見る既存の項目（`id` `userId` `name` `statusId` `priority` `color` `icon` `description` `createdAt` `updatedAt`）を全て保ち、`position`は数値の追加属性として入っている。
