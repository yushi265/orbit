# FEAT-project-archive-delete: ui 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-6**: Projects一覧は、アーカイブされていないProjectを従来どおり（並べ替えボタン付き）表示し、アーカイブ済みProjectはその下の「アーカイブ済み（{件数}）」の折りたたみ（初期は閉じる）にまとめる。アーカイブ済みのカードは並べ替えボタンを持たず、「アーカイブ済み」の印を出し、押すとProject詳細へ遷移する。アーカイブ済みが0件なら折りたたみを出さない。
- **AC-7**: Project詳細は、アーカイブされていないProjectに「アーカイブ」ボタン、アーカイブ済みProjectに「このProjectはアーカイブ済みです」の表示と「元に戻す」ボタンを出す。押すとAPIを呼び、成功したら最新のデータを読み込んで表示を切り替える。失敗したらエラーを表示し、表示はそのまま。処理中はボタンを無効にする。
- **AC-8**: Project詳細の「削除」ボタンは確認ダイアログ（題「Projectを削除しますか？」、本文に「{Project名}」と、Projectから外れるIssueの件数、元に戻せないこと）を開く。「削除する」で削除APIを呼び、成功したらProjects一覧へ移動して最新のデータを読み込む。「キャンセル」・Escでは何もしない。失敗したらダイアログ内にエラーを表示し、ダイアログを閉じない。
- **AC-9**: IssueのProject選択欄（一覧の行・詳細・作成・一括変更）は、アーカイブ済みProjectを選択肢に出さない。ただし、そのIssueに今設定されているProjectがアーカイブ済みのときは、そのProjectだけを「{Project名}（アーカイブ済み）」として出す。IssuesのProjectタブとHomeのProject一覧は従来どおりアーカイブ済みを出さない。

## このレイヤーが公開する契約（外部インターフェース）

画面パスの変更は無い。

| 操作 | 名前 | 具体値 |
|---|---|---|
| 追加 | `selectableProjects(projects, currentProjectId)`（`src/components/issue-project.ts`） | `projects`は表示順の`ProjectViewModel[]`。`archivedAt`ありを除き、`currentProjectId`（`string | null | undefined`）と同じIDのものだけはアーカイブ済みでも残す。順は保つ。戻り値は`{ project, archived: boolean }[]` |
| 追加 | `splitArchivedProjects(projects)`（`src/components/project-workspace.ts`） | `{ active, archived }`。順は保つ |
| 変更 | `ProjectsView`の一覧 | `active`を従来のカード（並べ替えボタンは`active`の並びで判定）で出し、`archived`が1件以上なら`details.project-archived-section`（初期は閉じる。`summary`「アーカイブ済み（n）」）の中に、並べ替えボタンなし・`span.project-archived-badge`「アーカイブ済み」付きのカードを出す |
| 変更 | `ProjectsView`の詳細 | `project-detail-actions`に「アーカイブ」（未アーカイブ時）と「削除」を追加。アーカイブ済みなら見出しの下に`div.project-archived-notice`（`role="status"`）「このProjectはアーカイブ済みです」と「元に戻す」ボタン |
| 追加 | 操作の呼び出し | `apiPost(`/api/v1/projects/${id}?action=${action}`, { idempotencyKey })`（`apiPost`がBodyの`idempotencyKey`を`Idempotency-Key`ヘッダーにも載せる。既存のIssueのtrashの呼び出しと同じ形）。キーは`useMutationKey`で操作ごとに持ち、失敗後の再試行で同じキーを使う。成功で`onRefresh()`、削除の成功は`/projects`へ遷移してから`onRefresh()` |
| 追加 | 削除の確認 | 既存の`Modal`。題「Projectを削除しますか？」、本文「「{name}」を削除します。このProjectのIssue {n}件はProjectなしとして残ります。削除は元に戻せません。」（`n`は画面が持っているIssue（Bootstrapの通常のIssue。アーカイブ済み・ゴミ箱内は含まない）のうち、そのProjectのものの件数。サーバーはアーカイブ済み・ゴミ箱内のIssueからもProjectを外すが、画面に見えている件数を伝える）。ボタン「キャンセル」（初期フォーカス）・「削除する」（`button danger`、既存に無ければ`primary`）。処理中は両方無効、失敗はダイアログ内の`role="alert"` |
| 変更 | IssueのProject選択欄（一覧の行・詳細・作成・一括変更） | `selectableProjects`で選択肢を作る。`archived: true`は「{name}（アーカイブ済み）」。行・詳細は対象Issueの`projectId`、作成は選択中の値を`currentProjectId`に渡す。一括変更は対象が複数で「今の値」が無いので渡さない（アーカイブ済みは出さない） |

## 実装配置

- `src/components/issue-project.ts`、`src/components/project-workspace.ts`、`src/components/OrbitApp.tsx`、`src/styles.css`
- テスト: `src/components/issue-project.test.ts`・`src/components/project-workspace.test.ts`（関数）、`src/components/project-archive-runtime.test.ts`（新規・jsdom描画）

## UI/UX 方針

- 画面フロー: Projects一覧 → カード → 詳細で「アーカイブ」→ 一覧では「アーカイブ済み」へ移る。戻すときは「アーカイブ済み」を開いてカード → 詳細の「元に戻す」。削除は詳細の「削除」→ 確認 → Projects一覧へ戻る。
- 状態設計:
  - 処理中: 詳細のアーカイブ・元に戻す・削除・編集ボタンを無効。
  - 成功: 再取得した内容で表示を切り替える（楽観更新はしない）。
  - 失敗: 詳細は既存の`detail-live-error`、削除はダイアログ内に表示。
  - 空: アーカイブ済みが0件なら折りたたみを出さない。全件アーカイブ済みなら上段は既存の空表示「Projectはまだありません」ではなく、折りたたみだけを出す。
- 既存デザインとの整合: カード・`Modal`・ボタンの既存クラスを使う。新しい色は足さない。

### レスポンシブ / アクセシビリティ

- 390px: 詳細のボタンは既存の`project-detail-actions`の折り返しに乗る。ボタンの高さは既存どおり44px以上。
- 1440px: 見出しの右にボタンが横並び。
- 確認ダイアログは既存`Modal`のフォーカス閉じ込め・Escで閉じる。「アーカイブ済み」の印は文字で出す（色だけに頼らない）。

## テストケース

| # | 技法 | ケース | AC |
|---|---|---|---|
| U1 | 代表値 | `splitArchivedProjects`: 混在で順を保って分かれる | AC-6 |
| U2 | デシジョンテーブル | `selectableProjects`: 未アーカイブ / アーカイブ済み×(現在値と一致・不一致・現在値なし) | AC-9 |
| U3 | 代表値 | 一覧: アーカイブ済みは折りたたみの中、ボタンなし・印あり。0件なら折りたたみなし | AC-6 |
| U4 | 状態遷移 | 詳細: 未アーカイブ→「アーカイブ」でAPI（action=archive）→再取得。アーカイブ済み→「元に戻す」でAPI（action=restore） | AC-7 |
| U5 | 代表値 | 詳細: アーカイブ失敗でエラー表示・ボタン復帰 | AC-7 |
| U6 | 状態遷移 | 削除: ダイアログ表示（名前・件数）→キャンセルで何もしない→削除するでAPI（action=delete）→`/projects`へ遷移 | AC-8 |
| U7 | 代表値 | 削除失敗: ダイアログ内にエラー、閉じない | AC-8 |

## 実装メモ

- `.page`の直下の子へ一律に付く`position: relative`（`.page > :not(.cycle-blocking-overlay)`）が、`.page`直下に置いた`Modal`の`.modal-backdrop`の`position: fixed`を打ち消し、背景が画面全体を覆わなかった。`.page > .modal-backdrop { position: fixed; }`を足して戻した（既存の`motion.test.ts`が固定するセレクタは変えない）。
