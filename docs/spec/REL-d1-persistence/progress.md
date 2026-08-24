# REL: D1永続化Adapter 進捗

## Stage宣言

- Tier: Tier 1相当（本番データ境界・認証済みOwner・D1永続化に触れるため）
- 方針: 既存API契約を維持し、D1 Snapshot Adapterを追加する。
- Gate 2委任: あり（2026-08-24、ユーザーの「お願い」により、既存APIを維持するSnapshot案を採用して自律実装）

## Stage 0+1 / 2 証跡

- 読了: `docs/requirements/index.md`、`docs/architecture.md`、`docs/requirements/04-architecture.md`、`.claude/rules/spec-driven.md`、`.claude/rules/testing.md`、`.claude/rules/simplicity.md`、`docs/spec/MVP-linear-project-management/{index,data,service}.md`、`docs/ai-dlc/codekb/{README,shared}.md`。
- 既存調査: `src/server/store.ts`、`src/server/api.ts`、`src/server/http.ts`、`src/server/auth.ts`、`src/db/schema.ts`、`src/db/repositories/{owner,issues}.ts`。
- 単純化判断: 全APIを非同期正規化Repositoryへ一括移植する案を保留し、現行同期Domain StoreをRequest Session前後でD1へ保存するBridgeを採用。既存API・MVP回帰を壊さず本番永続化を成立させる。

## TDD / 品質証跡

- RED: `pnpm exec vitest run src/server/store-persistence.test.ts`を実装前に実行し、`store.toSnapshot is not a function` / `OrbitStore.fromSnapshot is not a function`で失敗することを確認。
- GREEN: Snapshot / Repository / Session追加後、`pnpm test`は追加テスト込みで通過。
- D1 SQL: `pnpm exec wrangler d1 migrations apply orbit --local --persist-to /private/tmp/orbit-d1.udnHNk`で`0000` / `0001`を適用成功。
- Production build: `pnpm run deploy:dry-run`で`APP_ENV=production`、D1 binding、preflight、Wrangler dry-runを通過。

## AC → テスト証跡

- AC-1: `src/server/store-session.test.ts`「loads and persists the production store through D1」「persists only successful mutation handlers」
- AC-2: `src/server/store-session.test.ts`「keeps development sessions on the existing Memory Store」
- AC-3: `src/db/repositories/store-snapshot.test.ts`「rejects a stale writer without overwriting the newer row」、`src/server/store-session.test.ts`「maps a production D1 conflict to a 409 ErrorEnvelope」
- AC-4: `src/server/store-session.test.ts`「persists only successful mutation handlers」
- AC-5: `src/server/store-persistence.test.ts`「round-trips bootstrap data and background state」「round-trips an empty store without inventing an owner」
- AC-6: `src/db/schema.test.ts`、`src/db/migration.test.ts`、`src/db/repositories/store-snapshot.test.ts`「persists and reloads a snapshot with a monotonic version」

## 実装タスク計画

- [x] T1 [data] AC-5,AC-6|なし 依存:なし — Snapshot schema / repository / migration
- [x] T2 [service] AC-1,AC-2,AC-3,AC-4|なし 依存:T1 — Request SessionとAPI Store境界
- [x] T3 [data] AC-1,AC-5|なし 依存:T1,T2 — Snapshot round-trip / D1 fake tests
- [x] T4 [service] AC-1,AC-2,AC-3,AC-4|なし 依存:T3 — 既存API回帰と品質ゲート
- [ ] T5 [infra] AC-1,AC-2,AC-3,AC-4,AC-5,AC-6|なし 依存:T4 — self-review / commit

## 現在位置

- 現Stage: 6 セルフレビュー修正中
- 次の一手: 追加テスト・検証後に再レビューし、Mustゼロを確認する
