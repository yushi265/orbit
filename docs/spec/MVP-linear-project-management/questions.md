# 未決事項 Q&A — MVP（揮発・Gate 2 までに解消）

> 要件定義書と `docs/architecture.md` に明記された、実装前に人間が確定すべき高コスト判断を列挙する。`[Answer]:` が空の項目は回答待ちであり、回答が埋まるまで実装へ進まない。

## Q-1: TanStack Start の固定バージョンと Route / Server Function 配置をどう確定するか

- A. Phase 0 で検証した TanStack Start / Vite / Cloudflare plugin の組み合わせを lockfile に固定し、画面内操作は `src/routes/` の Server Functions、Background Run だけを `/api/v1/background-runs/*` に置く（推奨: 要件の API 方針と最小の公開面に一致）
- B. TanStack Start の安定版を待ち、Server Functions も `/api/v1` に統一する
- X. その他（自由記述）

[Answer]:
[根拠メモ]:

## Q-2: D1 / Drizzle の Schema・Repository・Migration のファイル構成と運用をどうするか

- A. `src/db/schema.ts`、`src/db/repositories/<domain>.ts`、`src/db/client.ts`、`drizzle/` の生成 Migration を採用し、Migration は実 D1 へ適用する前に Preview で検証する（推奨: architecture の配置と責務分離に一致）
- B. SQL Migration を正本にして Drizzle は Query / 型生成だけに限定する
- X. その他（自由記述）

[Answer]:
[根拠メモ]:

## Q-3: Cloudflare Access JWT の署名検証・JWKS 取得・キャッシュ方式をどうするか

- A. Web Crypto を直接扱わず、Phase 0 で検証済みの JWT ライブラリを薄い `AccessJwtVerifier` に閉じ込め、issuer / audience / email を毎 Request 検証し、JWKS の Cache TTL と失敗時の fail-closed を確定する（推奨: 認証実装を service 境界へ隔離）
- B. Worker の Web Crypto API と JWKS 取得をアプリ内で直接実装する
- X. その他（自由記述）

[Answer]:
[根拠メモ]:

## Q-4: D1 FTS5 の tokenizer と NAV-01 の Fallback 採用判定をどうするか

- A. Phase 0 で trigram を含む候補、短い検索語、MATCH 特殊文字、英日混在、1 万 Issue、Rows read / p95 を測り、基準を満たす場合だけ FTS5 を採用し、満たさない場合は title Prefix + `description_text` Fallback を正本にする（推奨: 要件の性能・品質リスクを先に閉じる）
- B. FTS5 の候補検証を省略し、初期から単純 LIKE / Prefix 検索にする
- X. その他（自由記述）

[Answer]:
[根拠メモ]:

## Q-5: Pointer / Touch / Keyboard に対応する Drag & Drop ライブラリをどう選ぶか

- A. Phase 0 で React 現行版、Touch Sensor、Keyboard Sensor、仮想 List、WCAG 代替操作を検証し、最小の実装で基準を満たすライブラリを固定する（推奨: UI の端末差・Accessibility リスクを実機で確認）
- B. Drag & Drop を MVP から外し、Menu / Keyboard の並び替えだけを提供する
- X. その他（自由記述）

[Answer]:
[根拠メモ]:

## Q-6: Tiptap JSON の sanitize と Markdown 変換互換性をどう確定するか

- A. Tiptap JSON を保存形式の正本にし、Server 側で schema 検証・sanitize・`description_text` 射影を行い、Markdown 変換は Phase 0 の可逆性テストを通過した範囲だけ提供する（推奨: XSS とデータ互換性を分離）
- B. Markdown を保存形式の正本にし、表示時に Tiptap JSON を生成する
- X. その他（自由記述）

[Answer]:
[根拠メモ]:

## Q-7: Background Run の `CHUNK_SIZE`、`RUN_LEASE_MS`、`HEARTBEAT_INTERVAL_MS` とローカル検証方式をどう確定するか

- A. Worker 実行時間、D1 batch 件数、最悪 payload を Phase 0 で計測し、`HEARTBEAT_INTERVAL_MS < RUN_LEASE_MS / 3` を満たす具体値と、Miniflare / 実 D1 のどちらを Lease・同時実行の正本テストにするかを決める（推奨: 環境制約に合わせて数値を決定）
- B. 固定の保守的な数値を先に採用し、負荷試験は後回しにする
- X. その他（自由記述）

[Answer]:
[根拠メモ]:

## Q-8: 唯一 Owner の初回 Bootstrap と `OWNER_USER_ID` の投入・ローテーション手順をどうするか

- A. 初回 Migration / 運用手順で UUID v7 の `users` 行と `user_runtime_locks` の idle 行を作り、`OWNER_USER_ID` は Worker Secret / Environment へ投入し、未設定・不一致は fail closed とする（推奨: 要件の本人限定・所有者境界を運用まで含めて固定）
- B. 初回アクセス時に JWT から users 行を自動作成する
- X. その他（自由記述）

[Answer]:
[根拠メモ]:
