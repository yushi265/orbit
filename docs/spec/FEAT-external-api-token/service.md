# FEAT-external-api-token: service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: production で、検証済みJWTの`common_name`が`ACCESS_SERVICE_TOKEN_CLIENT_ID`と一致し、かつ`sub`が空文字のとき、`resolveOwner`は`{ userId: OWNER_USER_ID, email: OWNER_EMAIL, accessAuthenticated: true }`を返す。Owner行の照合（`findOwnedUser(OWNER_USER_ID, OWNER_EMAIL)`）は人間ログインと同じく行う。
- **AC-2**: `common_name`を持つJWTで、`ACCESS_SERVICE_TOKEN_CLIENT_ID`が未設定・空文字・不一致、または`sub`が空文字でないときは`401 AUTH_REQUIRED`を返し、DBを照会しない。
- **AC-3**: Service Token経由でもOwner行がDBに無いときは`401 AUTH_REQUIRED`、DB照会が失敗したときは`500 INTERNAL_ERROR`を返す（人間ログインと同じ）。
- **AC-4**: `common_name`を持たないJWTは従来どおり`email`と`OWNER_EMAIL`の一致で判定する（既存テストが変更なしでgreen）。
- **AC-5**: Service Tokenで認証された`POST /api/v1/issues`は、`X-Requested-With: XMLHttpRequest`付きなら`201`でIssueを作成して永続化し、ヘッダーが無ければ従来どおり`400 VALIDATION_ERROR`を返す。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|------|------------|-----------------|-------------------|------|
| 追加 | 環境変数 `ACCESS_SERVICE_TOKEN_CLIENT_ID` | 任意の文字列（Cloudflare Service TokenのClient ID。例: `xxxx.access`）。未設定・空文字ならService Token認証は無効 | production のみ参照 | bot用Client IDの登録 |
| 変更 | `resolveOwner(request, env)` | 戻り値型 `OwnerContext` は不変 | 下記判定表 | 全`/api/v1` |

判定表（production・`jwtVerify`成功後）:

| # | `common_name` | `sub` | 登録Client ID | `email` | 結果 |
|---|---|---|---|---|---|
| 1 | 文字列・登録値と一致 | `""` | 設定あり | （問わない） | Owner照合へ（email=`OWNER_EMAIL`） |
| 2 | 文字列・不一致 | `""` | 設定あり | — | 401 |
| 3 | 文字列 | `""` | 未設定 / 空 | — | 401 |
| 4 | 文字列・一致 | `""`以外 | 設定あり | — | 401 |
| 5 | なし | — | （問わない） | `OWNER_EMAIL`と一致 | Owner照合へ（既存） |
| 6 | なし | — | — | 不一致 / なし | 401（既存） |

## このレイヤーが依存する下位の契約（呼び出す相手）

- `jose.jwtVerify`（既存）、`findOwnedUser(db, userId, email)`（変更なし）

## 実装配置

- `src/server/auth.ts`: `jwtVerify`後の`email`判定を、`common_name`の有無で分岐する。
- `src/server/auth-owner-boundary.test.ts`: 判定表 #1〜#4 と AC-3 のケースを追加。
- `src/server/api-*.test.ts` または新規 `auth-service-token.test.ts`: AC-5（`withOwner`経由の`createIssue`）。
- `docs/external-api.md`（新規）、`docs/deployment.md`（Secret一覧追記）。

## 異常系挙動

- #2〜#4: `ServiceError(401, "AUTH_REQUIRED", "認証情報を確認できません。")`（既存のemail不一致と同文言。どの条件で落ちたかは返さない）。
- AC-3: 既存の`"所有者を確認できません。"` / `"認証基盤を確認できません。"`。

## テストケース

- [デシジョンテーブル] #1 登録Client ID一致・sub空 → OwnerContext、`findOwnedUser`に`OWNER_USER_ID`/`OWNER_EMAIL`が渡る
- [デシジョンテーブル] #2 Client ID不一致 → 401、DB未照会
- [デシジョンテーブル] #3 `ACCESS_SERVICE_TOKEN_CLIENT_ID`未設定 → 401 / 空文字 → 401
- [デシジョンテーブル] #4 Client ID一致・sub非空 → 401
- [代表値] AC-3 Owner行なし → 401 / DB照会例外 → 500
- [代表値] AC-4 既存のemailケース（既存テスト）
- [代表値] AC-5 Service Token + X-Requested-With → 201 / ヘッダーなし → 400
