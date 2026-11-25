# FEAT-daily-digest-email: data 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-4**: Cron Trigger（UTC 22:30＝JST 7:30）で起動し、`EMAIL` binding・`ORBIT_DIGEST_FROM`・`ORBIT_DIGEST_TO`・`ORBIT_APP_URL`のどれかが無い、またはD1のsnapshotがちょうど1件でない場合は送らずにスキップ理由だけをログに出す。
- **AC-6**: 既存のHTTP（fetch）の挙動を変えない。scheduled処理はD1へ書き込まない。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|------|------------|-----------------|-------------------|------|
| 追加 | `listStoreSnapshotUserIds(database: D1Database): Promise<string[]>` | `SELECT user_id AS userId FROM orbit_store_snapshots ORDER BY user_id LIMIT 2`。文字列以外の行は `Invalid D1 snapshot row` を投げる | Worker内部のみ（HTTPに出さない） | 送信対象Ownerの特定（件数判定は2件取れば足りる） |

スキーマ・Migrationの変更はない。

## 実装配置

- `src/db/repositories/store-snapshot.ts`（関数追加）
- テスト: `src/db/repositories/store-snapshot.test.ts`（無ければ新規）

## 異常系挙動

- 0件なら空配列。2件以上ならそのまま返し、件数判定はservice側で行う。

## テストケース

- [代表値] 1件 → `[userId]`
- [境界値] 0件 → `[]`、2件 → 2要素
- [異常系] user_id が文字列でない行 → 例外
- [代表値] 発行するSQLがSELECTだけ
