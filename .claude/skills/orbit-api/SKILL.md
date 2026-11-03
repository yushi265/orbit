---
name: orbit-api
description: 本番orbitのタスク（Issue）を外部bot用Service Token経由のAPIで追加・検索・更新・完了する手順スキル。「orbitにタスク追加して」「orbitのタスクを完了にして」「orbitで〇〇を探して」など、アプリの画面を開かずに本番データを操作したい時に使用する。コードの実装・修正には使わない（それは ai-dlc-flow）。
---

# orbit API 操作

本番orbitの`/api/v1`を`scripts/orbit-api.mjs`で呼ぶ。認証の仕組み・全endpoint・curl例は[`docs/external-api.md`](../../../docs/external-api.md)が正本。

## 前提

環境変数を設定する（値はチャット・ログ・ファイルに出さない。未設定なら設定方法だけを案内して止まる）。

| 変数 | 値 |
|---|---|
| `ORBIT_URL` | `https://orbit.ae265-1108.workers.dev` |
| `ORBIT_CF_CLIENT_ID` | Service Token `orbit-grok-bot` の Client ID |
| `ORBIT_CF_CLIENT_SECRET` | 同 Client Secret（Ownerのパスワードマネージャーにある） |

```bash
node scripts/orbit-api.mjs <METHOD> <PATH> [JSON]
```

- GET以外は`X-Requested-With`と`Idempotency-Key`を自動で付け、JSONに`idempotencyKey`が無ければ補う。
- 3xxはAccessで弾かれた状態（Service TokenかService Auth policyの問題）。401はWorker側のClient ID不一致。

## 手順

1. **IDを引く**: 名前で指定されたステータス・Project・Label・Cycleは、先にbootstrapでIDへ変換する。推測でIDを作らない。

   ```bash
   node scripts/orbit-api.mjs GET /api/v1/bootstrap \
     | jq '{states: [.workflowStates[] | {id, name, category}], projects: [.projects[] | {id, name}], labels: [.labels[] | {id, name}], cycles: [.cycles[] | {id, number, status}]}'
   ```

2. **追加**: `title`だけで作れる。`priority`は`no_priority|low|medium|high|urgent`、`dueAt`は期限日のUTC 0時のUnixミリ秒。

   ```bash
   node scripts/orbit-api.mjs POST /api/v1/issues '{"title":"牛乳を買う","priority":"medium"}'
   ```

   説明文は`descriptionJson`（`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"..."}]}]}`）。

3. **探す**: `GET /api/v1/search?q=<URLエンコードした語>`、詳細は`GET /api/v1/issues/<id>`。結果の`id`・`identifier`・`version`を控える。

4. **更新・完了**: 直前に取った`version`を付け、`patch`に変える項目だけを入れる。完了は`category`が`completed`のステータスID。

   ```bash
   node scripts/orbit-api.mjs PATCH /api/v1/issues/<id> '{"version":3,"patch":{"statusId":"<completedのID>"}}'
   ```

   `409`なら取り直して1回だけ再送する。

5. **メモ**: `POST /api/v1/issues/<id>/notes` に `{"body":"..."}`。

6. **報告**: 操作したIssueの`identifier`とタイトル、変更内容を1〜3行で返す。

## 守ること

- 本番データなので、削除・ゴミ箱（`?action=trash`）・一括操作（`/issues/bulk`）・Cycle/Projectの完了やアーカイブは、対象を列挙してユーザーの確認を取ってから実行する。追加・単一の更新・完了・メモは依頼があればそのまま行う。
- 対象が複数候補にマッチしたら、候補を番号付きで示して選んでもらう。
- テストのためのダミーIssueを作らない。
- Client Secretを表示・保存・コミットしない。
