# FEAT-issue-project-assignment: Service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: 本人がIssue一覧またはIssue詳細で、Bootstrapに含まれる本人所有Projectを選択して保存でき、Projectなしを選ぶと`projectId: null`で解除できる。成功後はIssueのversionと一覧・詳細の表示が更新される。
- **AC-2**: 新規Issue作成時にProjectを選択できる。指定Projectが存在しない、削除済み、または他Ownerの場合はサーバーが404で拒否し、Issueを作成しない。
- **AC-3**: Project保存が409またはその他の失敗になった場合、最新値との整合を保ち、入力をロールバックし、Project専用の再試行導線を表示する。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 作成 | `POST /api/v1/issues` | `projectId?: string \| null`。指定時は存在・未削除・Owner一致を検証 | 検証済みOwnerのみ | 新規Issue作成 |
| 更新 | `PATCH /api/v1/issues/:issueId` | `version`、`idempotencyKey`、`patch.projectId?: string \| null` | IssueとProjectのOwner一致 | Project割り当て・解除 |

失敗時は既存ErrorEnvelopeを使い、Project参照不正は404、version競合は409、Runtime lockは423とする。

## 実装配置

- `src/server/store.ts`: `createIssue`のProject参照検証
- `src/server/api.ts`: 既存Issue create/update handlerを再利用
- `src/shared/contracts/issues.ts`: 既存`projectId`契約を変更せず利用

## 異常系挙動

| シナリオ | 本レイヤーの挙動 |
|---|---|
| Project不存在・他Owner・削除済み | 404を返し、Issue / Activity / Outbox / Receiptを変更しない |
| version不一致 | 409 `ISSUE_VERSION_CONFLICT`を返す |
| Runtime lock | 423 `OPERATION_IN_PROGRESS`を返す |
| 同じidempotencyKeyの再送 | 既存Receiptを返し、副作用を増やさない |

## テストケース（技法注記付き）

- [代表値] 有効な本人ProjectをIssue作成時に指定すると`projectId`へ保存される
- [同値分割] Projectなし（`null`）のIssue作成は成功する
- [デシジョンテーブル] Project不存在・削除済み・他Ownerの各指定は404で副作用なし
- [代表値] Issue更新でProjectを割り当て、`projectId: null`で解除できる
- [状態遷移] 同じversionの競合更新は409となり勝者のProjectを保持する
