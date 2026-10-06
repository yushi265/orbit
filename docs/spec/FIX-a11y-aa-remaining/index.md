# FIX-a11y-aa-remaining: WCAG 2.2 AA の残り（Medium / Low）の修正

## 概要

2026-10-06 の WCAG 2.2 AA 監査で Medium / Low 判定だった項目のうち、FIX-ux-a11y-high で対応していないものを ui レイヤーで修正する。

## 対象範囲

- 対象レイヤー: ui のみ → [ui.md](./ui.md)
- 対象ドメイン: Settings、検索、Cycle / Inbox のタブ、入力欄とカスタム select、カレンダー、コマンドパレット、ヘッダー / サイドバー、Issue 一覧、ページタイトル
- 対象外（やらないこと）:
  - 1.4.10 リフロー（320px）の実測と修正（実ブラウザでの計測が必要）
  - `src/routes/**` の変更（ページタイトルは `OrbitApp` 内の `document.title` で設定する）
  - API・共有 Zod 契約・D1 の変更
  - ダークテーマの配色の全面見直し（入力欄の枠線だけ扱う）
  - 監査の UX Medium / Low

## ユニット計画

単一ユニット。

## 受け入れ基準（AC）

- [ ] **AC-1**: Settings の「Theme」「Color theme」「Timezone」「Language」の select は、見た目の見出し要素を `aria-labelledby` で参照し、アクセシブルな名前が見出しの文字列で始まる。
- [ ] **AC-2**: 検索画面で、結果件数（「N件のIssue」）と「検索しています…」を常設の `role="status"` 要素の中に表示する。
- [ ] **AC-3**: Cycle のタブは `role="tablist"` の中の `role="tab"` で、選択中のタブだけ `aria-selected="true"` かつ `tabIndex=0`（他は -1）。左右矢印・Home・End で選択が移動し、フォーカスも移る。
- [ ] **AC-4**: Inbox の「すべて / 未読」の切替は `role="tab"` を使わず、選択中に `aria-pressed="true"` を持つトグルボタンにする。
- [ ] **AC-5**: 入力欄（`.text-input`・`.filter-select`・日付入力・`OrbitSelect` のトリガー）の枠線色は、ライトでは `#ffffff` と `#f7f8fa`、ダークでは `#19202b` に対して 3:1 以上になる。
- [ ] **AC-6**: `OrbitSelect` でキーボード選択中（active）の候補は、背景との 3:1 以上の差を持つ枠線または背景で示される。
- [ ] **AC-7**: カレンダーで選択中の日付は `--orbit-accent-solid` の地に白文字で、4.5:1 以上になる。
- [ ] **AC-8**: スクロールのとき、フォーカスした要素がモバイルの固定下部ナビの裏に隠れないよう、767px 以下で `scroll-padding-bottom` が下部ナビの高さと safe area 以上ある。カレンダーは、フォーカスがカレンダーとトリガーの外に出たら閉じる。
- [ ] **AC-9**: Issue の絞り込み入力、検索ページの入力、コマンドパレットの入力と候補の listbox に、アクセシブルな名前がある。
- [ ] **AC-10**: 「×」だけを表示する閉じるボタンすべてに `aria-label` がある。通知ボタンの名前は未読があるとき「通知（未読N件）」になる。Cycle 画面の Issue の優先度は、色のドットではなく名前つきの `PriorityIcon` で示す。
- [ ] **AC-11**: `document.title` が画面ごとに変わる（Home / Inbox / Issues / Cycles / Projects / Views / Search / Settings は「<画面名> — Orbit」、Issue 詳細を開いているときは「<識別子> <タイトル> — Orbit」）。
- [ ] **AC-12**: 何も起きないアバター「OU」とワークスペース切替はボタンではない要素にする。サイドバーのナビ項目のアイコン記号は `aria-hidden="true"` で、項目の名前に含まれない。
- [ ] **AC-13**: Issue 一覧（List）に `role="table"`・`row`・`columnheader`・`cell` を付ける。本文（`main`）へ移動するスキップリンクが最初のフォーカス対象にある。デスクトップの `.text-button` のターゲットは高さ 24px 以上。

## アーキテクチャ / レイヤー間フロー

ui レイヤーで完結する。API 呼び出しは変えない。

## エラー・ログ方針（横断サマリ）

| シナリオ | 表示層の挙動 |
|---|---|
| 検索 API の失敗 | 既存のエラー表示のまま。`role="status"` の件数表示は更新しない |
| 本変更で新しく発生する異常系 | なし（表示属性とスタイルのみ） |

## テスト戦略

| AC | 単体 | レイヤー内結合（jsdom） |
|----|------|--------------|
| AC-1 | — | Settings の名前 |
| AC-2 | — | 検索画面の status |
| AC-3 | — | Cycle タブの role と矢印キー |
| AC-4 | — | Inbox のトグル |
| AC-5〜7 | styles.css のコントラスト計算 | — |
| AC-8 | styles.css のルール | カレンダーの focusout |
| AC-9〜12 | — | 名前・属性・タイトル |
| AC-13 | styles.css のルール（24px） | 表のロール・スキップリンク |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `a11y-contrast.test.ts` のコントラスト計算、`PriorityIcon`、既存の jsdom フィクスチャ。
- 差分: 属性追加とスタイルが中心。Cycle タブは roving tabindex（選択中だけ Tab で止まる方式）を追加。
- 衝突: Issue 一覧の DOM 構造を見ている既存テストがあれば、ロール属性の追加だけで済むよう要素構造は変えない。

## 実装に効く制約

- `src/shared/**`・`src/server/**`・`src/routes/**`・`drizzle/**` を変更しない。
- 新しい色は CSS 変数にまとめる。
- 要素の構造（div のグリッド）は変えず、ロール属性を足す。

## 判断根拠 / 未決事項

- ページタイトルは `OrbitApp` の `section` と選択中の Issue から `document.title` を設定する。却下案: 各ルートの `head()`（`src/routes/**` を触るため Tier 1 になる。Issue のタイトルはクライアントでしか分からない）。
- Inbox はタブではなくトグルボタンにする。却下案: tabpanel と roving tabindex を足す（パネルの切替ではなく一覧の絞り込みなので、トグルの方が意味に合う）。
- Cycle のタブは中身がパネルとして切り替わるので、tab パターンのまま足りない部分を補う。
- Issue 一覧は `<table>` に置き換えず、ロールを付ける（CSS グリッドと既存テストを壊さないため）。
- 未決事項: なし。
