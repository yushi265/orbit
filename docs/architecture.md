# アーキテクチャ概要

これは `orbit` の要件定義に基づく**実装予定のアーキテクチャ**である。現在はアプリ本体が未実装のため、
実装中に変更した場合はこの文書と要件定義の該当文書（入口: [`requirements/index.md`](./requirements/index.md)）を同じ変更で更新する。

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
data（D1 + Drizzle）  Queues          Cron Triggers
                         │               │
                         └── 通知等 ─────┘
```

| レイヤー | 配置予定 | 責務 |
|---|---|---|
| ui（表示層） | `src/routes/` / `src/components/` | 画面描画、入力受付、URL状態、TanStack Query。認証・DB Bindingへ直接アクセスしない |
| service（サービス層） | `src/server/` / `src/api/` | Server Functions、API Routes、認証・認可、Issue/Cycle/Projectのドメイン処理 |
| data（データ層） | `src/db/` / `drizzle/` | Drizzleスキーマ、Migration、Repository。D1 BindingをBrowserへ露出しない |
| shared（共有契約） | `src/shared/` | UIとserviceの間で共有するZod入出力スキーマ・エラーEnvelope・公開型。特定層へ依存しない |

通知生成・重い集計・将来のWebhook処理は Queues へ分離し、Cycleの境界処理は Cron Triggers から冪等なservice処理を呼び出す。

## 依存方向

```
ui  →  shared ← service → data
                   ├── Queues
                   └── Cron Triggers
```

- `ui` は HTTPまたはServer Functionの公開契約経由で `service` を利用し、D1へ直接アクセスしない。
- `service` は `data` のRepositoryを利用し、表示層のコンポーネントやブラウザAPIへ依存しない。
- `shared` は `ui` / `service` の双方から利用されるが、どちらにも依存しない。
- 認証済みユーザーのスコープ、入力検証、versionによる楽観的ロックは `service` 境界で担保する。

## ドメイン境界（初期予定）

MVPでは単一 Worker 内のモジュールとして次を分ける。独立したサービスや別デプロイにはしない。

- `issues`: Issue、Sub-issue、Label、Relation、Activity
- `cycles`: Cycle設定、状態遷移、繰越、進捗
- `projects`: Project、ステータス、進捗
- `views`: Filter、Group、Order、Saved View
- `notifications`: Inboxと通知設定
- `auth`: Cloudflare Access JWT検証と本人スコープ

モジュール間の参照は公開関数・型を経由し、他モジュールのRepositoryやDBテーブルへ直接依存しない。

## 未確定事項

- TanStack Startの具体的なRoute配置とServer Functionの切り分け
- D1 Repositoryのファイル構成とMigration運用
- Cloudflare Access JWT検証ライブラリ・鍵取得の実装方法
- MVPでのQueues導入範囲とローカルテスト方法

これらは実装開始時のTier 1設計判断として、該当specと人間ゲートで確定する。
