# FIX-a11y-aa-remaining: ui 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: Settings の「Theme」「Color theme」「Timezone」「Language」の select は、見た目の見出し要素を `aria-labelledby` で参照し、アクセシブルな名前が見出しの文字列で始まる。
- **AC-2**: 検索画面で、結果件数（「N件のIssue」）と「検索しています…」を常設の `role="status"` 要素の中に表示する。
- **AC-3**: Cycle のタブは `role="tablist"` の中の `role="tab"` で、選択中のタブだけ `aria-selected="true"` かつ `tabIndex=0`（他は -1）。左右矢印・Home・End で選択が移動し、フォーカスも移る。
- **AC-4**: Inbox の「すべて / 未読」の切替は `role="tab"` を使わず、選択中に `aria-pressed="true"` を持つトグルボタンにする。
- **AC-5**: 入力欄（`.text-input`・`.filter-select`・日付入力・`OrbitSelect` のトリガー）の枠線色は、ライトでは `#ffffff` と `#f7f8fa`、ダークでは `#19202b` に対して 3:1 以上になる。
- **AC-6**: `OrbitSelect` でキーボード選択中（active）の候補は、背景との 3:1 以上の差を持つ枠線または背景で示される。
- **AC-7**: カレンダーで選択中の日付は `--orbit-accent-solid` の地に白文字で、4.5:1 以上になる。
- **AC-8**: スクロールのとき、フォーカスした要素がモバイルの固定下部ナビの裏に隠れないよう、767px 以下で `scroll-padding-bottom` が下部ナビの高さと safe area 以上ある。カレンダーは、フォーカスがカレンダーとトリガーの外に出たら閉じる。
- **AC-9**: Issue の絞り込み入力、検索ページの入力、コマンドパレットの入力と候補の listbox に、アクセシブルな名前がある。
- **AC-10**: 「×」だけを表示する閉じるボタンすべてに `aria-label` がある。通知ボタンの名前は未読があるとき「通知（未読N件）」になる。Cycle 画面の Issue の優先度は、色のドットではなく名前つきの `PriorityIcon` で示す。
- **AC-11**: `document.title` が画面ごとに変わる（Home / Inbox / Issues / Cycles / Projects / Views / Search / Settings は「<画面名> — Orbit」、Issue 詳細を開いているときは「<識別子> <タイトル> — Orbit」）。
- **AC-12**: 何も起きないアバター「OU」とワークスペース切替はボタンではない要素にする。サイドバーのナビ項目のアイコン記号は `aria-hidden="true"` で、項目の名前に含まれない。
- **AC-13**: Issue 一覧（List）に `role="table"`・`row`・`columnheader`・`cell` を付ける。本文（`main`）へ移動するスキップリンクが最初のフォーカス対象にある。デスクトップの `.text-button` のターゲットは高さ 24px 以上。

## このレイヤーが公開する契約（外部インターフェース）

画面パス・ルーティング・API の増減はない。ui 内部の契約は次のとおり。

| 操作 | 名前 | 値・制約 | 用途 |
|------|------|---------|------|
| 追加 | CSS 変数 `--orbit-input-border` | ライトは `#fff`・`#f7f8fa` に対して 3:1 以上、ダークは `#19202b` に対して 3:1 以上 | AC-5 |
| 追加 | `document.title` | 「<画面名> — Orbit」。画面名は Home / Inbox / Issues / Cycles / Projects / Views / Search / Settings。Issue 詳細は「<識別子> <タイトル> — Orbit」 | AC-11 |
| 追加 | スキップリンク `a.skip-link[href="#main-content"]` | 本文は `main#main-content`。フォーカスされるまで見えない | AC-13 |

## 実装配置

- `src/components/OrbitApp.tsx`: Settings、SearchView、CyclesView のタブ、InboxView、ヘッダー / サイドバー（アバター・ワークスペース切替・NavItem）、IssuesView の一覧、コマンドパレット、各「×」ボタン、title の effect、スキップリンク
- `src/components/orbit-date-picker.tsx`: focusout で閉じる
- `src/styles.css`: 入力欄の枠線、OrbitSelect の active、カレンダーの選択日、`scroll-padding-bottom`、`.text-button`、`.skip-link`
- テスト: `src/components/a11y-contrast.test.ts` に追記、新規 `src/components/a11y-remaining-runtime.test.ts`

## UI/UX 方針

- **画面フロー / 導線**: 変更なし。
- **主要操作とフィードバック**: Cycle タブは矢印キーで切り替わる（選択と同時に表示も切り替わる自動切替）。
- **状態設計**: 検索の status は、検索中は「検索しています…」、完了後は「N件のIssue」を出す。
- **既存デザインシステムとの整合**: 見た目の変更は入力欄の枠線（少し濃くなる）、OrbitSelect の active 表示、カレンダーの選択日、スキップリンク（フォーカス時だけ表示）に限る。

### レスポンシブ / アクセシビリティ（表示層は必須・空通過禁止）

- 対象端末: PC（1280px 以上）とスマホ（320〜767px）。
- スマホ: `scroll-padding-bottom` を 767px 以下だけに設定する。タップ領域の 44px は既存のまま。
- a11y: AC-1〜AC-13 のとおり。

## 異常系挙動

| シナリオ | 本レイヤーの挙動 |
|---|---|
| 検索 API の失敗 | 既存のエラー表示のまま |
| 選択中の Issue の詳細が未取得 | title は一覧と同じ「Issues — Orbit」 |
| カレンダーからフォーカスが移動先なしで外れる（ウィンドウのフォーカス喪失・フォーカスできない場所のクリック） | `relatedTarget` が null のときは focusout では閉じず、既存の外側ポインタ操作と Esc で閉じる（ウィンドウ切替で開いたカレンダーが消えないようにするため） |

## テストケース（技法注記付き）

### AC-1
- [代表値] Settings の 4 つの select それぞれが `aria-labelledby` を持ち、参照先の文字列が「Theme」「Color theme」「Timezone」「Language」で、select の aria-label が見出しの文字列で始まるか、aria-label が無い

### AC-2
- [状態遷移] 検索中は `role="status"` の中に「検索しています…」
- [状態遷移] 結果が返ると `role="status"` の中に「N件のIssue」
- [代表値] 検索前から `role="status"` 要素が DOM にある

### AC-3
- [代表値] `role="tablist"` の中に `role="tab"` が並び、選択中だけ `aria-selected="true"` と `tabIndex=0`
- [状態遷移] 選択中のタブで ArrowRight → 次のタブが選択・フォーカス。最後で ArrowRight → 最初へ
- [状態遷移] ArrowLeft・Home・End の移動

### AC-4
- [代表値] Inbox の切替に `role="tab"` が無く、選択中のボタンだけ `aria-pressed="true"`

### AC-5〜AC-7（CSS 単体）
- [境界値] `--orbit-input-border` がライトで `#fff`・`#f7f8fa` に対して 3:1 以上、ダークで `#19202b` に対して 3:1 以上
- [代表値] `.text-input`・`.filter-select`・`.orbit-select-trigger` の枠線が `--orbit-input-border` を参照する
- [境界値] `.orbit-select-option.active` の枠線または背景が白に対して 3:1 以上
- [代表値] `.orbit-calendar-grid button[aria-pressed="true"]` の背景が `--orbit-accent-solid`

### AC-8
- [代表値] 767px 以下のメディアクエリで `scroll-padding-bottom` が設定されている
- [状態遷移] カレンダーを開き、フォーカスをカレンダー外の要素へ移す → カレンダーが閉じる
- [状態遷移] カレンダー内でフォーカスが移動しても閉じない

### AC-9
- [代表値] Issue の絞り込み入力・検索ページの入力・コマンドパレットの入力と listbox にアクセシブルな名前（aria-label または aria-labelledby）がある

### AC-10
- [代表値] 「×」だけのテキストを持つ button すべてに aria-label がある（Composer・Modal・その他表示中のもの）
- [同値分割] 未読 0 件 → 名前「通知」。未読 3 件 → 「通知（未読3件）」
- [代表値] Cycle List の行に `.priority-dot` が無く、`PriorityIcon`（role="img" と aria-label）がある

### AC-11
- [同値分割] 各画面（Home / Issues / Settings など）で `document.title` が「<画面名> — Orbit」
- [代表値] Issue 詳細を開くと「<識別子> <タイトル> — Orbit」

### AC-12
- [代表値] ヘッダーとサイドバーの「OU」とワークスペース切替が button ではない
- [代表値] NavItem のアイコン記号の要素が `aria-hidden="true"`

### AC-13
- [代表値] List 表示で `role="table"` の中に `role="row"`、ヘッダーに `role="columnheader"`、行のセルに `role="cell"`
- [代表値] 最初の Tab 可能な要素が `a.skip-link[href="#main-content"]`、`main#main-content` がある
- [境界値] デスクトップ（768px 以上のメディアクエリ）の `.text-button` の `min-height` が 24px 以上
- [代表値] モバイルの `.text-button` の 44px が、後ろにあるメディアクエリ外のルールで上書きされない
