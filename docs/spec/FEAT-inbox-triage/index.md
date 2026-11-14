# FEAT-inbox-triage: Inboxを振り分け待ちIssueの置き場にする

## 概要

InboxをProject未設定の未完了Issueが集まる「振り分け待ちの置き場」に作り替える。Issueをとりあえず登録してInboxへ溜め、Inbox上でProjectを選んで振り分ける。本番で通知が生成されない現状を踏まえ、通知の表示はInboxから外す。

## 対象範囲

- 対象レイヤー: ui（[ui.md](./ui.md)）
- 対象ドメイン: Issue（Project割り当て）・ナビゲーション
- 対象外（やらないこと）:
  - API・Zod契約・D1スキーマ・ルーティングの変更（`/inbox` のURLはそのまま使う）
  - 通知のサーバー側実装（Notification model・`/api/v1/notifications`）の削除。将来の通知生成のために残す
  - Inbox上でのCycle・Status等の振り分け（Projectのみ。他の属性はIssue詳細で設定する）
  - 振り分け待ちの条件をCycleなし等に広げること（2026-11-14 ユーザー判断: Projectなしだけ）

## ユニット計画

単一ユニット。

## 受け入れ基準（AC）

- [ ] **AC-1**: InboxにはアーカイブされていないIssueのうち、Projectが未設定で、Statusのカテゴリが完了・キャンセル以外のものを作成日時の新しい順に表示する。Projectが設定されたIssue、完了・キャンセルのIssueは表示しない。
- [ ] **AC-2**: Inboxの各行でProjectを選ぶと既存のIssue更新でProjectが保存され、その行はInboxから消える。更新に失敗した場合は既存のエラー通知を出し、行はInboxに残る。
- [ ] **AC-3**: Inboxの行のIssueを開くとIssue詳細が表示される。
- [ ] **AC-4**: サイドバーとスマホ下部タブのInboxのバッジは振り分け待ちの件数を示し、0件ならバッジを出さない。
- [ ] **AC-5**: 振り分け待ちが0件のときは「振り分け待ちのIssueはありません」と、Issueを作成する導線を表示する。
- [ ] **AC-6**: Inboxと上部バーから通知の表示を外す（通知一覧・既読／未読操作・上部バーの通知ボタンを表示しない）。上部の説明ボックス（HOW INBOX WORKS）も表示しない（2026-11-14 ユーザー判断）。

## アーキテクチャ / レイヤー間フロー

```text
Bootstrap.issues（アーカイブ・削除以外の全Issue） + workflowStates
  ↓ selectInboxIssues（ui内の純関数）
InboxView（IssueRowを再利用）
  └─ Project選択 → 既存 updateIssue（楽観的更新 → PATCH /api/v1/issues/:id { patch: { projectId } }、失敗時は元に戻す）
```

## エラー・ログ方針（横断サマリ）

| シナリオ | service | 表示層の挙動 |
|---|---|---|
| Project保存の失敗（409/423/5xx等） | 既存のIssue更新エラー | 既存のエラーToast。行はInboxに残る |
| 振り分け待ち0件 | — | 空状態と作成導線 |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|----|------|--------------|
| AC-1 | `selectInboxIssues` の条件・並び順 | InboxViewの表示 |
| AC-2 | — | Project選択でPATCHが送られ行が消える・失敗時に行が残る |
| AC-3 | — | 行を開くとIssue詳細へ遷移する |
| AC-4 | — | サイドバー・下部タブのバッジ件数 |
| AC-5 | — | 空状態 |
| AC-6 | — | 通知UI・上部バー通知ボタン・説明ボックスが無い |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `IssueRow`（Project選択・pending表示）、`useIssueActions().updateIssue`（エラーToast・refresh）、Bootstrapの `issues`（`matchingIssues(defaultQuery())` はアーカイブ・削除以外を件数上限なしで返す）。
- 差分: `InboxView` の中身を通知一覧から振り分け一覧へ置き換える。上部バーの通知ボタンを削除する。バッジの件数を未読通知数から振り分け待ち件数へ変える。
- 衝突: [FEAT-inbox-notifications](../FEAT-inbox-notifications/index.md) のUI部分（AC-2・AC-3）を置き換える。サーバー側（AC-1）はそのまま残す。要件 NOTIF-01〜04 は保留扱いとし、`docs/requirements/01-product.md` のInbox行を更新する。

## 実装に効く制約

- ui層からD1へ直接アクセスしない。Bootstrapのデータと既存mutationだけを使う。
- 共有契約（Zod・API）は変更しない。

## 判断根拠 / 未決事項

- 振り分け待ちの判定はクライアントの純関数で行う。Bootstrapの `issues` が全件を返すため完全な一覧になり、API追加（Tier 1）が不要になる。件数が非常に増えた場合はサーバー側フィルタへの移行を検討する（今は不要: YAGNI）。
- 通知UIは削除する。本番で通知が生成されず空のまま残るため、振り分け一覧と同居させると使い方が分かりにくくなる。通知生成を実装するときに別の入口として戻す。
- 並び順は作成日時の新しい順。新しく放り込んだものが上に来るほうが「とりあえず入れる」使い方に合う。
- 未決事項: なし。
