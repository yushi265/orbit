# FIX-mobile-nav-filter-sheet: モバイルの下部タブ5つ化とIssueフィルターのBottom sheet

## 概要

モバイル（〜767px）で、下部タブが7つあるのにIssuesとViewsへ行けず、Issue一覧のフィルターがラベルの読めない小さな選択欄の列になっている（2026-10-03 画面監査）。要件定義（[03-ux-and-nfr.md](../../requirements/03-ux-and-nfr.md) 7.2、[05-acceptance-and-delivery.md](../../requirements/05-acceptance-and-delivery.md) の画面一覧）に合わせ、下部タブを5つ＋Menuシートにし、フィルターをBottom sheetへまとめる。

## 対象範囲

- 対象レイヤー: [ui](./ui.md)
- 下部タブ: Home / Inbox / Create / Search / Menu の5つ。MenuシートからIssues / Cycles / Projects / Views / Settingsへ移動する
- Issue一覧（IssuesとProject詳細の両方で使う共通ツールバー）のフィルター・並び順を、モバイルではBottom sheetで操作する
- 下部タブとサイドバーの現在地に`aria-current="page"`を付ける

## 対象外

- PC・タブレット（768px以上）の表示と操作
- フィルターの種類・URL契約（`src/lib/url-state/issues.ts`）・保存される表示設定の変更
- 検索入力のデバウンス、一覧の仮想化、コントラスト調整、ルート構成の変更
- フィルターの一括クリア、Swipeで閉じる操作

## ユニット計画

単一ユニット。

## 受け入れ基準（AC）

- [x] **AC-1**: モバイルの下部タブは Home / Inbox / Create / Search / Menu の5つを、この順で表示する。Inboxは未読件数のバッジを表示し、Createは`aria-label`「Issueを作成」を持ち、押すとIssue作成が開く。
- [x] **AC-2**: Menuタブを押すとMenuシートが開き、Issues / Cycles / Projects / Views / Settingsの5項目をこの順で表示する。項目を押すとその画面へ移動してシートが閉じる。
- [x] **AC-3**: Menuシートは`role="dialog"`・`aria-modal="true"`・名前「メニュー」を持ち、開いたとき最初の項目へフォーカスし、Escape・背景の押下・閉じるボタンで閉じて、フォーカスがMenuタブへ戻る。IME変換中のEscapeでは閉じない。開いたまま768px以上の幅になった場合は自動で閉じる。
- [x] **AC-4**: 現在の画面に対応する下部タブとサイドバー項目は`aria-current="page"`を持つ。現在の画面がIssues / Cycles / Projects / Views / Settingsのときは、Menuタブを選択中として表示し、Menuシート内の該当項目が`aria-current="page"`を持つ。
- [x] **AC-5**: Issue一覧のツールバーは「フィルター」ボタンを持ち、モバイルでは検索入力・フィルターボタン・List / Board切替だけを常時表示する。フィルターボタンは適用中の条件数（Status・Priority・Project・Label・期限が「すべて」以外、表示範囲がArchived、の合計）をバッジで表示し、0件のときバッジを表示しない。
- [x] **AC-6**: フィルターボタンを押すとフィルターシートが開き、Status・Priority・Project・表示範囲・Label・並び順・期限・完了Issueを表示、の各欄を見えるラベルつきで表示する（ProjectとIssueの表示範囲は、既存の表示条件を満たす画面でだけ表示する）。値を変えると既存と同じ処理で即時に反映され、シートは開いたままになる。
- [x] **AC-7**: フィルターシートは`role="dialog"`・`aria-modal="true"`・名前「フィルター」を持ち、Escape・背景の押下・常に見える位置にある「完了」ボタンで閉じて、フォーカスがフィルターボタンへ戻る。開いたときは最初の欄へフォーカスする。IME変換中のEscapeでは閉じない。開いたまま768px以上の幅になった場合は自動で閉じる。
- [x] **AC-8**: 768px以上では、フィルター・並び順の各欄は従来どおりツールバーに並び、フィルターボタンと各欄の見えるラベルを表示しない。各欄の`id`・`aria-label`・値の変更処理は変わらない。

## アーキテクチャ / レイヤー間フロー

表示層のみ。フィルター欄は1組だけ描画し、同じ要素を「PCではツールバーに並べる／モバイルではシートとして表示する」をCSS（〜767px）と開閉状態で切り替える（欄を二重に描画しない）。画面遷移は既存の`navigate(section)`、フィルターの反映は既存のsetter（URL更新）を使う。

## エラー・ログ方針（横断サマリ）

| シナリオ | ui |
|---|---|
| 表示設定の保存中（`displaySettingsBusy`） | 各欄は既存どおり`disabled`。シートは開閉できる |
| フィルターの反映失敗 | 既存のエラー表示のまま（変更しない） |

新しいAPI呼び出し・ログは無い。

## テスト戦略

| AC | 単体 | レイヤー内結合（jsdom描画） |
|---|---|---|
| AC-1 | — | 下部タブの項目・順序・バッジ・Create |
| AC-2 | — | Menuシートの項目・遷移・閉じる |
| AC-3 | — | dialog属性・フォーカス・閉じ方3種・IME |
| AC-4 | 選択中判定 | `aria-current`（タブ・サイドバー・シート内） |
| AC-5 | 条件数の算出 | ボタンとバッジ |
| AC-6 | — | シート内の欄・即時反映・開いたまま |
| AC-7 | — | dialog属性・閉じ方3種・IME・幅拡大で閉じる |
| AC-8 | — | CSSの〜767px規則とPC表示の既存テスト |

テストケースの詳細は [ui.md](./ui.md)。

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `NavItem`・`sectionLabels`・`sectionIcons`、`navigate`、`useDialogBoundary`（フォーカス閉じ込め・背景inert・スクロール固定・IME対応Escape・フォーカス復帰）、既存のシート用CSS（Issue作成のモバイル下端シート）、フィルターの各setter、`isImeComposing`。
- 差分: `MobileNav`の項目、`.mobile-nav`の列数（7→5）、ツールバーのフィルター欄を包む要素とフィルターボタン。
- 衝突と解消: `src/components/mobile-layout.test.ts`の「exposes Cycles in the mobile navigation」は`item="cycles"`と7列を固定している。CyclesはMenuシートから到達できる形へ変わるため、同テストを「MenuシートにCyclesがある・5列」へ更新する（到達性の担保は維持）。
- [FIX-mobile-workspace-ux](../FIX-mobile-workspace-ux/index.md)はタブ数・フィルターの形を定めておらず、衝突しない。

## 実装に効く制約

- PR #7（IMEガード）と同じ`OrbitApp.tsx`を触る。`src/components/ime.ts`は本ブランチ（main起点）に無いため、Escapeの処理は`useDialogBoundary`（IME対応済み）へ任せ、新しいキーハンドラーを足さない。

## 判断根拠 / 未決事項

- タブ構成とBottom sheetは要件定義どおり（Gate 1・2026-10-03で選択）。
- フィルター欄を1組だけ描画する理由: 二重に描画すると`id`の重複、既存のフォーカス用ref、既存テストのセレクタが壊れる。CSSと開閉状態で見せ方だけ変える。
- 条件数に並び順と「完了Issueを表示」を含めない理由: 絞り込みではなく表示の設定のため。
- 「完了」ボタンは閉じるだけ（値は即時反映）。適用ボタン方式は既存の即時反映と挙動が分かれるため採らない。
- 受け入れるトレードオフ: IssuesとCyclesへは2タップになる（Homeからは1タップの導線が既にある）。
- 受け入れるトレードオフ: 〜767pxでは並び順の欄が閉じたシートの中にあるため、表示設定へフォーカスする既存のキーボードショートカットは、シートを開いていない間は何も起きない（主対象のスマートフォンは物理キーボードを前提にしない）。
- 確認方法: jsdomのテストに加え、375x812のブラウザ（ライト / ダーク）で、タブ5つ・Menuシート・フィルターシート（背景の押下・Escape・完了・フォーカス復帰・完了ボタンが常に見えること）と、PC幅でツールバーの並びが変わらないことを確認した。iOS実機・Safariでは未確認。
- 未決事項なし。
