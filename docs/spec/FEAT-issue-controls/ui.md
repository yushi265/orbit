# FEAT-issue-controls: 表示層詳細設計

## 担保 AC（[index.md](./index.md) の引用）

- **AC-1**: Issue詳細のStatusセレクトでOwnerのworkflow stateを選択すると、既存の`PATCH /api/v1/issues/:issueId`へ現在の`version`と`patch.statusId`を送信し、成功時に詳細・一覧へ反映する。保存失敗時は既存のrollback / retry導線を維持する。
- **AC-2**: Issues画面で「完了Issueを表示」を切り替えられ、初期状態は表示、OFF時はworkflow stateの`category === "completed"`に該当するIssueをList・Boardの両方から除外する。Canceledは完了Issueとして除外しない。非表示にしたIssueは選択状態からも解除する。
- **AC-3**: Issues画面でソート順を「更新日（新しい順）」「作成日（新しい順）」「タイトル（昇順）」「優先度（Urgent順）」「期限（近い順）」から選択でき、List・BoardのIssue順へ即時反映する。初期値は更新日（新しい順）で、同値の場合は更新日・作成日・識別子を用いて安定させる。
- **AC-4**: 「完了Issueを表示」の選択状態をブラウザへ保存し、Issues画面の再読み込み後も同じ状態を復元する。保存できない環境ではメモリ上の状態で動作を継続する。
- **AC-5**: IssueのStatus / Priority / Project等の保存成功Toastに「元に戻す」ボタンを表示し、押下時は保存直前の値を現在のversionから逆更新する。Undo成功時は「元に戻しました」を表示し、Undo後のToastからUndoを再実行しない。
- **AC-6**: ソート選択UIはIssues Listの`ISSUE`カラム見出し内に配置し、toolbarにはソート選択を表示しない。選択した順序はList・Boardの両方へ適用する。

## このレイヤーが公開・利用する契約

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| Status更新 | `PATCH /api/v1/issues/:issueId` | `{ idempotencyKey, version, patch: { statusId } }`。StatusはBootstrapのOwner workflow stateから選択 | 既存Owner境界・version CAS | Issue詳細のStatus変更 |
| 初期データ | `GET /api/v1/bootstrap` | `issues`と`workflowStates`を利用 | 既存Owner境界 | 完了判定・List/Board表示 |
| 表示設定 | `localStorage["orbit.issues.showCompleted"]` | `"true"` / `"false"`。読み書き失敗時はメモリ状態を継続 | ブラウザローカル | 完了Issue表示の復元 |

## 実装配置

- `src/components/OrbitApp.tsx`: Issue詳細Status select、Issues toolbar、表示状態の保持、filtered/sorted Issue配列の配線。
- `src/components/issue-list.ts`: completed判定、ソート種別、安定ソート関数。
- `src/components/issue-list.test.ts`: 完了判定と各ソート順の単体テスト。
- `src/components/issue-preferences.ts`: 完了Issue表示設定のStorage keyと値パーサー。
- `src/components/issue-undo.ts`: Issueの保存前値から逆Patchを生成する関数。
- `src/styles.css`: 完了表示toggleとStatus / sort selectのレスポンシブ表示。

## UI/UX 方針

- **画面フロー / 導線**: Issue詳細の既存Priority / Version / Status列にStatus selectを置く。Issues toolbarには完了表示toggleを置き、Sort selectはListの`ISSUE`カラム見出し内に置く。List・Boardの両方へ同じ結果を適用する。
- **主要操作とフィードバック**: Status変更は既存のoptimistic update、成功Toast、競合・失敗時rollback / retryを利用する。保存成功Toastの「元に戻す」は直前のIssue値を逆Patchし、完了時に「元に戻しました」を表示する。表示切替・ソートはクライアント即時反映し、通信を発生させない。
- **状態設計（出し分け）**: 初期はcompletedを表示、completed OFF時の0件は既存EmptyState、Status更新中は該当Issueの操作をdisabled、Status更新失敗は既存Toastを表示する。
- **既存デザインシステムとの整合**: 既存`filter-select`、`view-toggle`、`status-pill`、`IssueRow`、`IssueCard`、`toast`を再利用する。

### レスポンシブ / アクセシビリティ

- 390pxでは完了表示toggleを折り返して全幅で操作できるようにし、Sort selectはListのIssueカラム内で幅を抑える。
- Status select、Sort select、完了表示toggleには目的が分かる`aria-label`または可視ラベルを付ける。
- List・Boardのどちらでも同一の完了判定・ソート結果を使い、色だけに依存しない文言を表示する。

## 異常系挙動

| シナリオ | 本レイヤーの挙動 |
|---|---|
| Status更新のversion競合 | 既存mutationの競合メッセージ・最新Issue再取得を表示 |
| Status更新の失敗 | 既存optimistic stateを戻し、Toastの再試行を提供 |
| workflowStatesに現在Statusがない | 現在値を保持したまま、選択肢は取得済み状態のみ表示 |
| 完了Issueを非表示にして全件が消える | 「条件に一致するIssueはありません」のEmptyStateを表示 |

## テストケース（技法注記付き）

- [状態遷移] Issue詳細でworkflow stateを選択 → `statusId` PATCHが発生し、成功後に選択値が反映される。
- [状態遷移/失敗系] Status PATCHが競合 → rollback / 最新値反映 / retry導線が既存契約どおり動く。
- [デシジョンテーブル] `showCompleted=true` × completed / canceled / active → 全件表示。
- [デシジョンテーブル] `showCompleted=false` × completed / canceled / active → completedのみ除外。
- [代表値] 各sort optionでList・Boardへ渡すIssue順が期待順になる。
- [代表値] 完了表示OFFを保存して再読み込み → OFF状態が復元される。
- [状態遷移] Issue保存成功ToastのUndo → 保存前値へ戻り、「元に戻しました」が表示される。
- [境界値] dueAt=null → 期限ソートで最後に配置される。
- [代表値] updatedAt / createdAt / title / priority / dueAtが同値 → 更新日・作成日・identifierで順序が安定する。
