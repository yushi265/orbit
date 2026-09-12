# ローカル専用動作: data計画

本書は2026-09-08の実装指示に基づく契約。

## 担保 AC（引用文）

- **AC-2**: Issue・Project・Label・Cycle・View・Notification・PreferenceとRun内部状態が、保存成功後のサーバー再起動でも保持される。
- **AC-4**: ローカル初期化は再実行しても既存データを変更せず、DB欠落・破損・書込失敗でMemory Storeへフォールバックしない。
- **AC-5**: 競合更新は409 D1_WRITE_CONFLICTとなり、失敗したRequestはSnapshotを保存せず、Owner間のデータが混在しない。
- **AC-6**: 停止中に作成したバックアップから別の空の保存先へ復元でき、業務データとRun内部状態が一致する。

## スキーマ・Owner契約案

新規テーブル・列・Migrationは予定しない。既存`drizzle/`のMigrationをローカルDBへ順に適用し、`orbit_store_snapshots(user_id, version, state_json, updated_at)`を正本とする。既存の`users`外部キーとVersion CASを維持する。

| 固定Owner値 | 提案値 |
|---|---|
| userId | `local-owner` |
| email | `local-owner@orbit.local` |
| name | `Orbit User` |

初期化は`users`、`user_preferences`、`user_runtime_locks`の必要行を冪等に挿入する。既存bootstrapのSQL生成・入力検証は再利用候補だが、remote実行関数は呼ばない。同じIDが異なるemailで存在する場合は停止し、自動で別Ownerへ切り替えない。

初回はIssue等のデモデータを作らない。Workflow State、Cycle設定などアプリに必要な既定状態は既存`ensureOwner`等を使う。DB Owner登録とSnapshot内Ownerを一致させ、固定Ownerが`dev-owner`向けデモ分岐に入らないようにする。既存Snapshotのフィールド・Map・配列を省略しない。

## 初期化・保存・復元

- 保存ディレクトリとDB名は[infra.md](./infra.md)を参照。同一の解決済み絶対パスを全コマンドで共用する。
- 初期化: サーバー停止確認→Migration適用→Owner行の不足分のみ挿入→整合性確認。Snapshotの削除・再seedはしない。
- 初期Request: Owner登録済みでSnapshotがない場合のみ、既存Storeの初期Snapshotを作る。
- 保存: `readStoreSnapshot` / `writeStoreSnapshot` / `OrbitStore.toSnapshot` / `fromSnapshot`を再利用。Owner条件を必須とする。
- バックアップ: 全ローカルサーバー・DB利用プロセスを停止した後、永続状態ディレクトリ全体を新規バックアップ先へコピーする。SQLite単一ファイルだけをコピーしない。
- バックアップの隣に、作成日時、OrbitのGit revisionと未コミット変更の有無、Node / pnpm / Wrangler / Pluginの版、lockfileのハッシュを記録する。内容・認証情報は記録しない。
- 復元: 同じツール版とコードを用意→空の別保存先へ全体コピー→その保存先を指定して起動→データとRun状態を照合。既存保存先への上書きは今回実装しない。
- バージョン更新前にバックアップを取得する。古いバックアップにMigrationを適用する場合はコピー側で行う。DBのdowngradeは行わない。

## 実装配置

- `scripts/bootstrap-owner.mjs`: SQL生成の再利用候補。既存productionコマンドの動作を維持。
- `scripts/local.mjs`（追加予定）: local初期化・バックアップ・復元の実行。infraと一体で実装。
- `src/db/repositories/store-snapshot.ts`、`src/server/store.ts`: 原則再利用。欠落が判明した場合のみ修正。
- `src/db/migration.test.ts`、Snapshot / persistenceテスト、ローカル実D1結合テスト。

## 異常系挙動

Migration失敗・Owner衝突・保存先権限不足はCLI非ゼロ終了とし、起動工程へ進まない。運用データを消してやり直す処理は作らない。DB破損は自動再作成しない。復元先が空でない場合・バックアップコピーが失敗した場合は拒否し、不完全なコピーを成功と報告しない。

## テストケース

- [状態遷移] 空DB→Migration→Owner→Bootstrap→保存→プロセス再起動で保持する。
- [状態遷移] 変更済みDBで初期化を再実行し、Owner設定とSnapshot・receipt・lockが変わらない。
- [同値分割] Owner未登録 / 登録済み / ID衝突を検証し、外部キー違反を握り潰さない。
- [状態遷移] 同一Owner競合の勝者1件、別Ownerの保存・読込分離を実ローカルD1で検証する。
- [代表値] Issue / Project / Label / Cycle / View / Notification / PreferenceとActivity / Outbox / receipt / Run / lock / cursor / Cycle履歴を保存・復元して一致する。
- [状態遷移] 停止→バックアップ→別の空ディレクトリへ復元→再起動。Snapshot一致に加え、更新操作とRun復旧を確認する。
- [同値分割] 非空の復元先・コピー失敗・書込不可・不正Snapshotで元データを保持して失敗する。
