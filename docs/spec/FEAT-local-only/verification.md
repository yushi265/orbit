# ローカル専用動作の検証記録

検証日: 2026-09-08。ブランチ: `feature/local-only`。コード・テストレビュー完了。AC-7の監査証跡不足を残す。

## 実行環境

- macOS、Node v24.20.0、pnpm 11.18.0。
- Vite 7.3.6、Cloudflare Vite Plugin 1.53.1、Wrangler 4.125.0。
- Chrome 152.0.7977.76を新規一時プロファイルで使用。Service Workerを無効にし、既存ブラウザのキャッシュ・ログイン情報を使用しない。
- 検証用DBは一時ディレクトリに分離。既存クラウドDB・日常利用DBは操作していない。

## 外部通信遮断

macOSの`sandbox-exec`で検証プロセスと子プロセスの外向き通信を拒否し、loopbackだけを許可した。

```scheme
(version 1)
(allow default)
(deny network-outbound)
(allow network-outbound (remote ip "localhost:*"))
```

事前プローブでloopback接続成功、予約済み試験用アドレス192.0.2.1への接続が`EPERM`になることを確認した。この制約下で専用CLIのsetup / startとブラウザを実行し、初期化・Bootstrap・画面表示が成功した。

Node子プロセスの通信防壁ログも確認する。これはNodeの拒否記録であり、workerdを含めた全プロセスの網羅的な通信監査ログとは同一視しない。workerdを含む外部通信への依存がないことはOS遮断下での実動作で確認する。

## ブラウザ

Home / Issues / Projects / Cycles / Views / Search / Inbox / Settingsを、1280px / 768px / 390pxの3幅、計24ページで検証した。

| 確認項目 | 結果 |
|---|---|
| アプリ由来の外部HTTP / WebSocket要求 | 0件 |
| Request失敗 | 0件 |
| ページJavaScript例外 | 0件 |
| HTTP 4xx / 5xx | 0件 |
| documentの横幅超過 | 全24ページでなし |
| スクリーンショット目視 | PC・スマホのHome、およびデータありIssue詳細を確認。フォント変更後も主要操作・文字が表示される |

## サービス層

実装担当: `pnpm exec vitest run src/server`で26ファイル195テスト成功。親の独立実行でもruntime設定・認証・Snapshot関連5ファイル40テスト成功。local / development / productionの分岐、Host / Origin、Owner、CAS、保存失敗、Leaseを含む。全体品質ゲートは後述の最終実行で確定する。

## 実APIシナリオ

外部通信遮断下で、Project / Label / Issue / Note / Relation / Cycle / View / Preference / Recentの作成・変更、検索、Manual Runの開始と3Chunk完了、同一key再試行、Host / Origin拒否、404、Run中423を実行し、各APIの期待HTTP statusを確認した。

検証ハーネスの修正点: Vite手前のHost拒否は403 text、APIのOrigin拒否は400 JSON。related Relationの保存方向はIDソートされるため、相手の確認は公開`target.id`と両端ID集合を使用する。アプリの期待挙動を緩和する変更は行っていない。

通常OwnerへのNotification生成は既存実装にないため、実APIでは空のInboxを確認する。Notificationを含む非空Snapshotの保存・復元は既存Snapshotテストで担保し、実APIで通知生成まで確認したとは扱わない。追加の`local-repository.integration.mjs`では明示したsynthetic Notificationを含めて全Snapshot配列を非空にし、本物Repositoryと実D1で再生成・復元を比較する。

## 最終確認

- 親の独立実行: `node --import tsx src/referee/cli.ts --layer all`（.claude/aidlc内）でapp（typecheck / 全test / lint）とformat-checkがGREEN。
- 親の独立実行: OS通信遮断下の`node --test scripts/local.integration.mjs`で1テスト成功、0失敗、28.42秒。初期化、API保存、再初期化、再起動、実D1 CAS・Owner分離、バックアップ復元と復元後更新を含む。
- `pnpm build`成功。通常sandboxではWranglerのホーム下ログ書込だけがEPERMとなったため、`WRANGLER_LOG_PATH`を検証用一時パスへ指定した再実行も成功。
- 実APIのProject / Issue / Label / Cycle / View / Preference / Note / Relation / Recent / 完了Runを再起動後に検査し、さらにCLI backup / restore後のBootstrap、Issue詳細2件、Recent、Inbox、Runの6応答を保存した期待状態と全文比較して一致した。
- 復元先を使ったOS遮断ブラウザでIssue作成→タイトル自動保存→再読込→Trash→復元→検索、Inbox表示、Maintenance Run完了を実操作。外部Request0、JavaScript例外0。
- 独立レビューの修正: lock領域配下へのbackup/restoreを事前拒否（成功コピー消失を防止）、本文の残存フォント指定除去、他Owner Runのcontinueを423でなく404へ統一。実Repository×実D1競合、全状態復元・中断Run再開、コピー途中失敗・権限不足・port使用中・他Owner Run拒否のケースを追加した。

## 未確認範囲と判定

AC-7の「全子プロセス・DNSを含めた外部通信試行ゼロ」は未確認。Nodeの防壁ログとブラウザHTTP / WebSocketログはゼロだが、native workerdの全試行ログの代替にはしない。

自作Nodeプローブに加え、自作Cのネイティブ接続プローブでOS遮断時の`EPERM`を確認した。macOSの`debug deny`、`allow (with report)`、PID限定log stream / log showも試したが、既知の接続試行の監査行が得られず、陽性対照が成立しなかった。nested sandboxも適用時に拒否された。このため、OSログに記録がないことを試行ゼロの証明に使っていない。

ローカル実行機能と外部通信への非依存はOS遮断実測で確認済み。AC-1はその機能基準を満たすものと判定し、より厳しい監査基準はAC-7に未完了として残す。全AC達成・全レビュー指摘解消とは報告しない。追加監査にはnative子プロセスの接続・DNS試行を観測できる別の検証環境が必要。


## 修正後の最終結果

- 親がOS遮断下で`node --test --test-concurrency=1 scripts/local.integration.mjs scripts/local-repository.integration.mjs`を独立実行: **2 passed / 0 failed / 31.46秒**。
- 公開Repositoryの実D1 CAS、全Snapshot非空での再生成・バックアップ復元・中断Run再開、古cursorと完了後再送の重複効果なしを検証。
- 修正後refereeのapp（全test・typecheck・lint）とformat-checkはGREEN。最終buildも成功。
- コードレビューとテスト品質レビューのMust / Should / IMOはゼロ。specレビューでは機能基準はAC-1〜6・8を満たし、AC-7のnative通信試行監査だけ証跡不足が残る。
- 検証用サーバーは停止済み。この検証時点ではコミット・pushは実施していない。


## 提出前チェック

- pre-commitのlint・format・gitleaksは成功。secret検査は漏洩検出なし。
- advisory hookのtsx IPCがsandbox権限で実行できなかったため、同じCLIを`node --import tsx`で独立実行し、anti-tamperは「テスト改ざんの兆候なし」、learnings surfaceも実行成功。hookの終了コードだけで成功と扱っていない。
- テスト差分（Git staged numstat）: local-repository.integration +278/-0、local.integration +138/-0、local.test +318/-0、auth-owner-boundary +64/-5、http-local +153/-0、runtime-config +22/-0、store-session +375/-289。既存Sessionの削除行はlocal / productionへのパラメータ化に伴う移動・整形で、ケース削減ではない。
- 既存ユーザーのCLAUDE.md差分は変更・ステージせず保持。今回のコミット対象には含めない。


## TDDとレビューの保存記録

作業用進行ファイルを除去する前に、実装の起点とレビュー修正の証跡を本書へ移した。LAN拡張の詳細なRED/GREENは[lan.md](./lan.md)に保存する。

| 対象 | REDで確認した失敗 | GREENの担保 |
|---|---|---|
| 実行設定表 | runtime-configモジュール未存在 | runtime-config.test.tsの設定表 |
| 固定Owner | local-owner期待に対しattackerを返す | auth-owner-boundary.test.ts |
| Host / Origin | 外部URLの400期待に200 | http-local.test.ts |
| local永続化 | Memoryリセット後のIssueが空配列 | store-session.test.ts、実D1結合 |
| CLI | local.mjsモジュール未存在 | local.test.mjs、production bootstrap回帰 |
| コピー先とlock領域 | lock配下コピーが拒否されず成功扱い | 重複する本体/lock領域の事前拒否 |
| コピー失敗 | 部分コピー後のEIO | 部分成果の除去、元データ保持、復元先空を検証 |
| 非所有Runのcontinue | 404期待に423 | getRunをlockTokenForより先行しGET/continue/resumeで404、状態不変 |

手書きCAS SQLだけの結合検証は公開Repositoryを実際に呼ぶテストへ置換し、Version条件の回帰を捕捉する。全Snapshot配列非空、runtime再生成、backup/restore、中断Run再開、古cursor/完了後の再送による重複効果なしを検証済み。

2026-09-12の最終LAN差分も3観点で独立レビューし、新規Must / Should / IMOなし。親が設定・引数、Worker vars、Host/Origin、DNS解決とTCP制限、lock領域の拒否をコードと実動作で照合した。

## コミット・PR承認（2026-09-12）

ユーザーの動作確認・停止指示後、「コミットしてPR作成してください。」を受領。ローカル起動・LAN対応をまとめてコミットしPRを作成する。AC-7のnative全通信試行監査は引き続き未確認としてPRにも明記し、全AC達成には変更しない。作業用progress.mdは除去し、実装契約・検証証跡・retro noteを残す。
