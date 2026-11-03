# FEAT-external-api-token: 外部bot向けService Token認証

## 概要

Grok Bot等の外部botが、既存の`/api/v1`を人間と同じOwner権限で呼び出せるようにする。Cloudflare AccessのService Tokenで認証されたリクエストのうち、Worker設定に登録したClient IDのものだけをOwner本人として扱う。

## 対象範囲

- 対象レイヤー: service（詳細は [service.md](./service.md)）
- 対象ドメイン: `auth`
- 対象外（やらないこと）:
  - 新しいAPI endpointの追加（既存の約35本をそのまま使う）
  - botに許すAPIの制限（Ownerの判断で全APIを許可。2026-11-03 Gate 1）
  - Activity上で「botが操作した」ことを区別する記録（必要になったら別チケット）
  - 複数Service Tokenの同時登録（単一Client IDのみ。差し替えはSecret更新で行う）
  - Cloudflare Access側の設定変更（手順を文書化し、Ownerがダッシュボードで行う）

## ユニット計画

単一ユニット。

## 受け入れ基準（AC）

- [ ] **AC-1**: production で、検証済みJWTの`common_name`が`ACCESS_SERVICE_TOKEN_CLIENT_ID`と一致し、かつ`sub`が空文字のとき、`resolveOwner`は`{ userId: OWNER_USER_ID, email: OWNER_EMAIL, accessAuthenticated: true }`を返す。Owner行の照合（`findOwnedUser(OWNER_USER_ID, OWNER_EMAIL)`）は人間ログインと同じく行う。
- [ ] **AC-2**: `common_name`を持つJWTで、`ACCESS_SERVICE_TOKEN_CLIENT_ID`が未設定・空文字・不一致、または`sub`が空文字でないときは`401 AUTH_REQUIRED`を返し、DBを照会しない。
- [ ] **AC-3**: Service Token経由でもOwner行がDBに無いときは`401 AUTH_REQUIRED`、DB照会が失敗したときは`500 INTERNAL_ERROR`を返す（人間ログインと同じ）。
- [ ] **AC-4**: `common_name`を持たないJWTは従来どおり`email`と`OWNER_EMAIL`の一致で判定する（既存テストが変更なしでgreen）。
- [ ] **AC-5**: Service Tokenで認証された`POST /api/v1/issues`は、`X-Requested-With: XMLHttpRequest`付きなら`201`でIssueを作成して永続化し、ヘッダーが無ければ従来どおり`400 VALIDATION_ERROR`を返す。
- [ ] **AC-6**: `docs/external-api.md`に、Cloudflare AccessのService Token発行・`Service Auth` policy設定・Secret登録の手順と、curlでのID取得→Issue作成→更新→完了の例を記載する。`docs/deployment.md`のSecret一覧に`ACCESS_SERVICE_TOKEN_CLIENT_ID`（任意）を追記する。

## アーキテクチャ / レイヤー間フロー

```
bot ──CF-Access-Client-Id/Secret──▶ Cloudflare Access（Service Auth policyで検証）
                                        │ Cf-Access-Jwt-Assertion（common_name=Client ID, sub=""）
                                        ▼
                                  Worker withOwner → resolveOwner
                                        │ jwtVerify（issuer/audience、既存）
                                        │ common_name あり → 登録Client IDと照合 → OWNER_EMAILで本人扱い
                                        │ common_name なし → 既存のemail照合
                                        ▼
                                  findOwnedUser → 既存APIハンドラ
```

## エラー・ログ方針（横断サマリ）

| シナリオ | service | 表示層の挙動 |
|---|---|---|
| 登録外のService Token / Client ID未設定 | 401 AUTH_REQUIRED「認証情報を確認できません。」 | —（botのみ） |
| Owner行なし | 401 AUTH_REQUIRED「所有者を確認できません。」 | — |
| DB照会失敗 | 500 INTERNAL_ERROR | — |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|----|------|--------------|
| AC-1 | — | `auth-owner-boundary.test.ts`（jose mock + D1 stub） |
| AC-2 | — | 同上（デシジョンテーブル） |
| AC-3 | — | 同上 |
| AC-4 | — | 既存`auth-owner-boundary.test.ts` / `auth.test.ts` |
| AC-5 | — | `withOwner`経由で`createIssue`を呼ぶ結合テスト |
| AC-6 | — | —（文書） |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `resolveOwner`のJWT検証（`jwtVerify`・JWKS cache・issuer/audience）、`findOwnedUser`、`withOwner`のCSRFガード（`X-Requested-With`）、既存`/api/v1`全体。
- 差分: `resolveOwner`の`email`抽出部に`common_name`分岐を追加し、環境変数`ACCESS_SERVICE_TOKEN_CLIENT_ID`を読む。
- 衝突: なし。local / development モードの分岐は変更しない。

## 実装に効く制約

- Service Tokenの秘密値（Client Secret）はWorkerに渡さない・保存しない。検証はCloudflare Accessが行い、WorkerはAccess署名済みJWTの`common_name`だけを見る。
- Client IDは秘密値ではないがSecretとして登録し、リポジトリへ書かない。
- production以外のモードの挙動は変えない。

## 判断根拠 / 未決事項

- **Access Service Tokenを採用**: 既存のAccess JWT検証をそのまま使え、鍵の検証・失効をCloudflare側に任せられる。却下案: 独自Bearer Token（Access Bypassの穴を作る必要があり、Worker側で秘密値の比較・保管が必要になる）、MCPサーバー（Grok Botはcurlで足りるので過剰）。
- **`common_name`と`sub === ""`の両方で判定**: Cloudflare公式の「Application token」ページで、Service Token認証時は`common_name`がClient ID、`sub`が空文字と明記されている（2026-11-03確認）。人間ログインのJWTと取り違えないよう両方を条件にする。
- **単一Client ID**: botは1つ。差し替えはSecret更新＋再デプロイで足りる（YAGNI）。
- **全APIを許可**: 2026-11-03 Gate 1でOwnerが選択（A1）。
- 未決事項: なし。
