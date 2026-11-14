# FEAT-inbox-triage: ui 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: InboxにはアーカイブされていないIssueのうち、Projectが未設定で、Statusのカテゴリが完了・キャンセル以外のものを作成日時の新しい順に表示する。Projectが設定されたIssue、完了・キャンセルのIssueは表示しない。
- **AC-2**: Inboxの各行でProjectを選ぶと既存のIssue更新でProjectが保存され、その行はInboxから消える。更新に失敗した場合は既存のエラー通知を出し、行はInboxに残る。
- **AC-3**: Inboxの行のIssueを開くとIssue詳細が表示される。
- **AC-4**: サイドバーとスマホ下部タブのInboxのバッジは振り分け待ちの件数を示し、0件ならバッジを出さない。
- **AC-5**: 振り分け待ちが0件のときは「振り分け待ちのIssueはありません」と、Issueを作成する導線を表示する。
- **AC-6**: Inboxと上部バーから通知の表示を外す（通知一覧・既読／未読操作・上部バーの通知ボタンを表示しない）。上部の説明ボックス（HOW INBOX WORKS）も表示しない（2026-11-14 ユーザー判断）。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|------|------------|-----------------|-------------------|------|
| 変更 | `/inbox`（既存ルート） | 表示内容を振り分け一覧へ変更。URLは不変 | 既存（Cloudflare Access） | 振り分け |
| 追加 | `selectInboxIssues(issues, workflowStates)` | `Issue[]` → `Issue[]`（projectId === null かつ status category ∉ {completed, canceled}、createdAt 降順） | — | 一覧・バッジ件数の算出 |

## このレイヤーが依存する下位の契約（呼び出す相手）

- 呼び出す相手: 既存 `PATCH /api/v1/issues/:issueId`（`useIssueActions().updateIssue` 経由。契約変更なし）
- 受け渡し: `{ projectId }`。冪等キー・versionは既存実装のまま

## 実装配置

- `src/components/inbox-triage.ts`（新規）: `selectInboxIssues`
- `src/components/OrbitApp.tsx`: `InboxView` の置き換え、上部バー通知ボタンの削除、バッジ件数の差し替え、通知ハンドラーの削除
- `src/styles.css`: 不要になった通知用スタイル（`.notification-*`・`.inbox-filter`・`.inbox-toolbar`・`.inbox-guide`・`.inbox-guide-steps`・`.inbox-list`）の削除、件数表示 `.inbox-triage-count` の追加

## UI/UX 方針（表示層が関与する場合のみ）

- **画面フロー / 導線**: サイドバー（COLLECTIONS）・スマホ下部タブ・コマンドパレットの「Inbox」から開く。上部バーの通知ボタンは削除する。
- **主要操作とフィードバック**: 各行のProject選択（`IssueRow` の既存セレクト）。既存の楽観的更新により選んだ時点で行が消え、成功で確定する。失敗は既存のエラーToastを出し、更新前の内容へ戻るため行はInboxに残る。タイトル部分のクリックでIssue詳細を開く。
- **状態設計（出し分け）**: 一覧あり / 0件（空状態「振り分け待ちのIssueはありません」＋「Issueを作成」ボタン）/ 保存中（pending）/ 失敗（Toast、行は残る）。
- **既存デザインシステムとの整合**: `IssueRow`・`EmptyState` を再利用。説明ボックス `.inbox-guide` は削除し、件数表示だけを出す。

### レスポンシブ / アクセシビリティ（表示層は必須・空通過禁止）

- 1440px・800px・390pxで横スクロールが出ないこと（`IssueRow` の既存レスポンシブに従う）。
- Issue一覧は1023px以下でProject列を隠すが、Inboxでは振り分けの主操作なので隠さず、行の2段目（期限より上）に出す（`.issue-table.inbox-triage-list .issue-row .project-cell`）。
- Projectセレクトは既存の `aria-label="<identifier>のProject"` を持つ。バッジは既存 `NavItem` の表現を使う。
- 一覧は件数を見出し横に表示する（例: 「振り分け待ち 3件」）。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| Project保存の失敗 | `updateIssue` 既存のエラーToast。楽観的更新を元に戻すため行はInboxに残る |
| Statusが見つからないIssue | カテゴリ不明として振り分け待ちに含める（安全側。完了扱いで隠さない） |

## テストケース（技法注記付き）

- [デシジョンテーブル] `selectInboxIssues`: Projectなし×未着手/進行中カテゴリ → 含む / Projectなし×完了 → 除外 / Projectなし×キャンセル → 除外 / Projectあり×未着手 → 除外 / Projectなし×Status不明 → 含む
- [代表値] `selectInboxIssues`: 作成日時の新しい順に並ぶ
- [境界値] `selectInboxIssues`: 空配列 → 空配列
- [代表値] InboxView: 振り分け待ちIssueと件数を表示し、説明ボックス・通知一覧・既読操作を表示しない
- [状態遷移] InboxView: Project選択で `PATCH /api/v1/issues/:id` に `{ projectId }` が送られ、行が消える
- [異常系] InboxView: 更新失敗でエラーを表示し、行がInboxに残る
- [代表値] InboxView: 行を開くと `/issues/:id` へ遷移する
- [境界値] InboxView: 0件で空状態と「Issueを作成」導線、ボタンでIssue作成ダイアログが開く
- [境界値] ナビゲーション: 振り分け待ち2件でサイドバー・下部タブのバッジが2、0件でバッジなし
- [回帰] 上部バーに通知ボタンが無い
- [境界値] 1023px以下でもProjectセレクトを `display: flex`・2段目に出し、期限は3段目
