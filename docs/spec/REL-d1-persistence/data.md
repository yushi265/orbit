# REL: D1永続化Adapter（data）

## 担保AC

- **AC-1**: 本番のMutation成功後に別リクエストを行うと、Issue・Project・Label・Cycle・View・Notification・Preferenceの変更がD1から復元される。
- **AC-3**: 同じOwnerの同時リクエストが同じD1スナップショットVersionを読んだ場合、先に保存した1件だけが成功し、後続は409 `D1_WRITE_CONFLICT`になり、後続の状態で先行更新を上書きしない。
- **AC-5**: スナップショットの保存・復元で、公開Bootstrapに必要な全Map / ArrayとBackground Runの内部状態が欠落しない。
- **AC-6**: Migration適用後、所有者ごとに1行だけスナップショットを保持でき、別Ownerの状態を読み書きできない。

## スキーマ / Migration

`orbit_store_snapshots`を追加する。

| 列 | 型 / 制約 |
|---|---|
| `user_id` | `TEXT PRIMARY KEY`、`users.id`へcascade |
| `version` | `INTEGER NOT NULL`、0以上 |
| `state_json` | `TEXT NOT NULL` |
| `updated_at` | `INTEGER NOT NULL` |

保存は`INSERT ... ON CONFLICT(user_id) DO UPDATE ... WHERE version = expectedVersion`で行い、期待Version 0の初回保存後はVersion 1とする。変更行数0をVersion競合とする。Read / Writeの両方に`user_id`を必須条件として、Owner間の横断を許可しない。

## テストケース

- [代表値] Empty Storeをserialize → restoreしてOwner / defaultsを保持する。
- [代表値] Issue / Project / Label / Cycle / View / Notification / Preferenceを保存して再ロードする。
- [代表値] Run / Lock / Receipt / Activity / Outbox / Cycle historyの内部状態を保存して再ロードする。
- [同値分割] Version一致のCAS更新は成功、Version不一致は0 changesになる。
- [境界値] Version 0の初回Insert、Version 1以上のUpdate、JSON.stringify不能なSnapshotの保存失敗を確認する。
- [デシジョンテーブル] Owner A / Owner B / 不存在OwnerのSnapshot keyを分離する。

## 異常系挙動

- JSON parse失敗は内部エラーとして扱い、個人データをログへ出さない。
- D1 Bindingなしで本番Sessionを開く場合は例外にし、Memory Storeへフォールバックしない。
- Version競合時は既存行を変更せず、呼び出し側へ409契約を返す。
