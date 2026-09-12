# アーキテクチャ概要

これは `orbit` の要件定義に基づくMVPアーキテクチャである。主要な実装は `src/` に配置し、Previewで実D1へ接続する際に変更した場合はこの文書と要件定義の該当文書（入口: [`requirements/index.md`](./requirements/index.md)）を同じ変更で更新する。

## 全体像

```
利用者（PC / タブレット / スマートフォンのブラウザ）
        │ HTTPS / TanStack Start Server Functions / API Routes
        ▼
ui（TanStack Start + React）
        │ 共有契約（Zod）・サーバー状態（TanStack Query）
        ▼
service（Cloudflare Worker）
        │ 認証・認可・ドメイン処理・トランザクション
        ├───────────────┬───────────────┐
        ▼               ▼               ▼
data（D1 + Drizzle）  Manual Run      D1 Chunk Runner
                         │               │
                         └── Background run lock / progress ──┘
```

| レイヤー | 配置予定 | 責務 |
|---|---|---|
| ui（表示層） | `src/routes/` / `src/components/` | 画面描画、入力受付、URL状態、TanStack Query。認証・DB Bindingへ直接アクセスしない |
| service（サービス層） | `src/server/` / `src/api/` | Server Functions、API Routes、認証・認可、Issue/Cycle/Projectのドメイン処理 |
| data（データ層） | `src/db/` / `drizzle/` | Drizzleスキーマ、Migration、Repository。D1 BindingをBrowserへ露出しない |
| shared（共有契約） | `src/shared/` | UIとserviceの間で共有するZod入出力スキーマ・エラーEnvelope・公開型。特定層へ依存しない |

MVPではSettingsのManual Runから冪等なservice処理を呼び出し、実行中はD1のBackground run lockで業務Mutationを停止する。通知生成・重い集計は同じWorkerのD1 Chunk処理で行い、Webhookや外部連携は今回対象外とする。

## 依存方向

```
ui  →  shared ← service → data
                   └── Manual Chunk Runner
```

- `ui` は HTTPまたはServer Functionの公開契約経由で `service` を利用し、D1へ直接アクセスしない。
- `service` は `data` のRepositoryを利用し、表示層のコンポーネントやブラウザAPIへ依存しない。
- `shared` は `ui` / `service` の双方から利用されるが、どちらにも依存しない。
- 認証済みユーザーのスコープ、入力検証、versionによる楽観的ロックは `service` 境界で担保する。

## 永続化モード

- `pnpm dev`による画面開発は既存の`OrbitStore`（Memory Store）を使い、主要な画面Journeyを高速に検証する。再起動で内容は失われる。
- `pnpm local:start`によるローカル専用運用は`APP_ENV=local` / `ORBIT_STORAGE=d1`で、固定Owner `local-owner`とローカルD1 Snapshotを使う。AccessやJWKS取得は行わない。DB / Owner欠落・破損時はMemory Storeへフォールバックしない。
- productionは`withOwner`のRequest SessionがD1 Snapshotをロードし、成功したRequestだけをOwner単位のVersion CASで保存する。D1 Bindingが無い場合にMemory Storeへフォールバックしない。
- `src/db/`の正規化Schema / Repositoryは段階移行の正本として残し、Snapshot表は現行`OrbitStore`の全モデルを欠落なく永続化するためのMVP bridgeとする。
- Project詳細のIssue表示設定は、MVPではOwner scopedなSnapshot配列として保存し、Bootstrapで端末間へ同期する。正規化Repositoryへの移行時期は別途判断する。

## ローカル専用運用の境界

ローカル専用設定`wrangler.local.jsonc`はクラウドDB ID・remote Bindingを含まない。Vite PluginとWranglerは、リポジトリ基準の`.orbit/local`または`ORBIT_LOCAL_DATA_DIR`で指定した絶対パスを共用する。データ層の既存Migration・Snapshot・Owner単位のVersion CASを再利用する。

通常HTTPは`127.0.0.1:3000`だけで待ち受ける。明示的な`local:start -- --lan`では0.0.0.0:3000で待ち受け、起動時のRFC1918 IPv4とloopbackを許可OriginとしてWorkerへ渡す。APIのURLが許可Origin内にありHostと一致すること、MutationのOriginがそのRequest URLのOriginと一致することを検証する。固定OwnerはHTTPヘッダーで切り替えない。productionは引き続きAccess JWTとDB Owner照合を必須とし、local認証へフォールバックしない。

表示層は同一Originの相対APIとシステムフォントを使用する。Manual Runは既存HTTP Chunk Runnerを使い、サーバー停止中は進まない。保存先全体のバックアップ・空の別保存先への復元はサーバー停止中に行う。操作手順・初期対応範囲は[ローカル利用手順](./local-development.md)を参照する。

## ドメイン境界（初期予定）

MVPでは単一 Worker 内のモジュールとして次を分ける。独立したサービスや別デプロイにはしない。

- `issues`: Issue、Sub-issue、Label、Relation、Activity
- `cycles`: Cycle設定、状態遷移、繰越、進捗
- `projects`: Project、ステータス、進捗、Project詳細のIssue表示設定
- `views`: Filter、Group、Order、Saved View
- `notifications`: Inboxと通知設定
- `auth`: Cloudflare Access JWT検証と本人スコープ
- `background`: Manual Run、実行ロック、進捗、cursor、Lease復旧

モジュール間の参照は公開関数・型を経由し、他モジュールのRepositoryやDBテーブルへ直接依存しない。

## 未確定事項

- TanStack Startの具体的なRoute配置とServer Functionの切り分け
- D1 Snapshotからドメイン単位の正規化Repositoryへ移行する時期・単位とMigration運用
- Cloudflare Access JWT検証ライブラリ・鍵取得の実装方法
- D1 Chunk Runnerのローカルテスト方法とLease復旧手順

これらは実装開始時のTier 1設計判断として、該当specと人間ゲートで確定する。
