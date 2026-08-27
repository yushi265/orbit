# PHASE1: Foundation

> Phase 1（Foundation）の残タスクを、既存 `MVP-linear-project-management` spec の契約に沿って実装するための補足 spec。

## 概要

本番 Owner の初期化を再現可能なコマンドへ収束し、個人設定と Workflow 状態を Settings から変更できるようにする。
既存の Cloudflare Access、Owner scope、Background Run の lock / 状態表示を、実装とテストで Foundation の完了条件へ収束させる。

## 対象範囲

- 対象レイヤー: [data.md](./data.md) / [shared.md](./shared.md) / [service.md](./service.md) / [ui.md](./ui.md)
- 対象ドメイン: auth / owner bootstrap / preferences / workflow / background
- 対象外: Access 側の認証画面・Policy作成、正規化Repositoryへの全面移行、Cycle処理そのもの、Project status CRUD、翻訳辞書の全面導入、外部Scheduler・Queue・Realtime

## ユニット計画

| # | ユニット | 含む AC | 依存 | 状態 |
|---|---|---|---|---|
| 1 | Owner bootstrap / 認証境界 | AC-1, AC-2 | — | 進行中 |
| 2 | 個人設定 / Workflow設定 | AC-3, AC-4 | Unit 1 | 進行中 |
| 3 | Background lock / 状態表示 / Foundation検証 | AC-5, AC-6 | Unit 1, 2 | 進行中 |

## 受け入れ基準（AC）

- [ ] **AC-1**: 本番 Owner bootstrap コマンドは、必須設定の欠落・不正をリモート実行前に拒否し、`users`、`user_preferences`、`user_runtime_locks`をOwner単位で冪等に初期化する。既存のOwner行・メールアドレス・設定値を上書きしない。
- [ ] **AC-2**: 本番の認証境界は、Access JWT・issuer・audience・email・`OWNER_USER_ID`に対応する`users`行をすべて検証し、未認証・設定不足・D1 binding不足・Owner不一致ではMemory Storeへフォールバックせず、定義済みの401または500 ErrorEnvelopeを返す。
- [ ] **AC-3**: 本人のPreferencesは`timezone`、`locale`、`theme`、`colorTheme`、`estimateEnabled`を既存の`PATCH /api/v1/preferences`で更新でき、許可値・IANA timezone・Owner境界・idempotencyを検証し、成功値が再取得後も保持される。Settingsでは各項目の初期・保存中・成功・失敗状態を操作可能に表示する。
- [ ] **AC-4**: 本人はWorkflow stateを一覧・追加・名称/色/順序/既定値変更・削除できる。カテゴリは`backlog / unstarted / started / completed / canceled`に限定し、Owner外の参照を拒否し、既定stateは常に1件、Issueが参照中または既定stateの削除は拒否し、同じidempotencyKeyの再送はNo-opになる。
- [ ] **AC-5**: Background Runが`pending`または`running`の間、Preferences / Workflowを含む業務Mutationは423 `OPERATION_IN_PROGRESS`で拒否され、Issue・Activity・Outbox・Receipt・設定値を変更しない。`GET /api/v1/background-runs/current`とBootstrapは本人のRun状態だけを返し、`lock_token`と`admission_token`を公開しない。
- [ ] **AC-6**: FoundationのSettings / Background UIはDesktop・Tablet・390px幅のMobileで横overflowを発生させず、初期・ローディング・空・保存中・エラー・成功・再開可能状態を示し、主要操作をKeyboard / Pointerで実行できる。401は既存のTransport分類を経由して現在のDeep linkへのTop-level再認証へ進む。

## アーキテクチャ / レイヤー間フロー

```text
bootstrap-owner script ──D1 SQL──> users / preferences / runtime lock
Browser ──Access JWT──> service ──owner lookup──> D1
Browser ──PATCH preferences / workflow API──> service ──Owner + lock + receipt──> Store session
Browser ──GET bootstrap/current──> service ──public run summary──> Settings / RunOverlay
```

本番の業務状態は既存のOwner単位D1 Snapshot Sessionへ保存し、bootstrapコマンドは認証に必要な正規化Owner行だけを初期化する。Workflow APIは既存TanStack StartのServer Route形式を使い、BrowserへD1 bindingや内部Tokenを渡さない。

## エラー・ログ方針（横断サマリ）

| シナリオ | data | service / shared | 表示層の挙動 |
|---|---|---|---|
| bootstrap設定不足・不正 | リモートD1を変更しない | CLIは非0終了。設定値・メール本文をログへ出さない | デプロイ手順の確認を促す |
| 未認証・Owner不一致 | 業務Queryを実行しない | 401 `AUTH_REQUIRED`、D1 binding不足は500 `INTERNAL_ERROR` | 401のみDeep linkを保持して再認証 |
| 入力不正 | 業務状態を変更しない | 400 `VALIDATION_ERROR` + fieldErrors | 入力欄へエラーを表示し再試行可能 |
| Owner外 / 不存在 / 参照中削除 | 業務状態を変更しない | 404 `RESOURCE_NOT_FOUND`または400 `VALIDATION_ERROR` | 対象の存在を推測させない安全なエラー |
| Background lock | version / Activity / Outbox / Receipt / 設定値を変更しない | 423 `OPERATION_IN_PROGRESS` + requestId | 処理中表示を維持し、読み取りと再認証は許可 |
| 同じKeyの再送 | 一度だけ副作用を確定 | 初回と同じ結果を返す。内容違いは409 `IDEMPOTENCY_KEY_REUSED` | 入力を保持して再試行可能 |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | bootstrap SQLのliteral生成・環境値検証 | Wrangler実行引数のdry-run検証、既存行を保持するD1相当テスト |
| AC-2 | Transport分類・公開Owner結果 | Access設定不足 / D1不足 / Owner不一致のHTTP境界 |
| AC-3 | Preferences schema・timezone判定 | Store/APIの保存・再取得・lock・再送、Settings状態 |
| AC-4 | Workflow position / default遷移 | API CRUD、Owner境界、参照中/既定削除、lock・再送 |
| AC-5 | Public Run summaryのToken除外 | 全Foundation Mutationの423と副作用0、Bootstrap/currentのOwner境界 |
| AC-6 | UI状態・レスポンシブ契約 | Settings / RunOverlayの主要操作と401導線 |

## 既存実装との関係（再利用 / 差分 / 衝突）

- `src/server/auth.ts`、`src/server/http.ts`、`src/server/store-session.ts`、`src/server/store.ts`のOwner / Session / ErrorEnvelope / lock実装を再利用する。
- `PATCH /api/v1/preferences`は既存Pathを維持し、入力SchemaとUIを補強する。既存のTheme / ColorTheme更新との互換性を保つ。
- Workflow stateは既存の`OrbitStore.workflowStates`、Bootstrapの`workflowStates`、`src/db/schema.ts`の`workflow_states`を再利用し、追加APIだけを公開する。
- 既存のページモーション差分（`src/styles.css`）と`src/components/motion.test.ts`は本ボルトの対象外として保持する。デプロイ設定（`docs/deployment.md`、`wrangler.jsonc`）はGate 3の承認により本コミットへ含める。

## 実装に効く制約

- Access JWT、Cookie、D1 binding、`lock_token`、`admission_token`、認証設定値はBrowser response・通常ログ・Snapshotの公開progressへ出さない（既存Bootstrapの認証済みプロフィール`me.email`は公開契約に従う）。
- すべての業務Mutationは解決済みOwnerとRuntime lockを経由し、idempotencyKeyを受け取る。
- Workflowの既定値変更は旧既定値を先に解除し、既定値0件・2件を公開状態にしない。
- Workflow positionはサーバー側で0始まりの連続値へ正規化する。クライアントの順序をそのまま信頼しない。
- productionでD1が使えない場合に開発Owner / Memory Storeへフォールバックしない。

## 判断根拠 / 未決事項

- Owner bootstrapはHTTPリクエストから自動作成せず、明示的なWranglerコマンドに分離する。認証境界のfail-closedを維持し、誤ったOwner emailで本番データを初期化する事故を避けるためである。
- Workflow APIは既存Preferences APIへ混在させず、`/api/v1/workflow-states`へ分離する。参照先・default・positionの整合性を一つのサービス境界で検証し、Settings UIからも同じ契約を使う。
- PreferencesのtimezoneはIANA timezoneとしてWorkerの`Intl.DateTimeFormat`で検証し、固定リストをサーバーへ埋め込まない。UIはブラウザが利用可能な候補と`UTC`を提示し、未知候補は入力エラーにする。
- Gate 1でPhase 1 Foundationの実装開始を承認済み。Gate 2は本specの要点提示後に承認を受ける（委任なし）。
