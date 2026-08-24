# FEAT-project-view-workspace AI-DLC 振り返り学習ノート

## メタ

- ticket: FEAT-project-view-workspace
- 機能概要: Project詳細とSaved View CRUDを実装する。
- Stage宣言の結果: Tier 1 / spec / TDD / 品質ゲート / self-reviewを実行。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-24 / 2026-08-24

## 各Stageの気づき

| Stage | 気づき |
|---|---|
| 1 要件整理＋Stage宣言 | Project / View APIとBootstrapが既にあるため、detail GETを増やさずに実装できる。 |
| 2 spec作成 | Saved View queryは既存IssueQueryを正本にする。 |
| 3+4 TDD | Project metadataとView layoutの境界をshared / serviceで先に固定すると、UIの保存失敗時状態を単純に保てる。 |
| 5 品質ゲート | strict契約のHTTP wrapper、idempotencyKeyの型、receiptの応答参照を追加確認し、API入口とStoreの両方で固定した。 |
| 6 self-review | code / spec-conformance / test-qualityの3観点で、owner・lock・replay・layout・UIの保存中状態を再確認した。 |
| 8 成果提示 | 変更をmainへコミットし、次のLabel / Bulk機能へ引き継ぐ。 |

## 振り返り（KPT）

### Keep

- 既存Owner / Runtime lock / idempotencyとBootstrap cacheを再利用する。

### Problem

- [spec] Project detailとView管理を同じボルトにまとめるため、API境界を明確に分ける必要がある。
- [test] UIの手動smokeは実行記録を残さないと、Keyboard / viewportの受入証跡が弱くなる。

### Try

- Project metricsとView queryの共有mapperを先にテストする。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| Project / Viewの既存API再利用範囲をGate 2で固定する | create-spec | 完了 |
| Project / ViewのHTTP入口でwrapper・型変換・receipt参照を自己レビュー項目に固定する | self-review | 完了 |
