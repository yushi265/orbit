# PHASE1: data

## 担保 AC（[index.md](./index.md) の引用）

- **AC-1**: 本番 Owner bootstrap コマンドは、必須設定の欠落・不正をリモート実行前に拒否し、`users`、`user_preferences`、`user_runtime_locks`をOwner単位で冪等に初期化する。既存のOwner行・メールアドレス・設定値を上書きしない。
- **AC-2**: 本番の認証境界は、Access JWT・issuer・audience・email・`OWNER_USER_ID`に対応する`users`行をすべて検証し、未認証・設定不足・D1 binding不足・Owner不一致ではMemory Storeへフォールバックせず、定義済みの401または500 ErrorEnvelopeを返す。
- **AC-4**: 本人はWorkflow stateを一覧・追加・名称/色/順序/既定値変更・削除できる。カテゴリは`backlog / unstarted / started / completed / canceled`に限定し、Owner外の参照を拒否し、既定stateは常に1件、Issueが参照中または既定stateの削除は拒否し、同じidempotencyKeyの再送はNo-opになる。
- **AC-5**: Background Runが`pending`または`running`の間、Preferences / Workflowを含む業務Mutationは423 `OPERATION_IN_PROGRESS`で拒否され、Issue・Activity・Outbox・Receipt・設定値を変更しない。`GET /api/v1/background-runs/current`とBootstrapは本人のRun状態だけを返し、`lock_token`と`admission_token`を公開しない。

## このレイヤーが公開する契約

| 対象 | 契約 | Owner / 整合性 |
|---|---|---|
| Bootstrap | `users(id PRIMARY KEY, name, email)`、`user_preferences(user_id PRIMARY KEY)`、`user_runtime_locks(user_id PRIMARY KEY)` | `ownerUserId`単位。既存行は`ON CONFLICT DO NOTHING`で保持する |
| Workflow | 既存`workflow_states`の`id / user_id / name / category / color / position / is_default` | `user_id`を全操作へ要求。defaultはOwnerごとに1件、positionは0始まり連続値 |
| Snapshot | 既存`orbit_store_snapshots(user_id, version, state_json, updated_at)` | 本番SessionのVersion CASを利用し、D1 bindingがない場合は失敗 |

### Bootstrap SQL

`pnpm run db:bootstrap:production`は`OWNER_USER_ID`、`OWNER_EMAIL`、任意の`ORBIT_OWNER_NAME`を引数として、次の3表へinsertする。Wranglerの`--command`へ渡す必要があるため、`<...Literal>`はスクリプトがquoteしたSQL literalへ展開し、shellは経由しない。

```sql
INSERT INTO users (id, name, email, avatar_url, created_at) VALUES (<ownerIdLiteral>, <ownerNameLiteral>, <ownerEmailLiteral>, NULL, <now>) ON CONFLICT(id) DO NOTHING;
INSERT INTO user_preferences (user_id, timezone, locale, theme, color_theme, issue_counter, estimate_enabled, default_issue_display_json)
VALUES (<ownerIdLiteral>, 'Asia/Tokyo', 'ja', 'system', 'coral', 0, 1, '{}') ON CONFLICT(user_id) DO NOTHING;
INSERT INTO user_runtime_locks (user_id, run_id, lock_token, status, acquired_at, heartbeat_at, lease_expires_at)
VALUES (<ownerIdLiteral>, NULL, NULL, 'idle', NULL, NULL, NULL) ON CONFLICT(user_id) DO NOTHING;
```

実行前に必須値の形式（Owner ID / email）をローカルで検証し、失敗時は`wrangler d1 execute`を呼び出さない。

## 異常系挙動

| シナリオ | dataの挙動 |
|---|---|
| Owner ID / email欠落・不正 | D1への書き込みなし。既存行を読み取るremote commandも実行しない |
| 既存Owner行 | name / email / preference / lockを上書きしない |
| Owner外ID | Repository / Snapshotのread・write対象外として扱う |
| lock中のWorkflow mutation | Storeの副作用、Receipt、Activity、Outboxを増やさず423へ委譲 |
| D1 bindingなし | production Memory fallbackなし。呼び出し側で500へ変換 |

## テストケース（技法注記付き）

- [デシジョンテーブル] 必須設定が全て有効ならremote commandを組み立て、欠落・不正ならcommandを実行しない。
- [状態遷移] bootstrapを初回 / 同じ値で再実行 / 既存値が異なる状態で実行し、既存行を保持する。
- [代表値] bootstrap後にOwner lookupとproduction Sessionが同じOwnerを解決する。
- [デシジョンテーブル] 自Owner / 他Owner / users行なしを分け、他OwnerのWorkflow・Snapshotを読み書きしない。
- [状態遷移] Workflowのdefault変更・position変更・削除を実行し、default 1件とposition連続性を維持する。
- [状態遷移/禁止] 既定stateまたはIssue参照中stateの削除を拒否し、業務データと台帳を変更しない。
- [状態遷移] Background lock中のPreferences / Workflow mutationを423にし、version / Activity / Outbox / Receiptを不変にする。
