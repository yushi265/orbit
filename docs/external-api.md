# 外部botからのAPI利用

Grok Bot等の外部botが、Cloudflare AccessのService Tokenで`/api/v1`を呼び出すための手順です。botはOwner本人と同じ権限で、画面と同じAPI（Issue・Note・Relation・一括操作・Project・Cycle・Label・View・検索・通知）を使えます。仕様は[`spec/FEAT-external-api-token/`](./spec/FEAT-external-api-token/index.md)を参照してください。

## 仕組み

1. botは`CF-Access-Client-Id`と`CF-Access-Client-Secret`をヘッダーに付けて送ります。
2. Cloudflare AccessがService Tokenを検証し、Workerへ`Cf-Access-Jwt-Assertion`（`common_name`=Client ID、`sub`=空文字）を渡します。
3. Workerは既存のJWT検証のあと、`common_name`がSecret `ACCESS_SERVICE_TOKEN_CLIENT_ID`と一致する場合だけOwner本人として扱います。

Client SecretはWorkerへ登録しません。検証はCloudflare Accessが行います。

## 初期設定（Owner作業）

1. Cloudflare Zero Trustの **Access controls > Service credentials > Service tokens** でService Tokenを作成し、Client IDとClient Secretを控えます。Client Secretは作成時にしか表示されません。
2. orbitのAccess applicationに、Action=**Service Auth**、Include=作成したService Tokenのpolicyを追加します。Allow policyではAccessがログイン画面へ誘導するため、botは通りません。既存のOwner向けAllow policyは残します。
3. Client IDをWorkerのSecretへ登録し、再デプロイします。

```bash
pnpm exec wrangler secret put ACCESS_SERVICE_TOKEN_CLIENT_ID --env production
```

4. botへ`ORBIT_URL`・Client ID・Client Secretを渡します。Client Secretはbotの秘密情報として保管し、プロンプトやログに出さないでください。

無効化するときは、Cloudflare側でService Tokenを失効させるか、Secretを削除して再デプロイします。Secretが未設定・空文字の間、Service Token経由のリクエストはすべて`401 AUTH_REQUIRED`になります。

## リクエストの共通ルール

- ヘッダー: `CF-Access-Client-Id`、`CF-Access-Client-Secret`、JSON Bodyでは`content-type: application/json`。
- 更新系（GET以外）は`X-Requested-With: XMLHttpRequest`が必須です。無いと`400 VALIDATION_ERROR`になります。
- 作成・更新のBodyには`idempotencyKey`（再送時に二重登録を防ぐ任意の一意文字列。UUID推奨）が必須です。archive・restore・trash・削除系は`Idempotency-Key`ヘッダーで渡します。
- Issue更新は楽観的ロックです。直前に取得した`version`を送り、競合したら取得し直して再送します。
- エラーは`{ "error": { "code", "message", "fieldErrors?", "requestId" } }`形式です。

```bash
export ORBIT_URL="https://<orbitのホスト>"
H=(-H "CF-Access-Client-Id: $CF_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_CLIENT_SECRET")
W=(-H "X-Requested-With: XMLHttpRequest" -H "content-type: application/json")
```

## よく使う操作

### ID一覧を取る（ステータス・Project・Label・Cycle）

```bash
curl -sS "${H[@]}" "$ORBIT_URL/api/v1/bootstrap" \
  | jq '{workflowStates: [.workflowStates[] | {id, name, category}],
         projects: [.projects[] | {id, name}],
         labels: [.labels[] | {id, name}],
         cycles: [.cycles[] | {id, number, status}]}'
```

完了ステータスは`category`が`completed`のものです。

### タスクを追加する

`title`以外は任意です。`priority`は`no_priority` / `low` / `medium` / `high` / `urgent`、`dueAt`は期限日のUTC 0時のUnixミリ秒です。

```bash
curl -sS "${H[@]}" "${W[@]}" -X POST "$ORBIT_URL/api/v1/issues" -d '{
  "idempotencyKey": "'"$(uuidgen)"'",
  "title": "牛乳を買う",
  "priority": "medium",
  "descriptionJson": {"type": "doc", "content": [
    {"type": "paragraph", "content": [{"type": "text", "text": "低脂肪のやつ"}]}
  ]}
}'
```

レスポンス`{ "issue": { "id", "identifier", "version", ... } }`の`id`と`version`を後続の操作で使います。

### タスクを探す

```bash
curl -sS "${H[@]}" -G --data-urlencode "q=牛乳" "$ORBIT_URL/api/v1/search" | jq '.items[] | {id, identifier, title, version}'
curl -sS "${H[@]}" "$ORBIT_URL/api/v1/issues/<issueId>"   # 詳細（Note・Relation・Activity含む）
```

### タスクを更新する・完了にする

`patch`に変えたい項目だけを入れます。完了は`statusId`に完了ステータスのIDを指定します。

```bash
curl -sS "${H[@]}" "${W[@]}" -X PATCH "$ORBIT_URL/api/v1/issues/<issueId>" -d '{
  "idempotencyKey": "'"$(uuidgen)"'",
  "version": 3,
  "patch": {"statusId": "<completedのworkflowState id>"}
}'
```

`409`が返ったら`GET /api/v1/issues/<issueId>`で最新の`version`を取り直します。

### メモを残す

```bash
curl -sS "${H[@]}" "${W[@]}" -X POST "$ORBIT_URL/api/v1/issues/<issueId>/notes" \
  -d '{"idempotencyKey": "'"$(uuidgen)"'", "body": "店が閉まってたので明日"}'
```

### アーカイブ・ゴミ箱

```bash
curl -sS "${H[@]}" -H "X-Requested-With: XMLHttpRequest" -H "Idempotency-Key: $(uuidgen)" \
  -X POST "$ORBIT_URL/api/v1/issues/<issueId>?action=archive"   # restore / trash も同じ
```

## その他のAPI

| 対象                          | パス                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| Issue一覧・一括操作・並べ替え | `GET /api/v1/issues`、`POST /api/v1/issues/bulk`、`POST /api/v1/issues/reorder`           |
| Relation                      | `POST /api/v1/issues/<id>/relations`、`DELETE /api/v1/issues/<id>/relations/<relationId>` |
| Project                       | `GET/POST /api/v1/projects`、`PATCH/POST /api/v1/projects/<id>`                           |
| Cycle                         | `GET /api/v1/cycles`、`PATCH/POST /api/v1/cycles/<id>`                                    |
| Label                         | `GET/POST /api/v1/labels`、`PATCH/DELETE /api/v1/labels/<id>`                             |
| 保存View                      | `GET/POST /api/v1/views`、`PATCH/DELETE /api/v1/views/<id>`                               |
| 通知                          | `GET /api/v1/notifications`                                                               |

入出力の正本は`src/shared/contracts/`のZodスキーマ、ハンドラーは`src/routes/api/v1/`です。
