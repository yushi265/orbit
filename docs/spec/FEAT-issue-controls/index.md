# FEAT-issue-controls: Issue操作性の向上

## 概要

Issue詳細でStatusを変更できるようにし、Issue一覧で完了Issueの表示状態とソート順を切り替えられるようにする。既存のIssue更新APIとBootstrapデータを再利用し、サーバー契約・データスキーマは変更しない。

## 対象範囲

- 対象レイヤー: 表示（[ui.md](./ui.md)）
- 対象ドメイン: Issue詳細 / Issue一覧（List・Board）
- 対象外: 新しいStatus・ソートの永続化、サーバー側検索・ページング、Saved Viewへの設定保存、Status定義のCRUD

## ユニット計画

単一ユニット（既存のIssue PATCHとBootstrapを利用したUI操作）。

| # | ユニット | 含むAC | 依存 | 状態 |
|---|---|---|---|---|
| 1 | Issue controls | AC-1, AC-2, AC-3, AC-4, AC-5, AC-6 | — | 完了 |

## 受け入れ基準（AC）

- [x] **AC-1**: Issue詳細のStatusセレクトでOwnerのworkflow stateを選択すると、既存の`PATCH /api/v1/issues/:issueId`へ現在の`version`と`patch.statusId`を送信し、成功時に詳細・一覧へ反映する。保存失敗時は既存のrollback / retry導線を維持する。
- [x] **AC-2**: Issues画面で「完了Issueを表示」を切り替えられ、初期状態は表示、OFF時はworkflow stateの`category === "completed"`に該当するIssueをList・Boardの両方から除外する。Canceledは完了Issueとして除外しない。非表示にしたIssueは選択状態からも解除する。
- [x] **AC-3**: Issues画面でソート順を「更新日（新しい順）」「作成日（新しい順）」「タイトル（昇順）」「ステータス順」「優先度（Urgent順）」「期限（近い順）」から選択でき、List・BoardのIssue順へ即時反映する。初期値は更新日（新しい順）で、同値の場合は更新日・作成日・識別子を用いて安定させる。
- [x] **AC-4**: 「完了Issueを表示」の選択状態をブラウザへ保存し、Issues画面の再読み込み後も同じ状態を復元する。保存できない環境ではメモリ上の状態で動作を継続する。
- [x] **AC-5**: IssueのStatus / Priority / Project等の保存成功Toastに「元に戻す」ボタンを表示し、押下時は保存直前の値を現在のversionから逆更新する。Undo成功時は「元に戻しました」を表示し、Undo後のToastからUndoを再実行しない。
- [x] **AC-6**: ソート選択UIはIssues画面のtoolbarに配置し、Listのカラム見出しには配置しない。選択した順序はList・Boardの両方へ適用する。

## アーキテクチャ / レイヤー間フロー

```text
Bootstrap(issues, workflowStates)
        │
        ├─ Issue詳細 Status select ──┐
        └─ 一覧 filter / sort         ├─ OrbitAppの表示状態
                                     │
                                     └─既存 updateIssue mutation
                                       PATCH /api/v1/issues/:issueId
```

## エラー・ログ方針（横断サマリ）

| シナリオ | 表示層の挙動 |
|---|---|
| Status更新成功 | 既存のoptimistic update後、サーバー値でQuery Cacheを確定し成功Toastを表示 |
| Status更新のversion競合 | 既存のIssue version conflict表示と最新データ再取得を利用 |
| Status更新のその他失敗 | optimistic stateをrollbackし、既存の再試行Toastを表示 |
| 完了Issueが0件 | 完了表示切替後の一覧・Boardを空状態として表示 |
| ソート対象の値が未設定 | 期限未設定は最後、優先度未設定は最低順位として安定ソート |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | — | 既存Issue PATCH mutation / UI契約確認 |
| AC-2 | 完了判定ヘルパー | List・Boardへ渡る表示Issue集合の確認 |
| AC-3 | ソート関数 | List・Boardへ渡る順序の確認 |
| AC-4 | preference parser | localStorage復元のBrowser smoke |
| AC-5 | inverse patch | 保存成功・Undo成功のBrowser smoke / API PATCH |
| AC-6 | — | List header配置・toolbar非表示のBrowser smoke |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `OrbitAppInner`の既存`updateIssue` mutation、`IssueDetailPanel`の`workflowStates`、`IssuesView`のList・Board共通`issues`配列。
- 差分: `src/components/issue-list.ts`に完了判定・ソートの純粋関数を置き、一覧のuseMemoで適用する。UIの一時状態は`OrbitAppInner`に保持する。
- 衝突回避: APIやStoreを変更せず、既存のStatus一括更新・一覧インラインStatus変更と同じ`statusId`契約を利用する。

## 実装に効く制約

- workflow stateの表示順はBootstrapの`position`順を維持する。
- 完了判定は表示名ではなく`WorkflowState.category`で行う。
- 完了表示・ソートはListとBoardで同じfiltered / sorted配列を使う。
- 「完了Issueを表示」だけ`orbit.issues.showCompleted`としてlocalStorageへ保存する。ソート順・検索・Priority / Label filterは永続化しない。
- 既存のOwner境界、version CAS、optimistic rollback / retryを変更しない。

## 判断根拠 / 未決事項

- 完了表示の初期値は既存画面の表示内容を壊さないため`true`（表示）とする。OFF時だけcompleted categoryを除外する。
- ソートは利用頻度の高い5種類に限定し、状態の永続化やSaved View連携はスコープ外とする。ソートロジックは純粋関数に分離してList・Board間の挙動を統一する。
- Status変更は新規APIを追加せず、既存Issue PATCHの`version`と`patch.statusId`を使う。これにより競合・再試行の既存契約を維持できる。
- 未決事項はない。ユーザーの自律進行指示に基づき、Gate 2は要点提示後に委任して実装を進める。
- 完了表示の保存先はサーバー設定ではなくブラウザlocalStorageとし、個人の端末ごとの表示設定として扱う。保存失敗時も機能本体を止めない。
- Undoは既存Issue PATCH mutationの成功Toastに限定し、Bulk更新や作成・削除など複数レコード／別契約の操作は対象外とする。
