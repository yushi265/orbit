# REL: D1永続化Adapter

## 概要

本番環境の業務データをWorkerメモリではなくCloudflare D1へ保存する。既存のHTTP API契約と`OrbitStore`のドメインロジックを維持し、所有者単位の状態スナップショットをD1へ保存するAdapterを追加する。

## 対象範囲

- 対象レイヤー: [data.md](./data.md) / [service.md](./service.md) / [shared.md](./shared.md)
- 本番（`APP_ENV=production`）のリクエスト前ロード・成功後保存
- ローカル開発のMemory Store動作の維持
- D1 Migrationによるスナップショット表の追加
- D1競合を表現する共有ErrorCodeの追加
- スナップショットの完全なround-trip（Map / Array / Run / Lock / Receiptを含む）
- 所有者単位の楽観的バージョン競合検知
- 既存APIのエラーEnvelope・HTTP契約の維持

## 対象外

- 既存の全ドメイン処理を一度に正規化Repositoryへ移植すること
- 新しいUI・API Routeの追加（D1競合を表現する共有ErrorCodeは対象に含む）
- 複数Owner・チーム共有・外部連携
- D1スナップショットから既存正規化表への自動Backfill

## 受け入れ基準（AC）

- [ ] **AC-1**: 本番のMutation成功後に別リクエストを行うと、Issue・Project・Label・Cycle・View・Notification・Preferenceの変更がD1から復元される。
- [ ] **AC-2**: ローカル（`APP_ENV!=production`）では既存のMemory Storeを使い、既存の開発Fixtureとテスト動作を維持する。
- [ ] **AC-3**: 同じOwnerの同時リクエストが同じD1スナップショットVersionを読んだ場合、先に保存した1件だけが成功し、後続は409 `D1_WRITE_CONFLICT`になり、後続の状態で先行更新を上書きしない。
- [ ] **AC-4**: Handlerが4xx / 5xxを返す、または例外を投げた場合、変更後のスナップショットをD1へ保存しない。
- [ ] **AC-5**: スナップショットの保存・復元で、公開Bootstrapに必要な全Map / ArrayとBackground Runの内部状態が欠落しない。
- [ ] **AC-6**: Migration適用後、所有者ごとに1行だけスナップショットを保持でき、別Ownerの状態を読み書きできない。

## レイヤー間契約

| レイヤー | 契約 |
|---|---|
| data | `orbit_store_snapshots(user_id PRIMARY KEY, version, state_json, updated_at)`。`version`は0以上、`state_json`は検証済みJSON、`updated_at`はUTC Unix milliseconds。 |
| service | `withOwner`がOwner認証後にStore Sessionを開き、成功Responseの後だけ`persist()`する。D1 Version競合は409 `D1_WRITE_CONFLICT`。 |
| shared | `D1_WRITE_CONFLICT`を409へ対応付け、ErrorEnvelopeの既存形状は変更しない。 |
| ui | API path、Request / Response JSON、画面契約は変更しない。 |

## エラー・ログ方針

| シナリオ | 挙動 |
|---|---|
| D1 Snapshot JSON破損 | 500 `INTERNAL_ERROR`、state_jsonや個人データをログ出力しない |
| Version競合 | 409 `D1_WRITE_CONFLICT`、後続の状態は保存しない |
| D1 Binding未設定 | 500 `INTERNAL_ERROR`、本番でMemory Storeへフォールバックしない |
| Handler 4xx / 5xx | Snapshot保存を行わない |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | Snapshot mapper | D1 sessionの保存→再ロード |
| AC-2 | Environment分岐 | 既存APIテスト / Memory Store |
| AC-3 | Version判定 | Fake D1の競合保存 |
| AC-4 | persist条件 | Handler失敗時の保存回避 |
| AC-5 | 全フィールドround-trip | Snapshot repository |
| AC-6 | Owner key / Migration | 所有者境界テスト |

## 判断根拠 / 未決事項

- 現在の`OrbitStore`は同期メソッドで、API契約とドメイン処理が既に100テストで固定されている。最初の本番永続化では、全APIを非同期の正規化Repositoryへ一括移植せず、Store境界の前後でD1へ保存することで変更範囲を抑える。
- 既存Schemaは一部のモデル表現が現行`OrbitStore`と一致しないため、状態を欠落させない専用Snapshot表を採用する。正規化Repositoryへの段階移行は別Release hardeningとする。
- SnapshotはOwner単位でVersion CASを行う。競合時に自動Mergeはせず、APIの再試行契約へ委ねる。
- 1リクエストごとの全状態読み書きは、MVPの個人Owner・小規模データを前提とする。データ量・p95が閾値を超えた場合はドメイン単位の正規化Repositoryへ移行する。

## 実装配置

- `src/db/schema.ts`: Snapshot表
- `src/db/repositories/store-snapshot.ts`: D1 read / CAS write
- `src/server/store.ts`: Snapshot serialize / restore
- `src/server/store-session.ts`: Memory / D1の環境分岐
- `src/server/http.ts`: Request sessionのopen / persist
- `src/server/api.ts`: Request Storeを使用
- `drizzle/0001_*.sql`: Migration
