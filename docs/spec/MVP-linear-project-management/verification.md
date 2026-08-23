# MVP検証マトリクス（Stage 6）

| AC | ローカル実装 / テスト証跡 | 状態 |
|---|---|---|
| AC-1 | `src/server/store.test.ts` の採番、`src/routes/issues/`、dev SmokeのIssue作成 | 部分達成。Preview p95はT7 |
| AC-2 | `OrbitStore.closeCycle` とCycle繰越テスト | 部分達成。実D1 CAS/並行実行はT7 |
| AC-3 | Priority/Status UI、レスポンシブCSS | 部分達成。実端末Journeyは未実測 |
| AC-4 | `useMutation`のOptimistic snapshot rollback | 部分達成。Browser Scroll/Retry Smokeは未実測 |
| AC-5 | 401 Top-level login、公開静的Asset限定Service Worker、transport分類 | 部分達成。Access/PWA実環境は未実測 |
| AC-6 | production Access JWTのJWKS検証、D1 owner lookup、Owner別Store | 部分達成。Preview実D1適用はT7 |
| AC-7 | version条件、409、Activity/Outboxテスト | 部分達成。実D1 batch CASはT7 |
| AC-8 | Receiptの同一Request再送 / Key再利用テスト | 部分達成。期限/Purgeと実D1はT7 |
| AC-9 | 固定3 Step、202、Run API、schema検証、lock | 部分達成。Chunk並行再送/実D1はT7 |
| AC-10 | 423 lock、Run Overlay、mutation抑止 | 部分達成。全Mutation matrix/別端末はT7 |
| AC-11 | fake clockのLease expiry / paused / resumeテスト | 部分達成。古いWorkerとD1 CASはT7 |
| AC-12 | failed/skipped状態遷移コード | 部分達成。障害注入テストはT7 |
| AC-13 | cursor不一致No-op、Step順序テスト | 部分達成。effect dedupe/同時HTTPはT7 |

この表は「MVPのローカル実行可能範囲」と「Cloudflare Previewで閉じる範囲」を混同しないための証跡である。T7完了までは本番D1の整合性を完了扱いにしない。
