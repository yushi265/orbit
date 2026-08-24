# REL: D1永続化Adapter（service）

## 担保AC

- **AC-1**: 本番のMutation成功後に別リクエストを行うと、Issue・Project・Label・Cycle・View・Notification・Preferenceの変更がD1から復元される。
- **AC-2**: ローカル（`APP_ENV!=production`）では既存のMemory Storeを使い、既存の開発Fixtureとテスト動作を維持する。
- **AC-3**: 同じOwnerの同時リクエストが同じD1スナップショットVersionを読んだ場合、先に保存した1件だけが成功し、後続は409 `D1_WRITE_CONFLICT`になり、後続の状態で先行更新を上書きしない。
- **AC-4**: Handlerが4xx / 5xxを返す、または例外を投げた場合、変更後のスナップショットをD1へ保存しない。

## Request Session契約

- `withOwner`はOwnerを解決した後、`openStoreSession(owner.userId, owner.email)`を1回だけ呼ぶ。
- `handler`へ渡すStoreはRequest専用とし、D1 SessionはグローバルMapへ保持しない。
- 成功したMutation Response（GET / HEAD / OPTIONS以外）、またはSnapshot未作成時の最初の成功GETの場合だけSessionの`persist()`を呼ぶ。既存Snapshotの読み取りはVersionを進めず、4xx / 5xxは破棄する。
- productionでの`DB`未設定・Snapshot破損・CAS競合はエラーEnvelopeへ変換する。
- 既存のAPI Route、HTTP method、JSON body、status、ErrorCode以外の公開契約は変更しない。

## 実装境界

- `auth.ts`は認証・Owner照合だけを担い、業務Storeの生成を持たない。
- `http.ts`はRequest Sessionのライフサイクルを担う。
- `api.ts`は`withOwner`から受け取った`store`を使用し、Storeの永続化方式を知らない。

## テストケース

- [代表値] production SessionのMutation成功後に再度Sessionを開くと変更が見える。
- [代表値] development Sessionは同じMemory Storeを再利用し、seed fixtureが維持される。
- [デシジョンテーブル] GET成功 / Mutation成功 / 400 / 404 / 409 / 500のpersist有無。
- [同値分割] DB Bindingあり / なし、Snapshotあり / なし、Ownerあり / なし。
- [状態遷移] open → handler success → persist、open → handler error → discard。

## 異常系挙動

- D1の読み書き失敗は既存の500 `INTERNAL_ERROR` Envelopeに変換する。
- D1 Version競合は409 `D1_WRITE_CONFLICT`として再試行可能な応答にする。
- 本番でD1を使用できない場合に開発用OwnerやMemory Storeへフォールバックしない。
