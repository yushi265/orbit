# FIX-ux-a11y-high: ui 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: Background Run が paused / failed のとき、画面全体を覆うオーバーレイではなく閉じられる非ブロッキングのバナーを表示し、失敗理由（`error.message`）と失敗した step 名、「同じRunを再開」「閉じる」を出す。「閉じる」で非表示になり、同じ run_id で status が変わらない限り再表示しない。pending / running は従来どおりブロッキングのダイアログのまま。
- **AC-2**: 「Cycleを完了」「Cycleを開始」「次のCycleを開始」は確認ダイアログを経てから実行する。完了の確認には繰越対象（未完了 Issue）の件数を、開始の確認には対象 Cycle の期間を表示する。キャンセル・Esc では API を呼ばない。
- **AC-3**: 一括更新で Label を選ぶと、置き換えであることを UI に明示し、適用前に対象件数つきの確認ダイアログを出す。確定したときだけ bulk API を呼び、キャンセルでは呼ばない。Label 以外の一括更新は従来どおり確認なしで実行する。
- **AC-4**: アクション（元に戻す・再試行など）付きのトーストとエラーのトーストは自動で消えず、「閉じる」ボタンで閉じられる。アクションなしの成功トーストは従来どおり 3.5 秒で消える。通知用のライブリージョン（`role="status"` と `role="alert"`）は常に DOM にあり、成功は status、エラーは alert に表示する。
- **AC-5**: Cycle 画面の Issue（List 行・Board カード・繰越一覧の行）をクリックまたは Enter で選ぶと、その Issue の詳細が開く。行の中の「Cycleから外す」などの操作では詳細を開かない。
- **AC-6**: Composer と Issue 詳細に Cycle の選択欄がある。Composer の初期値は Active Cycle（無ければ「なし」）で、選択した Cycle で作成する。詳細で変更すると `cycleId` を PATCH する。選択肢は「なし」・Active・Upcoming の Cycle で、Completed の Cycle は現在値のときだけ表示する。
- **AC-7**: Settings の言語で English は「English（準備中）」として選択できない。保存済みの locale に関わらず `document.documentElement.lang` は `ja` になる。
- **AC-8**: ライトテーマの補助テキスト色（ミュート色・placeholder を含む）は、白 `#ffffff`・`#fbfcfd`・`#f7f8fa` の背景に対してコントラスト比 4.5:1 以上になる。
- **AC-9**: 5 つのカラーテーマすべてで、アクセント地の白文字（`.button.primary`・`.brand-mark`・`.mobile-create`）は 4.5:1 以上、アクセント色の文字（アクティブなナビ項目・`.text-button`）はその背景に対して 4.5:1 以上になる。
- **AC-10**: キーボードのフォーカス表示は不透明な色で、ライトテーマでは `#ffffff`・`#f7f8fa`、ダークテーマでは `#19202b` に対して 3:1 以上になる。`outline: 0` にしている入力欄（`.inline-search input`・`.search-hero input`・`.command-input input`）と `.orbit-calendar-trigger` にも、3:1 以上の代わりのフォーカス表示がある。
- **AC-11**: Settings に「1文字ショートカット」の ON/OFF があり（初期値 ON）、この端末の localStorage に保存する。OFF のとき `c` / `f` / `x` / `?` は発火せず、修飾キー付きのショートカット（Cmd/Ctrl+K など）は動く。ON でも、フォーカスが `SELECT`・`[role="combobox"]`・`[role="listbox"]` にあるときは 1 文字ショートカットを発火しない。localStorage が使えないときは ON として動く。
- **AC-12**: Issue 行と Cycle の Issue 行の「上へ / 下へ」ボタンがすべての画面幅で表示され、ドラッグなしで並び替えられる。デスクトップでのボタンのターゲットは 24×24px 以上。

## このレイヤーが公開する契約（外部インターフェース）

画面パス・ルーティングの増減はない。新しく導入する ui 内部の契約は次のとおり。

| 操作 | 名前 / パス | 入出力・型・制約 | 用途 |
|------|------------|-----------------|------|
| 追加 | localStorage キー `orbit.singleKeyShortcuts` | 値 `"off"` のときだけ OFF。キーが無い・他の値・読み取り例外は ON | AC-11 |
| 追加 | CSS 変数 `--orbit-muted` | ライトテーマのミュート文字色。`#fff`・`#fbfcfd`・`#f7f8fa` に対して 4.5:1 以上 | AC-8 |
| 追加 | CSS 変数 `--orbit-accent-solid`（5 テーマそれぞれ） | 白文字に対して 4.5:1 以上のアクセント地。アクセント色の文字にも使う | AC-9 |
| 追加 | CSS 変数 `--orbit-focus` | フォーカスリング色。ライト・ダークで別の値 | AC-10 |
| 変更 | `shortcutActionFor`（`issue-core-ui.ts`） | 入力に「1文字ショートカットが有効か」と「フォーカス先が選択系の部品か」を加える。両方の条件で 1 文字キーは `null` を返す | AC-11 |

既存の API リクエストの形は変えない（呼び出す API は index.md「アーキテクチャ」を参照）。

## 実装配置

- `src/components/OrbitApp.tsx`: `RunOverlay`、トースト、`CyclesWorkspace`（完了・開始ボタン、Issue 行、繰越一覧）、一括更新、Composer、Issue 詳細、Settings、グローバル keydown、`html lang` の effect
- `src/components/issue-core-ui.ts`: `shortcutActionFor`
- `src/styles.css`: 色トークン、フォーカス、`.touch-move-button`、新しいバナー・トーストの閉じるボタン
- テスト: `src/components/*.test.ts`（既存の jsdom 結合テストのパターンとフィクスチャ `review-ui.test-fixtures.ts` を使う）

## UI/UX 方針

- **Run バナー（AC-1）**: 画面下部に固定のカード（モバイルでは下部ナビの上）。見出しは「処理が一時停止しました」/「処理が失敗しました」。本文に `error.message`、step 名（`cycle_transition` →「Cycleの切り替え」、`purge` →「ゴミ箱の整理」、`outbox_retry` →「通知の再送」、それ以外はそのまま）。ボタンは「同じRunを再開」（primary）と「閉じる」。failed は `role="alert"`、paused は `role="status"`。フォーカスは奪わない。
- **確認ダイアログ（AC-2・AC-3）**: 既存の `Modal` を使う。ボタンは「キャンセル」と確定ボタン（「Cycleを完了」「Cycleを開始」「置き換える」など、動詞で書く）。初期フォーカスはキャンセル。Esc と背景クリックはキャンセル扱い。
  - Cycle 完了: 「未完了のIssue N件を次のCycleへ繰り越します。」（次の Cycle が無いときは「未完了のIssue N件はCycleから外れます。」ではなく、既存 API の挙動に合わせた文言にする。実装時に API の挙動を確認して決め、progress.md に記録する）
  - Cycle 開始: 「<Cycle名>（<期間>）を開始します。」
  - 一括 Label: 「選択中のN件のLabelを「X」に置き換えます。既存のLabelは外れます。」/ Labelなし のときは「選択中のN件からすべてのLabelを外します。」。一括更新の Label 欄のラベルは「Label（置き換え）」にする。
- **トースト（AC-4）**: 位置と見た目は既存のまま。アクション付き・エラーには「閉じる」ボタン（`aria-label="通知を閉じる"`、×アイコン）を付ける。新しいトーストが出たら前のトーストを置き換える（単一枠は維持）。
- **Cycle の Issue（AC-5）**: タイトル部分を `button`（`onOpenIssue`）にする。行全体のクリックは使わない（中の操作ボタンとの入れ子を避けるため）。ドラッグの開始は従来どおり行で扱う。
- **Cycle 欄（AC-6）**: Composer では Project 欄の隣に置き、選択肢の表示は「なし」「<名前>（Current）」「<名前>（Upcoming）」。詳細では Project の近くに既存の select と同じ見た目で置く。
- **Settings（AC-7・AC-11）**: 言語の English は disabled の option。ショートカットは既存の設定行のトグル（`role="switch"` か checkbox）で、説明に「c / f / x / ? を1キーで実行します」と書く。
- **状態設計**: Cycle の完了・開始の確認ダイアログは、確定中は両方のボタンを disabled にして二重送信を防ぎ、API が終わったら（失敗時も）閉じる。失敗は既存のエラートーストで出す。一括 Label の確認ダイアログは確定と同時に閉じ、進行中の表示（「適用中…」）とエラーは既存の一括更新バー（`role="alert"`）に任せる。
- **既存デザインシステムとの整合**: 新しい部品は作らず、`Modal`・`.button`・`.text-button`・既存の setting-row を使う。

### レスポンシブ / アクセシビリティ（表示層は必須・空通過禁止）

- 対象端末: PC（主対象 1280px 以上）とスマホ（320〜767px）。タブレットは既存のレスポンシブ規則に従う。
- スマホ: Run バナーは下部ナビと safe area の上に出す。確認ダイアログは既存の `Modal` のモバイル表示に従う。並び替えボタンは既存の 44px のまま。
- PC: 並び替えボタンは 24×24px 以上。
- a11y: AC-8〜AC-12 のとおり。確認ダイアログは `useDialogBoundary` でフォーカスを閉じ込め、閉じたら元のボタンへ戻す。新しいアイコンボタンには `aria-label` を付ける。

## 異常系挙動

| シナリオ | 本レイヤーの挙動 |
|---|---|
| Run の resume が失敗 | 既存のエラー処理（エラートースト）。バナーは残る |
| Run の `error` が null の paused / failed | 失敗理由の行を出さず、step 名と操作だけを出す |
| Cycle 完了・開始 API の失敗 | ダイアログを閉じ、エラートースト（自動で消えない） |
| 一括 Label の確定後に API が失敗 | ダイアログは確定時に閉じている。既存の一括更新バーのエラー表示と「再試行」（確認は再度出さない） |
| 一括 Label API の失敗 | 既存の bulk のエラー表示 |
| Cycle 割当 PATCH の失敗 | 既存の楽観的更新のロールバックとエラートースト |
| localStorage の読み書きで例外 | ON として扱う。書き込み失敗は画面上の状態だけ切り替える |

## テストケース（技法注記付き）

### AC-1 Run バナー
- [状態遷移] status=pending → ブロッキングのダイアログ（`role="dialog"`・`aria-modal`）を表示する
- [状態遷移] status=running → ブロッキングのダイアログを表示する
- [状態遷移] status=paused → `.run-overlay` の全画面要素が無く、バナー（`role="status"`）に step 名と「同じRunを再開」「閉じる」がある
- [状態遷移] status=failed で `error` あり → バナー（`role="alert"`）に `error.message` と step 名を表示する
- [代表値] failed で `error` が null → 失敗理由の行なしで表示する
- [状態遷移] 「閉じる」→ バナーが消える。同じ run_id・同じ status の更新では再表示しない。status が変わったら再表示する
- [代表値] 「同じRunを再開」→ `onResume` が呼ばれる

### AC-2 Cycle の確認
- [デシジョンテーブル] Active を選択して「Cycleを完了」→ ダイアログに未完了 Issue の件数。確定 → 完了 API を 1 回呼ぶ
- [デシジョンテーブル] Upcoming を選択して「Cycleを開始」→ ダイアログに期間。確定 → start API を 1 回呼ぶ
- [デシジョンテーブル] 「次のCycleを開始」→ ダイアログに次 Cycle の期間。確定 → start API を 1 回呼ぶ
- [デシジョンテーブル] 各ダイアログでキャンセル → API を呼ばない
- [デシジョンテーブル] 各ダイアログで Esc → API を呼ばない
- [境界値] 未完了 Issue が 0 件 → 「0件」と表示し、完了できる

### AC-3 一括 Label
- [デシジョンテーブル] field=Label・値=Label X → 「置き換え」の確認に件数と X。確定 → bulk API に `labelIds: [X]`
- [デシジョンテーブル] field=Label・値=Labelなし → 「すべてのLabelを外します」の確認。確定 → `labelIds: []`
- [デシジョンテーブル] field=Label でキャンセル → bulk API を呼ばない
- [デシジョンテーブル] field=Status など Label 以外 → 確認なしで bulk API を呼ぶ
- [代表値] 一括更新の Label 欄に「置き換え」の表記がある

### AC-4 トースト
- [デシジョンテーブル] 成功・アクションなし → 3.5 秒後に消える（fake timer）
- [デシジョンテーブル] 成功・アクションあり（元に戻す）→ 3.5 秒後も 10 秒後も残る。「閉じる」で消える
- [デシジョンテーブル] エラー → 自動で消えず、`role="alert"` の中に表示する
- [代表値] トーストが無いときも `role="status"` と `role="alert"` の要素が DOM にある
- [代表値] 成功のテキストは `role="status"` の中に表示する

### AC-5 Cycle の Issue を開く
- [代表値] Cycle List の Issue タイトルをクリック → その Issue の詳細が開く
- [代表値] Cycle Board のカードのタイトルをクリック → 詳細が開く
- [代表値] 繰越一覧の行のタイトルをクリック → 詳細が開く
- [代表値] タイトルのボタンにフォーカスして Enter → 詳細が開く
- [代表値] 「Cycleから外す」をクリック → 詳細は開かず、`cycleId: null` の更新だけが走る

### AC-6 Cycle 欄
- [代表値] Composer を開く → Cycle 欄の初期値が Active Cycle
- [境界値] Active Cycle が無い → 初期値が「なし」
- [代表値] Composer で Upcoming を選んで作成 → POST の `cycleId` がその Cycle
- [代表値] Composer で「なし」を選んで作成 → POST の `cycleId` が null
- [代表値] 詳細で Cycle を変更 → PATCH に `cycleId`
- [同値分割] 選択肢に Completed の Cycle が出ない。ただし Issue の現在値が Completed の Cycle のときはその 1 件だけ出る

### AC-7 言語
- [代表値] Settings の言語に「English（準備中）」が disabled で出る
- [同値分割] preferences.locale=`en` → `document.documentElement.lang` が `ja`
- [同値分割] preferences.locale=`ja` → `ja`

### AC-8〜AC-10 CSS（styles.css を読み込んでコントラストを計算する単体テスト）
- [境界値] `--orbit-muted` と placeholder の色が `#fff`・`#fbfcfd`・`#f7f8fa` に対して 4.5:1 以上
- [境界値] 監査で不合格だったセレクタ（`.nav-label`・`.eyebrow`・`.issue-id`・`.table-header`・`.issue-description`・`.project-cell`・`.due-cell`・`.subheading`・`.metric-foot`・`.nav-item`・`.cycle-tabs button`・`kbd`・`.setting-row div span`）の、ライトテーマで解決される文字色が 4.5:1 以上
- [境界値] 5 テーマの `--orbit-accent-solid` が白文字に対して 4.5:1 以上、テーマの `--orbit-accent-soft` 上の文字としても 4.5:1 以上
- [代表値] `.button.primary`・`.brand-mark`・`.mobile-create` の背景が `--orbit-accent-solid` を参照する
- [境界値] `--orbit-focus` がライトで `#fff`・`#f7f8fa` に対して 3:1 以上、ダークで `#19202b` に対して 3:1 以上
- [代表値] `:focus-visible` の outline が `--orbit-focus` を参照し、色に透明度が無い
- [代表値] `.inline-search`・`.search-hero`・`.command-input` に `:focus-within` のフォーカス表示があり、`.orbit-calendar-trigger:focus-visible` に outline がある

### AC-11 ショートカット
- [デシジョンテーブル] 有効=ON・フォーカス=body・キー c → 作成アクション
- [デシジョンテーブル] 有効=OFF・フォーカス=body・キー c / f / x / ? → `null`
- [デシジョンテーブル] 有効=OFF・Cmd/Ctrl+K など修飾キーあり → 従来のアクション
- [デシジョンテーブル] 有効=ON・フォーカス=SELECT / `[role="combobox"]` / `[role="listbox"]` → 1 文字キーは `null`
- [代表値] localStorage に `orbit.singleKeyShortcuts=off` → 読み込みで OFF
- [代表値] localStorage の getItem が例外 → ON
- [代表値] Settings のトグルを OFF → localStorage に `off` を保存し、グローバルの keydown で c を押しても Composer が開かない

### AC-12 並び替えボタン
- [代表値] styles.css でデスクトップ幅の `.touch-move-button` が `display: none` ではなく、24×24px 以上
- [代表値] Issue 行の「下へ」ボタン → 既存の reorder 処理が呼ばれる（既存の touch-reorder テストの範囲をデスクトップでも通す）
