# FEAT-project-archive-delete: Projectをアーカイブ（非表示）・削除する

## 概要

Projectは作るだけで、使わなくなったものを隠したり消したりできない。サーバーにはアーカイブAPI（`POST /api/v1/projects/<id>`）だけがあり、画面からは使えず、戻す手段も削除も無い。Project詳細に「アーカイブ」「元に戻す」「削除」を置き、アーカイブしたProjectはIssuesのタブ・Home・IssueのProject選択から外し、Projects一覧では「アーカイブ済み」にまとめる。削除したProjectは全画面から消し、入っていたIssueは「Projectなし」として残す。

## 対象範囲

- 対象レイヤー: [service](./service.md) / [ui](./ui.md)
- `POST /api/v1/projects/<id>`に`action`（`archive` / `restore` / `delete`）を足す。`action`なしは従来どおりアーカイブ
- 削除時に、そのProjectに入っていたIssueのProjectを外す
- Projects一覧・Project詳細・IssueのProject選択欄の表示

## 対象外

- 削除したProjectを画面から戻す機能（削除は確認ダイアログを経た取り消せない操作として扱う。30日後の自動掃除は既存の仕組みのまま）
- D1の正規化テーブル（`projects`）とSQL Migrationの変更（`archivedAt` / `deletedAt`は既存の項目。実行時はSnapshotだけを使う）
- Project表示設定（`projectDisplayPreferences`）の後片付け（PR #41の残課題。別PR）
- 保存済みView・IssuesのURL（`?project=`）に残ったアーカイブ済み／削除済みのProject IDの書き換え
- Searchの結果からアーカイブ済みProjectを外すこと（探せる方が便利なため従来どおり）

## ユニット計画

単一ユニット。実装はservice → uiの順。

## 受け入れ基準（AC）

- [ ] **AC-1**: `POST /api/v1/projects/<id>?action=restore`は、Ownerの未削除Projectの`archivedAt`を`null`に戻し、`updatedAt`を更新して200 `{ project }`を返す。`position`は変えない。アーカイブされていないProjectへの要求は成功として扱い、何も変更しない。`?action=archive`と`action`なしは従来のアーカイブと同じ動作をする。
- [ ] **AC-2**: `POST /api/v1/projects/<id>?action=delete`は、Ownerの未削除Project（アーカイブ済みを含む）の`deletedAt`と`updatedAt`を現在時刻にし、200 `{ project }`を返す。以降、そのProjectは`GET /api/v1/projects`とBootstrapの`projects`に含まれず、更新・アーカイブ・復元・削除・並べ替え・IssueへのProject設定は404 `RESOURCE_NOT_FOUND`になる。
- [ ] **AC-3**: 削除と同じ操作の中で、Ownerの全Issue（アーカイブ済み・ゴミ箱内を含む）のうち`projectId`が削除したProjectのものは、`projectId`を`null`にし、`version`を1増やし、`updatedAt`を更新する。他のIssueと他のProjectは変えない。
- [ ] **AC-4**: 復元・削除は、ActivityとOutboxをProjectについて1件ずつ記録する（復元: Activity `restored`・Outbox `project.restored`、削除: Activity `deleted`（`after`に`deletedAt`と外したIssueの件数`detachedIssueCount`）・Outbox `project.deleted`）。同じ`Idempotency-Key`の再送は初回の応答を返して何も変えない。復元で何も変えなかった場合はActivity・Outboxを記録しない。
- [ ] **AC-5**: `action`が`archive`・`restore`・`delete`以外は400 `VALIDATION_ERROR`（`fieldErrors.action`）、Projectが無い・他Owner・削除済みは404 `RESOURCE_NOT_FOUND`、Background Runによるロック中は423 `OPERATION_IN_PROGRESS`、`Idempotency-Key`が無いと400 `VALIDATION_ERROR`とし、失敗時はProject・Issue・Activity・Outbox・Receiptを変更しない。
- [ ] **AC-6**: Projects一覧は、アーカイブされていないProjectを従来どおり（並べ替えボタン付き）表示し、アーカイブ済みProjectはその下の「アーカイブ済み（{件数}）」の折りたたみ（初期は閉じる）にまとめる。アーカイブ済みのカードは並べ替えボタンを持たず、「アーカイブ済み」の印を出し、押すとProject詳細へ遷移する。アーカイブ済みが0件なら折りたたみを出さない。
- [ ] **AC-7**: Project詳細は、アーカイブされていないProjectに「アーカイブ」ボタン、アーカイブ済みProjectに「このProjectはアーカイブ済みです」の表示と「元に戻す」ボタンを出す。押すとAPIを呼び、成功したら最新のデータを読み込んで表示を切り替える。失敗したらエラーを表示し、表示はそのまま。処理中はボタンを無効にする。
- [ ] **AC-8**: Project詳細の「削除」ボタンは確認ダイアログ（題「Projectを削除しますか？」、本文に「{Project名}」と、Projectから外れるIssueの件数、元に戻せないこと）を開く。「削除する」で削除APIを呼び、成功したらProjects一覧へ移動して最新のデータを読み込む。「キャンセル」・Escでは何もしない。失敗したらダイアログ内にエラーを表示し、ダイアログを閉じない。
- [ ] **AC-9**: IssueのProject選択欄（一覧の行・詳細・作成・一括変更）は、アーカイブ済みProjectを選択肢に出さない。ただし、そのIssueに今設定されているProjectがアーカイブ済みのときは、そのProjectだけを「{Project名}（アーカイブ済み）」として出す。IssuesのProjectタブとHomeのProject一覧は従来どおりアーカイブ済みを出さない。
- [ ] **AC-10**: 外部bot向けの手順（`docs/external-api.md`）に、Projectのアーカイブ・復元・削除の呼び方と、削除時にIssueのProjectが外れることを書く。

## アーキテクチャ / レイヤー間フロー

ui（Project詳細のボタン・確認ダイアログ）→ `POST /api/v1/projects/<id>?action=...`（`Idempotency-Key`ヘッダー）→ service（`OrbitStore.archiveProject` / `restoreProject` / `deleteProject`がProject・Issueを更新し、Activity / Outbox / Receiptを記録）→ D1 Snapshot保存 → uiがBootstrapを再取得 → 一覧・タブ・選択欄に反映。

## エラー・ログ方針（横断サマリ）

| シナリオ | service | ui |
|---|---|---|
| 不明な`action` | 400 `VALIDATION_ERROR` | 画面からは送らない |
| Projectが無い／他Owner／削除済み | 404 `RESOURCE_NOT_FOUND` | エラー表示（詳細: 画面内、削除: ダイアログ内）。表示はそのまま |
| Background Runのロック中 | 423 `OPERATION_IN_PROGRESS` | 同上 |
| 同じキーで異なる内容 | 409 `IDEMPOTENCY_KEY_REUSED` | 同上 |
| D1の保存競合 | 409 `D1_WRITE_CONFLICT`（既存） | 同上 |

新しいErrorCode・ログは追加しない。

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | — | service: 復元・未アーカイブへの復元・action省略/archive |
| AC-2 | — | service: 削除後の一覧・Bootstrap・各操作の404 |
| AC-3 | — | service: Issueの`projectId`・`version`、他Issue不変 |
| AC-4 | — | service: Activity・Outbox件数、再送 |
| AC-5 | — | service: HTTP経由で400 / 404 / 423 / キーなしと不変 |
| AC-6 | ui: アーカイブ済みの振り分け | ui: 一覧の描画 |
| AC-7 | — | ui: 詳細のボタンとAPI呼び出し・失敗表示 |
| AC-8 | — | ui: 確認ダイアログ・遷移・失敗表示 |
| AC-9 | ui: 選択肢の算出 | — |
| AC-10 | — | ドキュメントのみ（レビューで確認） |

テストケースの詳細は各レイヤーのファイル。

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `archiveProject`（Store・Handler・ルート）、Issueの`?action=`による分岐（`postIssueAction`の形）、`restoreIssue` / `trashIssue`の検証順・Receipt、Cycleの確認ダイアログ（`Modal`・`modal-actions`）、`purgeTargets`の30日後の掃除。
- 差分: `restoreProject` / `deleteProject`の追加、Handlerの`action`分岐、Projects一覧の振り分け、詳細のボタン、選択肢の算出関数。
- 衝突と解消:
  - [FEAT-project-manual-order](../FEAT-project-manual-order/index.md): 並べ替えは未削除の全Project（アーカイブ済みを含む）で1本の位置を持つ。一覧の並べ替えボタンはアーカイブされていないカードの並びで1つ動かすので、アーカイブ済みが間に挟まっても操作上は見えない（同specのトレードオフのまま）。
  - [FIX-snapshot-growth](../FIX-snapshot-growth/index.md): 削除で外したIssueごとのActivityは書かず、Projectの1件に件数をまとめる（AC-4）。
  - Issueの`projectId`が削除済みProjectを指したまま残ると、30日後の掃除でProjectが消えた後に宙に浮く。削除時に外すことで解消する（AC-3）。

## 実装に効く制約

- マージは本番デプロイになる。保存データの形は変わらない（既存項目の値が変わるだけ）。
- 旧版へ戻す場合: Worker Versionだけを切り替える。旧版も`deletedAt`ありのProjectを一覧から外し、`archivedAt`は既存の項目なので、データはそのまま読める。

## 判断根拠 / 未決事項

- アーカイブ＝「非表示」、削除＝「消す」の2段にする理由: 依頼が「非表示というか削除」で、どちらも欲しい可能性が高い。アーカイブは戻せる軽い操作、削除は確認付きの重い操作として分ける。
- 削除したProjectのIssueは「Projectなし」として残す（Gate 1・2026-11-24。他案「Issueもゴミ箱へ」「Issueがある間は削除不可」は不採用）。
- 削除の取り消しを画面に置かない理由: 確認ダイアログで十分で、ゴミ箱画面をProjectにも作るのは今の利用規模に見合わない（YAGNI）。
- `DELETE`メソッドではなく`?action=delete`にする理由: 既存のProject・Issueのアーカイブ／復元／ゴミ箱が`POST ?action=`で揃っており、外部botの呼び方も同じにできる。
- 未決事項なし。
