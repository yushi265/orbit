# FEAT-project-manual-order: shared 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: Projectは整数の`position`を持ち、`GET /api/v1/projects`とBootstrapの`projects`は、Ownerの未削除Projectを`position`の昇順（同値は`createdAt`の昇順、さらに同値は`id`の昇順）で返す。Projectの更新・アーカイブ・復元では順番が変わらない。
- **AC-4**: `POST /api/v1/projects/reorder`は、`projectId`のProjectを`beforeProjectId`のProjectの直前（`null`なら末尾）へ移動し、Ownerの未削除Project全体の`position`を0からの連番に振り直して、移動後のProjectを返す。順番が変わらない要求は成功として扱い、何も変更しない。
- **AC-5**: 並べ替えは、対象・移動先がOwnerの未削除Projectであることを検証する。存在しない・他Owner・削除済みは404 `RESOURCE_NOT_FOUND`、`beforeProjectId`が対象自身は400 `VALIDATION_ERROR`、Background Runによるロック中は423 `OPERATION_IN_PROGRESS`とし、失敗時は`position`・Activity・Outbox・Receiptを変更しない。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 | 具体値 |
|---|---|---|
| 変更 | `ProjectViewModel`（`src/shared/view-models.ts`） | `position: number`を追加（`updatedAt`の後ろ）。他の項目は不変 |
| 追加 | `projectReorderMutationSchema`（`src/shared/contracts/projects.ts`） | `z.strictObject({ idempotencyKey: z.string().min(1), projectId: z.string().min(1), beforeProjectId: z.string().min(1).nullable() })`（IDの表現は同ファイルの既存の`statusId: z.string().min(1)`に合わせる） |
| 追加 | `ProjectReorderMutation` | `z.infer<typeof projectReorderMutationSchema>` |
| 追加 | 別名`ProjectReorderMutationSchema` | 既存の`ProjectCreateMutationSchema`と同じ形の別名export |

- 応答の形は`{ project: ProjectViewModel }`（HTTP 200）。エラーは既存のError Envelope。
- 既存の`projectMetadataMutationSchema` / `projectCreateMutationSchema`は変えない（クライアントから`position`を直接指定する手段は設けない）。

## 実装配置

- `src/shared/contracts/projects.ts`、`src/shared/view-models.ts`
- テスト: `src/shared/contracts/project-display.test.ts`の隣に、Project契約のテスト（既存にProject契約のテストファイルがあればそこへ追加。無ければ`src/shared/contracts/projects.test.ts`を新規）

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| `idempotencyKey`が空・`projectId`が空や不正な形 | スキーマが拒否（Handlerが400 `VALIDATION_ERROR`） |
| `beforeProjectId`が未指定（`undefined`） | スキーマが拒否。末尾は必ず`null`で指定する |
| 未知の項目（例: `position`） | strictのため拒否 |

## テストケース（技法注記付き）

- [同値分割] `projectReorderMutationSchema`: 有効（`beforeProjectId`がID／`null`）は通る。無効（`idempotencyKey`が空、`projectId`が空、`beforeProjectId`が未指定、未知の項目`position`を含む）は拒否する。
- [代表値] `ProjectViewModel`に`position: number`があり、既存の項目が欠けていない（型のテスト。既存の契約テストの方式に合わせる）。
