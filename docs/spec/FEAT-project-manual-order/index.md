# FEAT-project-manual-order: Projectの表示順を手動で並べ替える

## 概要

Projectの表示順は「更新が新しい順」に固定で、Projectを編集するたびに順番が入れ替わる。Projectに位置を持たせ、Projects一覧の「上へ」「下へ」ボタンで並べ替えられるようにする。順番はサーバーの一覧の並びで決まるため、Projects一覧・Home・IssueのProject選択欄・フィルターなど全画面に同じ順が反映される。

## 対象範囲

- 対象レイヤー: [shared](./shared.md) / [service](./service.md) / [ui](./ui.md)
- Projectに`position`を追加し、一覧を位置の昇順で返す
- 並べ替えAPI `POST /api/v1/projects/reorder` を追加する
- 位置を持たない既存データ（旧Snapshot）を読み込み時に補う
- Projects一覧のカードに「上へ」「下へ」ボタンを置く

## 対象外

- ドラッグでの並べ替え（Gate 1で「↑↓ボタン」を選択）
- D1の正規化テーブル（`projects`）とSQL Migrationの変更（実行時はSnapshotだけを使うため）
- Projectごとの楽観ロック（`version`）の追加
- Project選択欄やフィルター側での並べ替え操作
- Project statusの並び順（既存のSettingsの機能のまま）

## ユニット計画

単一ユニット。実装はshared → service → uiの順。

## 受け入れ基準（AC）

- [x] **AC-1**: Projectは整数の`position`を持ち、`GET /api/v1/projects`とBootstrapの`projects`は、Ownerの未削除Projectを`position`の昇順（同値は`createdAt`の昇順、さらに同値は`id`の昇順）で返す。Projectの更新・アーカイブ・復元では順番が変わらない。
- [x] **AC-2**: 新しく作成したProjectは、Ownerの未削除Projectの末尾（最大の`position`+1。1件も無ければ0）に入る。
- [x] **AC-3**: `position`を持たないProjectを含むSnapshotを読み込むと、Ownerごとに、`position`を持つProjectの後ろへ、持たないProjectを`createdAt`の昇順（同値は`id`の昇順）で連番に割り当てる。全件が持たない場合は0からの連番になる。何度読み込んでも同じ結果になり、読み込んだだけでは保存を発生させない。
- [x] **AC-4**: `POST /api/v1/projects/reorder`は、`projectId`のProjectを`beforeProjectId`のProjectの直前（`null`なら末尾）へ移動し、Ownerの未削除Project全体の`position`を0からの連番に振り直して、移動後のProjectを返す。順番が変わらない要求は成功として扱い、何も変更しない。
- [x] **AC-5**: 並べ替えは、対象・移動先がOwnerの未削除Projectであることを検証する。存在しない・他Owner・削除済みは404 `RESOURCE_NOT_FOUND`、`beforeProjectId`が対象自身は400 `VALIDATION_ERROR`、Background Runによるロック中は423 `OPERATION_IN_PROGRESS`とし、失敗時は`position`・Activity・Outbox・Receiptを変更しない。
- [x] **AC-6**: 並べ替えが成功して順番が変わったとき、ActivityとOutboxは対象Projectの1件ずつだけを記録し、他のProjectの`updatedAt`を変更しない。同じ`idempotencyKey`・同じ内容の再送は初回の応答を返し、順番・Activity・Outboxを変えない。同じキーで異なる内容は409 `IDEMPOTENCY_KEY_REUSED`。
- [x] **AC-7**: `position`を追加したSnapshotは、D1 Sessionで保存して読み直しても全Projectの`position`が保たれ、rollback互換codec（`encodeStoreSnapshot` / `decodeStoreSnapshot`）の往復でも保たれる。
- [x] **AC-8**: Projects一覧の各カードは「上へ」「下へ」ボタン（名前「{Project名}を上へ移動」/「{Project名}を下へ移動」）を持つ。押すと表示中の並びで1つ前／1つ後ろへ移動し、成功後に一覧が新しい順で表示される。先頭の「上へ」と末尾の「下へ」、および処理中の全ボタンは無効になる。
- [x] **AC-9**: 並べ替えが失敗したときは、エラーのトーストを表示し、一覧の順番を変えない。ボタンは再び押せる状態に戻る。
- [x] **AC-10**: ボタンの操作でProject詳細へ遷移しない。カード本体を押したときの遷移と、Project詳細・Home・IssueのProject選択欄・フィルターは、並び順以外は従来と変わらない。

## アーキテクチャ / レイヤー間フロー

ui（Projects一覧のボタン）→ `POST /api/v1/projects/reorder`（shared契約で検証）→ service（`OrbitStore.reorderProject`が位置を振り直し、Activity / Outbox / Receiptを記録）→ D1 Snapshot保存 → uiがBootstrapを再取得 → 全画面が新しい順で表示。読み込み時は`OrbitStore.fromSnapshot`が位置の無いProjectを補う。

## エラー・ログ方針（横断サマリ）

| シナリオ | service | ui |
|---|---|---|
| 対象・移動先が無い／他Owner／削除済み | 404 `RESOURCE_NOT_FOUND` | エラーのトースト。順番はそのまま |
| 移動先が対象自身・入力の形が不正 | 400 `VALIDATION_ERROR` | 同上 |
| Background Runのロック中 | 423 `OPERATION_IN_PROGRESS` | 同上（既存のロック表示のまま） |
| 同じキーで異なる内容 | 409 `IDEMPOTENCY_KEY_REUSED` | 同上 |
| D1の保存競合 | 409 `D1_WRITE_CONFLICT`（既存） | 同上 |

新しいErrorCode・ログは追加しない。

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | — | service: 一覧とBootstrapの順、更新・アーカイブ後の順 |
| AC-2 | — | service: 作成後の位置 |
| AC-3 | — | service: 旧Snapshotの読み込み、D1 Sessionで保存が発生しないこと |
| AC-4 | shared: 入力スキーマ | service: 移動の全パターン |
| AC-5 | shared: 入力の拒否 | service: 404 / 400 / 423と不変 |
| AC-6 | — | service: Activity・Outbox件数、再送、キー再利用 |
| AC-7 | — | service: D1 Sessionとcodecの往復 |
| AC-8 | ui: 移動先の算出 | ui: ボタンの表示・無効・API呼び出し |
| AC-9 | — | ui: 失敗時の表示 |
| AC-10 | — | ui: 遷移しないこと、API経由（HTTP）でのルート疎通 |

テストケースの詳細は各レイヤーのファイル。

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: Issueの並べ替え（`reorderIssue`の検証順・Receipt・ロック、`reorderIssueInputSchema`の形、`/api/v1/issues/reorder`のルートとHandlerの形）、`fromSnapshot`の既存の補完（`recentIssueViews`・`colorTheme`と同じ場所・同じ考え方）、`beforeIssueIdForDrop`（IDだけを使うので型を広げて再利用）、Settingsの並べ替えボタンの見た目。
- 差分: `Project.position`、`listProjects`の並び、`createProject`の位置、`reorderProject`、Snapshotの検証と補完、Projects一覧のカード構造。
- 衝突と解消:
  - [FIX-snapshot-growth](../FIX-snapshot-growth/index.md): 並べ替えで位置がずれた全件にActivity / Outboxを書くと肥大化する。対象1件だけに記録する（AC-6）。
  - [FIX-rollback-compatibility](../FIX-rollback-compatibility/service.md): 旧版のStoreはProjectレコードの未知の属性を保持し、検証は既知の項目だけを見る。`position`は数値の追加属性なので旧版でも読める。旧版で作成されたProjectは`position`を持たないが、新版がAC-3で補う。
  - `listProjects`の「更新が新しい順」を前提にした既存テストは、位置の昇順へ期待値を更新する。
- codekb照合: 「失敗MutationはSnapshotを保存しない」「Runの失敗Chunkはdeep Snapshotで復元」「Receiptは24時間」— いずれも既存の仕組みに乗るだけで変更しない。

## 実装に効く制約

- マージは本番デプロイになる。保存データの形が変わるため、マージ前に`docs/deployment.md` 5章の確認（稼働Versionの記録・Runが動いていないこと・D1バックアップ）を行う。
- 旧版へ戻す場合: Worker Versionだけを切り替える。旧版は`position`を無視して「更新が新しい順」で表示し、データは保持される。

## 判断根拠 / 未決事項

- ↑↓ボタン・新規は末尾・初期は作成が古い順（Gate 1・2026-10-05）。
- 位置を連番に振り直す理由: Projectは個人利用で数十件までと見込み、全件の振り直しでも保存量は変わらない（Snapshotは毎回全体を書く）。間隔つきの位置や小数は、件数が少ない間は複雑さに見合わない。
- `updatedAt`を変えない理由: 並べ替えは内容の更新ではなく、並び順が`updatedAt`に依存しなくなるため。
- Projectに`version`を足さない理由: 並べ替えの競合はSnapshot全体のVersion CASで検出される。項目を足すと契約と全Mutationに波及する。
- 読み込み時の補完を保存しない理由: 補完は決定的なので、次のMutationで自然に保存される。読み込みだけで書き込みを起こすとGETが409になりうる。
- SQL Migrationを足さない理由: 正規化テーブルは実行時に使われておらず、今回の機能に効かない。正規化移行のボルトで合わせて扱う。
- 受け入れるトレードオフ: アーカイブ済みのProjectも位置を持ち、表示されない位置が間に挟まる。ボタンは表示中の並びで1つ動くので、操作上は見えない。
- 旧版互換の確認方法と限界: 1つ前の本番版（`1ac08ad`）とrollback互換の基準（`15eb0eb`）の`store.ts`を読み、`isSnapshot`が`hasTypes`で既知の項目の型だけを検証すること、復元がレコードをそのまま保持して`toSnapshot`がそのまま書き出すことを確認した。テストは`encodeStoreSnapshot`の出力が既存の項目を保つことを見る。旧版のコードで実際に読み込ませる実行確認は行っていない。
- 要件定義への反映: 手動並べ替えを[02-functional.md](../../requirements/02-functional.md)のPRJ-10として追加し、[04-architecture.md](../../requirements/04-architecture.md)のデータモデルに「`position`はSnapshot内だけ」の注記を足した（同じPR）。
- 確認方法: ブラウザ（PC幅 / 375x812、ライト / ダーク）で、新規Projectが末尾に入ること、↑の2回で先頭へ移ること、処理中の無効化、フォーカスの移り方、Project詳細へ遷移しないこと、BootstrapとIssuesのProjectフィルターが新しい順になること、ボタンと進捗の行が重ならないことを確認した。iPhone実機は未確認。
- 未決事項なし。
