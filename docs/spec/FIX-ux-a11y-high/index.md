# FIX-ux-a11y-high: UX High と WCAG 2.2 AA High の一括修正

## 概要

2026-10-06 の main 監査（UI/UX・WCAG 2.2 AA）で High 判定になった UX 7 件と a11y 7 件を、ui レイヤーの範囲で修正する。
主な目的は、取り消せない操作の確認、抜けられない画面の解消、ライトテーマのコントラストとフォーカス表示の AA 適合。

## 対象範囲

- 対象レイヤー: ui のみ → [ui.md](./ui.md)
- 対象ドメイン: Background Run 表示、Cycle 画面、Issue 一括更新、トースト、Composer / Issue 詳細の Cycle 割当、Settings（言語・ショートカット）、全体 CSS（色・フォーカス・並び替えボタン）
- 対象外（やらないこと）:
  - API・共有 Zod 契約・D1・ルーティングの変更（Tier 1 要素に触れない）
  - 一括 Label の「追加 / 削除」モード（bulk API の契約変更が必要。別チケット）
  - ショートカット設定の端末間同期（Preferences 契約の変更が必要。別チケット）
  - 英語 UI の翻訳（i18n）
  - 監査の Medium / Low 項目（トーストの複数スタック、削除系の確認統一など）
  - ダークテーマの配色の見直し（監査でおおむね合格）

## ユニット計画

単一ユニット。

## 受け入れ基準（AC）

- [ ] **AC-1**: Background Run が paused / failed のとき、画面全体を覆うオーバーレイではなく閉じられる非ブロッキングのバナーを表示し、失敗理由（`error.message`）と失敗した step 名、「同じRunを再開」「閉じる」を出す。「閉じる」で非表示になり、同じ run_id で status が変わらない限り再表示しない。pending / running は従来どおりブロッキングのダイアログのまま。
- [ ] **AC-2**: 「Cycleを完了」「Cycleを開始」「次のCycleを開始」は確認ダイアログを経てから実行する。完了の確認には繰越対象（未完了 Issue）の件数を、開始の確認には対象 Cycle の期間を表示する。キャンセル・Esc では API を呼ばない。
- [ ] **AC-3**: 一括更新で Label を選ぶと、置き換えであることを UI に明示し、適用前に対象件数つきの確認ダイアログを出す。確定したときだけ bulk API を呼び、キャンセルでは呼ばない。Label 以外の一括更新は従来どおり確認なしで実行する。
- [ ] **AC-4**: アクション（元に戻す・再試行など）付きのトーストとエラーのトーストは自動で消えず、「閉じる」ボタンで閉じられる。アクションなしの成功トーストは従来どおり 3.5 秒で消える。通知用のライブリージョン（`role="status"` と `role="alert"`）は常に DOM にあり、成功は status、エラーは alert に表示する。
- [ ] **AC-5**: Cycle 画面の Issue（List 行・Board カード・繰越一覧の行）をクリックまたは Enter で選ぶと、その Issue の詳細が開く。行の中の「Cycleから外す」などの操作では詳細を開かない。
- [ ] **AC-6**: Composer と Issue 詳細に Cycle の選択欄がある。Composer の初期値は Active Cycle（無ければ「なし」）で、選択した Cycle で作成する。詳細で変更すると `cycleId` を PATCH する。選択肢は「なし」・Active・Upcoming の Cycle で、Completed の Cycle は現在値のときだけ表示する。
- [ ] **AC-7**: Settings の言語で English は「English（準備中）」として選択できない。保存済みの locale に関わらず `document.documentElement.lang` は `ja` になる。
- [ ] **AC-8**: ライトテーマの補助テキスト色（ミュート色・placeholder を含む）は、白 `#ffffff`・`#fbfcfd`・`#f7f8fa` の背景に対してコントラスト比 4.5:1 以上になる。
- [ ] **AC-9**: 5 つのカラーテーマすべてで、アクセント地の白文字（`.button.primary`・`.brand-mark`・`.mobile-create`）は 4.5:1 以上、アクセント色の文字（アクティブなナビ項目・`.text-button`）はその背景に対して 4.5:1 以上になる。
- [ ] **AC-10**: キーボードのフォーカス表示は不透明な色で、ライトテーマでは `#ffffff`・`#f7f8fa`、ダークテーマでは `#19202b` に対して 3:1 以上になる。`outline: 0` にしている入力欄（`.inline-search input`・`.search-hero input`・`.command-input input`）と `.orbit-calendar-trigger` にも、3:1 以上の代わりのフォーカス表示がある。
- [ ] **AC-11**: Settings に「1文字ショートカット」の ON/OFF があり（初期値 ON）、この端末の localStorage に保存する。OFF のとき `c` / `f` / `x` / `?` は発火せず、修飾キー付きのショートカット（Cmd/Ctrl+K など）は動く。ON でも、フォーカスが `SELECT`・`[role="combobox"]`・`[role="listbox"]` にあるときは 1 文字ショートカットを発火しない。localStorage が使えないときは ON として動く。
- [ ] **AC-12**: Issue 行と Cycle の Issue 行の「上へ / 下へ」ボタンがすべての画面幅で表示され、ドラッグなしで並び替えられる。デスクトップでのボタンのターゲットは 24×24px 以上。

## アーキテクチャ / レイヤー間フロー

ui レイヤーで完結する。API 呼び出しは既存のものだけを使う（`POST /api/v1/cycles/:id/start`・既存の Cycle 完了 API・`POST /api/v1/issues/bulk`・`POST /api/v1/issues`・`PATCH /api/v1/issues/:id`・Background Run の resume）。リクエストの形は変えない。

## エラー・ログ方針（横断サマリ）

| シナリオ | 表示層の挙動 |
|---|---|
| Run が failed / paused | 非ブロッキングのバナーに `error.message` と step 名、再開ボタンを表示（AC-1） |
| Cycle の完了・開始 API が失敗 | 従来どおりエラートースト（AC-4 により自動で消えず alert で通知） |
| 一括更新 API が失敗 | 従来どおり bulk のエラー表示 |
| Cycle 割当の PATCH が失敗 | 既存の楽観的更新のロールバックとエラートースト |
| localStorage が使えない | 1文字ショートカットは ON として動き、設定の保存失敗は無視する |

## テスト戦略

| AC | 単体 | レイヤー内結合（jsdom で OrbitApp を描画） |
|----|------|--------------|
| AC-1 | — | RunOverlay / バナーの描画と閉じる |
| AC-2 | — | Cycles 画面の確認ダイアログ |
| AC-3 | — | Issues の一括更新 |
| AC-4 | — | トーストのタイマーとライブリージョン |
| AC-5 | — | Cycles 画面から詳細を開く |
| AC-6 | — | Composer と詳細の Cycle 欄 |
| AC-7 | — | Settings と lang |
| AC-8 | styles.css のコントラスト計算 | — |
| AC-9 | styles.css のコントラスト計算 | — |
| AC-10 | styles.css のコントラスト計算・ルール有無 | — |
| AC-11 | `shortcutActionFor` と設定の読み書き | グローバルの keydown |
| AC-12 | styles.css のルール | Issue 行のボタンで並び替え |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `Modal`（`OrbitApp.tsx` の汎用ダイアログ）と `useDialogBoundary`（フォーカスの閉じ込めと復元）、`OrbitSelect`、既存の `onUpdateIssue` / `onOpenIssue`、jsdom の結合テストのフィクスチャ（`review-ui.test-fixtures.ts`）。
- 差分: `RunOverlay` の非ブロッキング表示、`showToast` のタイマー条件、`shortcutActionFor` の判定、`styles.css` の色トークン。
- 衝突: `mobile-layout.test.ts` などの CSS 文字列を見ているテストが色や `display: none` に依存している場合は、意図を保ったまま更新する（削る場合は理由を progress.md に書く）。

## 実装に効く制約

- `src/shared/**`・`src/server/**`・`src/routes/**`・`drizzle/**` を変更しない（Tier 1 トリガー）。
- 新しい色は CSS 変数（トークン）にまとめ、直書きの色を増やさない。
- テーマの見本色（`theme.ts` の `accent`）は装飾なので変えない。

## 判断根拠 / 未決事項

- 一括 Label は「置き換えを明示する + 確認」を採用（Gate 1 でユーザーが選択）。追加 / 削除モードは bulk API の契約変更が必要で Tier 1 になるため見送り。
- ショートカットの ON/OFF は localStorage に保存（Gate 1 でユーザーが選択）。端末間同期には Preferences 契約の変更が必要なため見送り。localStorage は端末ごとの利便設定として扱う。
- English は「準備中」で選べなくする（Gate 1 でユーザーが選択）。保存済みの `en` は変更しない（サーバーの値を書き換えない）。lang は翻訳が入るまで `ja` に固定する（日本語の UI を英語として読み上げさせないため）。
- Run の paused / failed は、閲覧とナビゲーションを妨げないよう非ブロッキングにする（要件 ASYNC-02）。却下案: オーバーレイのまま「閉じる」だけ付ける（閉じるまでは画面全体が操作できないまま）。
- アクション付きトーストは自動で消さない。却下案: ホバー中だけ止める（キーボードやタッチの利用者に効かず、WCAG 2.2.1 を満たしにくい）。
- 確認ダイアログは既存の `Modal` を使う（`window.confirm` は見た目もフォーカス管理も揃わないため）。
- 未決事項: なし。
