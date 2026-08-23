# FEAT-issue-detail-workspace: Issue詳細ワークスペース

## 概要

既存のIssue専用URLを、タイトル・説明・主要属性・作業メモ・関連Issue・活動履歴を確認・更新できる詳細ワークスペースへ拡張する。既存の `issue_notes`、`issue_relations`、`activity_events` Schemaを再利用し、個人Owner境界と既存のversion / idempotency / Runtime lockを維持する。

## 対象範囲

- 対象レイヤー: shared / data / service / ui
- 対象ドメイン: issues / notes / relations / audit
- 対象画面: `/issues/$issueId` の詳細モーダル（URL正本、モバイルはフルスクリーン相当）
- 対象外: 親子Issueの進捗集計、Label CRUD、Bulk操作、DnD、実D1接続、Rich TextのHTMLレンダリング、ファイル添付

## ユニット計画

単一ユニット（Issue detail vertical slice）。共有契約 → Service / Memory Store → UIを同じ変更で実装する。

## 受け入れ基準（AC）

- [ ] **AC-1**: 本人が `/issues/$issueId` を開くと、対象Issueの主要属性、Markdown互換の説明、Notes、Relations、ActivityがOwner scopedで表示され、存在しないIssueまたは他OwnerのIssueは404相当の安全な詳細表示になる。
- [ ] **AC-2**: Issue詳細で説明を編集して保存すると、versionが1増えActivityが1件追加され、同じversionを使った競合Mutationは409になり既存の説明・Activity・Outboxを変更しない。保存中は入力を編集でき、失敗時は直前の内容へ戻して再試行を表示する。
- [ ] **AC-3**: 本人が1〜10,000文字のMarkdown互換メモを追加・編集・論理削除でき、空文字・10,001文字・他OwnerのNoteは拒否され、成功した追加・編集・削除はIssue Activityへ1件だけ記録される。
- [ ] **AC-4**: 本人が別の本人所有Issueへ `blocking / blocked_by / related / duplicate` Relationを追加・削除でき、自己参照・他Owner参照・同一Relationの重複は業務データを変更せず安全なエラーまたはNo-opになる。詳細画面ではRelation先のIssue番号とタイトルを表示する。
- [ ] **AC-5**: Background Runがrunningの間、説明・Note・RelationのMutationは423 `OPERATION_IN_PROGRESS`で拒否され、Issue version・Activity・Outbox・Note・Relationを増やさない。読み取りは継続できる。
- [ ] **AC-6**: Desktop / Tablet / Mobileの詳細画面で、主要操作がキーボードとPointerの両方で実行でき、Mobile幅390pxで横方向の表示崩れがなく、DialogをEscapeで閉じた後に元のIssue一覧へ戻れる。

## アーキテクチャ / レイヤー間フロー

```text
UI /issues/:id
  → shared detail / note / relation schema
  → service API adapter
  → owner-scoped OrbitStore (existing D1 tables are the persistence contract)
  → issue + notes + relations + activity response
```

## エラー・ログ方針（横断サマリ）

| シナリオ | shared | service / data | UI |
|---|---|---|---|
| Issue / Note / Relation不存在・Owner不一致 | `RESOURCE_NOT_FOUND` / 404 | DB変更なし、Security detailを外部へ返さない | Not Found表示、現在一覧へ戻る導線 |
| 説明 / Note / Relation入力不正 | `VALIDATION_ERROR` / 400 + fieldErrors | DB変更なし | 入力値を保持しフィールドエラー表示 |
| Issue version競合 | `ISSUE_VERSION_CONFLICT` / 409 | Issue / Activity / Outboxを変更しない | 最新値再取得、Conflict表示 |
| 同じidempotencyKeyの異なるRequest | `IDEMPOTENCY_KEY_REUSED` / 409 | 業務効果なし | 再試行Keyを生成し直す案内 |
| Background lock中 | `OPERATION_IN_PROGRESS` / 423 | 全関連Mutationを拒否 | Overlay / Retryを表示 |
| 予期せぬ障害 | `INTERNAL_ERROR` / 500 + requestId | 本文・Token・Cookieをログへ出さない | Error card + Retry |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | detail mapper / relation display mapper | API detail owner scope |
| AC-2 | description document / rollback reducer | Service version CAS + API error |
| AC-3 | note boundary / markdown projection | Note CRUD + activity / owner scope |
| AC-4 | relation normalization | Relation CRUD + duplicate / self / owner boundary |
| AC-5 | lock guard | Service mutation rejection |
| AC-6 | responsive state mapper | UI component / keyboard smoke（local browserで確認） |

UIのAC-1 / AC-2 / AC-6は、既存プロジェクトの方針（E2E自動化は任意、正常系の正本はレイヤー内結合）に合わせ、local browser smokeを受入証跡とする。今回Playwright用の新規実行基盤は追加せず、実D1 / Access接続と合わせてRelease hardeningで自動化する。

## 既存実装との関係（再利用 / 差分 / 衝突）

- `src/server/store.ts` のIssue CAS、Receipt、Activity、Outbox、Runtime lockを再利用する。
- `src/db/schema.ts` と初期Migrationに既存の `issue_notes` / `issue_relations` / `activity_events` を再利用し、今回Migrationは増やさない。
- `src/routes/issues/$issueId.tsx` は既存の `OrbitApp`専用URLを維持し、`IssueComposer`の既存表示分岐を詳細Panelへ置き換える。
- UIは `src/shared/view-models.ts` の公開型だけを参照し、`src/server/model.ts`を直接importしない。

## 実装に効く制約

- 全Read / Mutationは `ownerUserId`でスコープする。
- Issue説明の更新は既存 `version` CASと`idempotencyKey`を必須にする。
- Note / RelationのMutationにも同一Origin header、idempotency、Runtime lock、Activity / Outboxを適用する。
- Relationの表示は内部Token・メールアドレス・Cookieを含めない。
- Note本文はプレーンMarkdown互換テキストとして扱い、HTMLを直接dangerouslySetInnerHTMLしない。

## 判断根拠 / 未決事項

- 詳細画面は既存のIssue専用URLを正本にする。新しいページ状態を増やさず、既存Modalの深い分岐を一つのPanelへ整理する。
- Noteは保存形式を文字列に限定する。Tiptap導入やHTMLサニタイズは別機能に切り出し、今回のXSS境界を小さくする。
- Relationは4種類をwire valueとして固定し、同じsource / target / typeを重複登録しない。Relation方向の高度な正規化は次の改善に残す。
- Dataの実D1接続は前フェーズの残課題として後回しにし、今回の挙動は既存Memory Storeで契約テストを先に固定する。
- 未決事項なし。Gate 1 / Gate 2はユーザーの自律実行指示に基づき要点提示後に委任扱いとする。
