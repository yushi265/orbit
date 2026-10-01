# FEAT-local-only: ローカル専用動作の実装計画

2026-09-12のユーザー指示によるLANアクセス拡張は[lan.md](./lan.md)を正本とする。以下のloopback限定・LAN対象外の記述は通常起動に適用し、`--lan`起動は追加契約に従う。

作成日: 2026-09-08。状態: **実装済み・AC-7の全プロセス通信試行監査は未確認**。外部チケット未発行のため、ディレクトリ名は仮識別子とする。

## 概要

Cloudflareアカウント・Access認証・クラウドDBを使わず、同じPCのブラウザからOrbitを継続利用できるモードを追加する。画面とAPIはローカルで実行し、業務データをPC内へ永続化する。

本書の「ローカルのみ」は、依存パッケージを事前導入した後、インターネット接続なしで初期化・起動・操作・再起動・復元ができることを指す。Cloudflare製ツール自体の排除は意味しない。推奨案は既存のVite Plugin / workerdとローカルD1を使う。依存パッケージ取得までオフラインにする配布物は今回対象外。

2026-09-08、計画提示後のユーザー「ブランチを切って実装を進めて」に基づき、以下の推奨案を契約として実装を開始した。認証とデータ境界を変更するTier 1としてTDD・品質ゲート・独立レビューを実施する。コミットは別途Gate 3の対象とする。

## 現状調査と実現可能性

| 現在の構成・証拠 | 意味 / 必要な変更 |
|---|---|
| [package.json](../../../package.json)、[vite.config.ts](../../../vite.config.ts) | TanStack Start + Vite + Cloudflare Pluginの起動経路が存在する。全面移植は不要 |
| [auth.ts](../../../src/server/auth.ts) | 非productionかつAccessヘッダーなしなら開発Owner。productionではAccess JWKS取得とD1 Owner照合が必要 |
| [store-session.ts](../../../src/server/store-session.ts) | 非productionではMemory Storeに固定。DB Bindingを追加するだけでは永続化しない |
| [store-snapshot.ts](../../../src/db/repositories/store-snapshot.ts) | Owner単位のJSON SnapshotとVersion CASを再利用できる |
| [0001 Migration](../../../drizzle/0001_lumpy_fabian_cortez.sql) | Snapshotにusersへの外部キーがあり、Owner実行時生成だけでは不足。DB側のOwner初期登録が必要 |
| [bootstrap-owner.mjs](../../../scripts/bootstrap-owner.mjs)、package.json | 既存初期化・Migrationコマンドはremote向け。ローカル専用経路が必要 |
| [styles.css](../../../src/styles.css) | Google Fontsへの外部読み込みがある。システムフォントへ変更する |
| [http.ts](../../../src/server/http.ts) | Mutationは独自ヘッダーを検査するが、Originの一致そのものは未検査。ローカルモードのアクセス境界を追加する |

直前の調査で、Node v24.20.0 / pnpm 11.18.0を使い、`pnpm dev --host 127.0.0.1 --port 3017 --strictPort`で起動、トップページとBootstrap APIがHTTP 200、初期Issue 4件の取得を確認した。ポート待受には実行環境の権限制約の解除が必要だった。全画面操作、永続化、通信遮断テストは未実施。検証用サーバーは停止済み。

## 対象範囲

- [service.md](./service.md): 実行モード、認証、Store選択、アクセス境界。
- [data.md](./data.md): ローカルD1、Owner初期化、永続化、バックアップと復元。
- [ui.md](./ui.md): 外部フォント除去、既存画面のローカル動作確認。
- [infra.md](./infra.md): 起動・初期化コマンド、設定分離、通信遮断検証と利用手順。
- 既存のIssue / Project / Cycle / View / Search / Inbox / Settings / Manual Runを対象とする。通知はアプリ内Inbox、バックグラウンド処理は既存の手動HTTP Chunk方式。

対象外: クラウド既存データの移行・同期、LANやインターネットへの公開、複数ユーザー、PC間同期、OS自動起動、デスクトップアプリ化、サーバー停止中の処理、Node + SQLiteへの全面移植。既存クラウド経路の削除も行わず、回帰を防ぐ。

## ユニット計画

単一ユニット「ローカル専用の継続利用」。CLI・DB初期化、OwnerとSession、運用・表示、実結合とブラウザ検証、独立レビューの順に実装した。検証とTDD証跡は[verification.md](./verification.md)、LAN拡張は[lan.md](./lan.md)を参照する。

## 受け入れ基準（AC）

- [x] **AC-1**: 依存導入後、Cloudflare資格情報と外部通信がなくても、ローカルDB初期化・起動・画面表示・Bootstrap取得が成功する。
- [x] **AC-2**: Issue・Project・Label・Cycle・View・Notification・PreferenceとRun内部状態が、保存成功後のサーバー再起動でも保持される。
- [x] **AC-3**: ローカルモードは固定Ownerだけを扱い、外部Host・異なるOriginのMutationを拒否し、productionではローカル認証へフォールバックしない。
- [x] **AC-4**: ローカル初期化は再実行しても既存データを変更せず、DB欠落・破損・書込失敗でMemory Storeへフォールバックしない。
- [x] **AC-5**: 競合更新は409 D1_WRITE_CONFLICTとなり、失敗したRequestはSnapshotを保存せず、Owner間のデータが混在しない。
- [x] **AC-6**: 停止中に作成したバックアップから別の空の保存先へ復元でき、業務データとRun内部状態が一致する。
- [ ] **AC-7**: クリーンなブラウザと外部通信遮断環境で、主要画面・CRUD・検索・Inbox・Manual Runが動作し、アプリと起動ツールから外部通信を試みない。
- [x] **AC-8**: ローカル用コマンドは明示した同一保存先だけを使い、remote操作を含まず、既存の開発Memory Storeとproduction認証・保存のテストが通る。

## アーキテクチャ / レイヤー間フロー

```text
同じPCのブラウザ（http://127.0.0.1:3000）
  → Vite + workerd（loopbackのみ）
  → ローカルHost / Origin検証 → 固定Owner解決
  → 既存API / OrbitStore / Request Session
  → Snapshot Repository（既存CAS）
  → ローカルD1（PC内の永続ファイル）
```

保存先はinfra、Owner識別子と初期データはdata、環境変数の組み合わせはserviceを正本とする。APIパスと業務Request / Response、共有Zodスキーマの追加変更は予定しない。クラウド経路には既存の認証・D1契約を適用する。

## エラー・ログ方針（横断サマリ）

| シナリオ | 挙動 | 利用者への案内 |
|---|---|---|
| 設定矛盾・初期化失敗 | CLI非ゼロ終了。起動を継続しない | 設定または初期化手順の確認 |
| 外部Host / Origin | API到達時は400 VALIDATION_ERROR。ViteのHostガードで先に拒否する場合は403 text | 既存APIエラー表示、または開発サーバーの拒否応答 |
| production認証失敗 | 既存401 AUTH_REQUIRED | 既存再認証処理 |
| DB / Snapshot障害 | 500 INTERNAL_ERROR。保存成功を返さない | バックアップ保持のうえDB確認 |
| CAS競合 | 409 D1_WRITE_CONFLICT | 再取得・再試行 |
| Run中の業務Mutation | 既存423 OPERATION_IN_PROGRESS | 既存処理中表示 |

ログにSnapshot、JWT、個人データを出さない。Requestエラーは既存requestIdで追跡し、CLIは失敗工程と対処を示す。詳細は各レイヤー参照。

## テスト戦略

実測結果と未確認範囲は[verification.md](./verification.md)を参照。AC-7はOS遮断下での機能動作・ブラウザ通信を確認済みだが、native workerdを含む全子プロセスの通信試行監査が環境制約で未確認のため未完了とする。

| AC | 単体 | レイヤー内結合 | 実環境での追加確認 |
|---|---|---|---|
| AC-1 | 設定解決 | CLI初期化→API | 資格情報なし・通信遮断でcold start |
| AC-2 | Snapshot変換は既存再利用 | 実ローカルD1保存→再読込 | プロセス停止・再起動 |
| AC-3 | モード表、Origin解析 | 認証・Owner境界 | loopback以外の待受がない |
| AC-4 | 初期化引数 | 二度の初期化、DB障害注入 | 保存先権限・未初期化 |
| AC-5 | 既存CAS検証 | 実D1競合・失敗Request・Owner分離 | — |
| AC-6 | バックアップ引数 | 停止→コピー→別ディレクトリ復元 | 同一ツール版で再起動 |
| AC-7 | 外部URL検査（補助） | 既存ドメイン・UIテスト | ブラウザ＋サーバー外向き通信検査 |
| AC-8 | CLI引数・設定表 | 開発・production回帰 | 異なるcwdでも同じ保存先 |

Fake D1だけを永続化完了の証拠にしない。実D1結合は隔離した一時ディレクトリで行い、利用者のDBを操作しない。品質ゲートは`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm build`。実環境試験の追加コマンドはinfraに記載する。

## 既存実装との関係 / 制約

[既存D1 spec](../REL-d1-persistence/index.md)と[codekb](../../ai-dlc/codekb/shared.md)を参照し、実コードで環境分岐・CAS・Owner外部キーを照合した。Snapshot全件読み書きの負荷特性は維持し、正規化Repositoryへの移行は行わない。Manual RunのLease / cursor / receiptを保存対象から外さない。

[architecture.md](../../architecture.md)の「ローカル開発はMemory Store」と、[認証要件](../../requirements/02-functional.md)のAccess前提は、ローカル専用モードの追加に合わせた適用範囲の変更が必要。本書だけで上書きせず、承認後に要件02 / 04 / 05、architecture、READMEへ反映する。既存specは従来の開発モードを指すものとして維持する。

## 判断根拠 / 未決事項

| 採用設計 | 理由・トレードオフ |
|---|---|
| ローカルD1と既存Snapshotを再利用 | 最小の変更で既存業務処理を維持できる。Cloudflareツールと内部保存形式への依存は残る |
| APP_ENVにlocalを追加し保存先を別設定にする | 開発Memory Store・local永続化・productionを明示的に分離できる。不正な組み合わせは拒否する |
| 固定Owner、loopback限定 | 個人・同じPCでの用途に合わせる。OSアカウント内の他プロセスからのアクセスを防ぐログイン機構ではない |
| システムフォント | フォント取得が不要。現在と字幅・見た目が多少変わるためUI確認が必要 |
| 停止中の状態ディレクトリ全体バックアップ | SQLiteのWALを含む整合性と実装量を両立。実行中コピーや異なるツール版への復元は保証しない |

代替案: Node + SQLiteはツール依存を減らせるが、ランタイム・DB Adapter・起動構成の移植範囲が広い。JSONファイル保存は既存CASとDB制約の再実装が必要。ブラウザ保存だけではサーバー側ドメイン処理との大幅な構成変更が必要。今回の推奨案にはしない。

次の3点は、計画提示後の実装指示（2026-09-08）に基づき推奨案を採用する。

1. Cloudflare製ローカルツールの利用を許容し、初期パッケージ取得はオンラインで行う範囲とする。
2. 同じPC・固定Owner・新規空データで開始し、既存クラウドデータ移行やLAN公開を対象外とする。
3. システムフォント、明示的な保存ディレクトリ、停止中バックアップを採用する。

## 技術根拠

2026-09-08確認。Cloudflare公式の[ローカルデータ](https://developers.cloudflare.com/workers/local-development/local-data/)と[Vite Plugin API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/)は、ローカルDBの永続化と設定方法の根拠。導入済みPlugin 1.53.1の型でも`configPath`、`persistState`、`inspectorPort`を確認した。具体的な起動・保存の整合性は実装時にインストール済みバージョンで検証し、公式記載のみを完了証拠にしない。
