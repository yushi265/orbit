# 要件定義

Linearライクな個人用プロジェクト管理アプリの要件定義を、領域ごとに分割して管理する。実装時の要件・受入条件・技術方針の正本はこのディレクトリに置く。

- 文書バージョン: 1.1
- 作成日: 2026-08-23
- 想定デプロイ先: Cloudflare Workers
- フロントエンド: TanStack Start（React）
- 想定読者: プロダクトオーナー、デザイナー、開発者、AIコーディングエージェント

## 読み方

1. [プロダクト概要・スコープ](./01-product.md)で目的、対象ユーザー、MVPと将来スコープを確認する。
2. [機能要件](./02-functional.md)で認証、Issue、Cycle、Project、View、通知、設定の要件を確認する。
3. [UI / UX・非機能要件](./03-ux-and-nfr.md)で端末対応、アクセシビリティ、性能、SLOを確認する。
4. [技術・データ・処理フロー](./04-architecture.md)でCloudflare構成、API、スキーマ、整合性方針を確認する。
5. [画面・受入・開発計画](./05-acceptance-and-delivery.md)で画面一覧、AC、テスト、Phase、MVP完成条件を確認する。
6. [参考資料](./06-references.md)で調査に使った一次情報・公式資料を確認する。

## 文書間の関係

| 文書 | 範囲 | 主な読者 |
| --- | --- | --- |
| [01-product.md](./01-product.md) | 目的、調査要約、プロダクト定義、優先順位、情報構造 | 全員 |
| [02-functional.md](./02-functional.md) | 認証、個人設定、Issue、Cycle、Project、View、検索、通知、監査 | PO、開発者、AI |
| [03-ux-and-nfr.md](./03-ux-and-nfr.md) | UI / UX、レスポンシブ、アクセシビリティ、非機能要件 | デザイナー、開発者 |
| [04-architecture.md](./04-architecture.md) | 技術選定、Cloudflare構成、API、状態管理、データモデル、処理フロー | 開発者、AI |
| [05-acceptance-and-delivery.md](./05-acceptance-and-delivery.md) | 画面、受入シナリオ、テスト戦略、開発Phase、リスク、MVP完成条件 | PO、開発者、QA |
| [06-references.md](./06-references.md) | Linear、TanStack、UI、Cloudflareの参考資料 | 調査・設計担当 |

## 更新ルール

- このディレクトリ内の分割文書を要件定義のSSoT（Single Source of Truth）とする。
- 要件の意味を変更する場合は、関連する分割文書と [docs/architecture.md](../architecture.md) の整合を同じ変更で確認する。`docs/architecture.md`は実装レイヤー境界・依存方向、`04-architecture.md`は要件側の技術・データ・処理契約を扱う。
- チケット単位の実装契約は [../spec/](../spec/) に作成し、要件定義を上書きしない。
- 旧ルートの `REQUIREMENTS.md` は廃止し、リンクはこの入口へ向ける。
