# FEAT-issue-project-assignment: IssueへのProject割り当て

## 概要

Issueの新規作成・一覧・詳細画面から、本人が所有するProjectをIssueへ割り当て・解除できるようにする。
既存のIssue `POST/PATCH` 契約とOwner境界を再利用し、Project選択を画面間で一貫させる。

## 対象範囲

- 対象レイヤー: [service.md](./service.md)、[ui.md](./ui.md)
- 対象ドメイン: Issue / Project assignment
- 対象外: Project CRUD、Bulk APIの新設、Project以外のIssue属性、DBスキーマ変更、実ブラウザE2E基盤の新設

## ユニット計画

| # | ユニット | 含むAC | 依存 | 状態 |
|---|---|---|---|---|
| 1 | Issue Project assignment | AC-1〜AC-4 | 既存Issue / Project契約 | 完了 |

## 受け入れ基準（AC）

- [x] **AC-1**: 本人がIssue一覧またはIssue詳細で、Bootstrapに含まれる本人所有Projectを選択して保存でき、Projectなしを選ぶと`projectId: null`で解除できる。成功後はIssueのversionと一覧・詳細の表示が更新される。
- [x] **AC-2**: 新規Issue作成時にProjectを選択できる。指定Projectが存在しない、削除済み、または他Ownerの場合はサーバーが404で拒否し、Issueを作成しない。
- [x] **AC-3**: Project保存が409またはその他の失敗になった場合、最新値との整合を保ち、入力をロールバックし、Project専用の再試行導線を表示する。
- [x] **AC-4**: Desktop / Tablet / MobileでProject割り当て導線を利用でき、選択要素にラベルを付け、既存のIssue画面レイアウトとキーボード操作を維持する。

## アーキテクチャ / レイヤー間フロー

```text
Bootstrap(projects) → Issue list/detail/create select
                    → POST /api/v1/issues または PATCH /api/v1/issues/:issueId
                    → Owner / existence validation → Issue version + response
                    → Query cache (detail/bootstrap) refresh
```

## エラー・ログ方針（横断サマリ）

| シナリオ | service | 表示層の挙動 |
|---|---|---|
| Project選択成功 | 200/201、既存Activity / Receipt契約 | 選択値とIssue一覧・詳細を更新 |
| Projectなし | `projectId: null`として通常Mutation | Projectなしを表示 |
| Project不存在・他Owner | 404 `RESOURCE_NOT_FOUND`、副作用なし | 選択値を戻してエラー表示 |
| version競合 | 409 `ISSUE_VERSION_CONFLICT` | 最新Issueを取得し、再試行導線を表示 |
| Runtime lock | 423 `OPERATION_IN_PROGRESS` | 選択値を戻し、既存のエラー表示を使う |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | Project選択値の正規化 | Issue update / Owner / version / null解除 |
| AC-2 | — | Issue createのProject存在・Owner境界 |
| AC-3 | — | 既存Issue mutationの409契約、UI状態はlocal smoke |
| AC-4 | — | 既存UIのlocal browser smoke、型・Lint |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: Bootstrapの`projects`、`createIssue` / `updateIssue`、`projectId`の既存Zod契約、Issue version CAS。
- 差分: Issue画面にProject selectと保存・再試行状態を追加し、create時のProject存在検証を補正する。
- 衝突なし: DBスキーマ、Route、APIの入力形式は変更しない。既存Bulk操作のProject導線は維持する。

## 実装に効く制約

- BrowserへOwner外のProjectを表示しない。サーバーでもProject存在・削除状態・Ownerを検証する。
- Projectなしは空文字または`__none__`をUI入力値とし、APIへは必ず`null`を渡す。
- Issue更新には既存の`idempotencyKey`と`version`を、Issue作成には`idempotencyKey`を必ず付与する。
- 認証・DBスキーマ・公開APIの形は変更しない。

## 判断根拠 / 未決事項

- 既存API契約を再利用する。新しいProject専用APIを追加するとOwner境界・冪等性・version処理が二重化するため。
- 一覧は素早いインライン変更、詳細は保存ボタン付きの明示的変更、新規作成は作成前選択とし、既存画面の操作モデルに合わせる。
- 未決事項なし。実ブラウザの詳細な操作証跡は既存方針どおりRelease hardeningで補完する。
