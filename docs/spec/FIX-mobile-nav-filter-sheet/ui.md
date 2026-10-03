# FIX-mobile-nav-filter-sheet: ui 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: モバイルの下部タブは Home / Inbox / Create / Search / Menu の5つを、この順で表示する。Inboxは未読件数のバッジを表示し、Createは`aria-label`「Issueを作成」を持ち、押すとIssue作成が開く。
- **AC-2**: Menuタブを押すとMenuシートが開き、Issues / Cycles / Projects / Views / Settingsの5項目をこの順で表示する。項目を押すとその画面へ移動してシートが閉じる。
- **AC-3**: Menuシートは`role="dialog"`・`aria-modal="true"`・名前「メニュー」を持ち、開いたとき最初の項目へフォーカスし、Escape・背景の押下・閉じるボタンで閉じて、フォーカスがMenuタブへ戻る。IME変換中のEscapeでは閉じない。開いたまま768px以上の幅になった場合は自動で閉じる。
- **AC-4**: 現在の画面に対応する下部タブとサイドバー項目は`aria-current="page"`を持つ。現在の画面がIssues / Cycles / Projects / Views / Settingsのときは、Menuタブを選択中として表示し、Menuシート内の該当項目が`aria-current="page"`を持つ。
- **AC-5**: Issue一覧のツールバーは「フィルター」ボタンを持ち、モバイルでは検索入力・フィルターボタン・List / Board切替だけを常時表示する。フィルターボタンは適用中の条件数（Status・Priority・Project・Label・期限が「すべて」以外、表示範囲がArchived、の合計）をバッジで表示し、0件のときバッジを表示しない。
- **AC-6**: フィルターボタンを押すとフィルターシートが開き、Status・Priority・Project・表示範囲・Label・並び順・期限・完了Issueを表示、の各欄を見えるラベルつきで表示する（ProjectとIssueの表示範囲は、既存の表示条件を満たす画面でだけ表示する）。値を変えると既存と同じ処理で即時に反映され、シートは開いたままになる。
- **AC-7**: フィルターシートは`role="dialog"`・`aria-modal="true"`・名前「フィルター」を持ち、Escape・背景の押下・常に見える位置にある「完了」ボタンで閉じて、フォーカスがフィルターボタンへ戻る。開いたときは最初の欄へフォーカスする。IME変換中のEscapeでは閉じない。開いたまま768px以上の幅になった場合は自動で閉じる。
- **AC-8**: 768px以上では、フィルター・並び順の各欄は従来どおりツールバーに並び、フィルターボタンと各欄の見えるラベルを表示しない。各欄の`id`・`aria-label`・値の変更処理は変わらない。

## このレイヤーが公開する契約（外部インターフェース）

画面パス・API・URL状態の変更は無い。

| 操作 | 名前 | 具体値 |
|---|---|---|
| 変更 | `MobileNav`（`src/components/OrbitApp.tsx`） | 子は順に `NavItem home` / `NavItem inbox`（badge=未読）/ `button.mobile-create`（`aria-label="Issueを作成"`）/ `NavItem search` / Menuタブ `button.nav-item.mobile-menu-tab`（表示名「Menu」、`aria-haspopup="dialog"`、`aria-expanded`）。Menuタブは現在の画面が `issues` `cycles` `projects` `views` `settings` のいずれかのとき `active` クラスを持つ（`aria-current`は付けない） |
| 追加 | `MobileMenuSheet`（同ファイル） | `div.modal-backdrop.mobile-menu-backdrop` 内に `div.mobile-menu-sheet`（`role="dialog"` `aria-modal="true"` `aria-label="メニュー"`）。中に閉じるボタン（`aria-label="メニューを閉じる"`）と、`issues` `cycles` `projects` `views` `settings` の順の `NavItem`。`useDialogBoundary(ref, { initialFocus: 最初の項目, onEscape: onClose })`。背景（backdrop自身）の押下で`onClose`。項目の押下は `onNavigate(section)` の後に `onClose` |
| 変更 | `NavItem` | `active` のとき `aria-current="page"` を付ける（サイドバー・下部タブ・Menuシートで共通） |
| 追加 | `countActiveIssueFilters`（`src/components/issue-list.ts`） | 入力 `{ status, priority, project, label, due, scope }`（各値は既存のフィルター値。`project`と`scope`は省略可）。`status` `priority` `project` `label` `due` が `"all"` 以外で各+1、`scope === "archived"` で+1。戻り値は0以上の整数 |
| 変更 | Issue一覧ツールバー（`IssuesView`） | 検索入力の直後に `button.filter-sheet-button`（表示名「フィルター」、`aria-haspopup="dialog"`、`aria-expanded`、条件数>0のとき `span.filter-count` に数値）。Status〜完了Issue表示の各欄を `div.filter-fields` で包み、各欄を `label.filter-field` ＋ `span.filter-field-label`（見えるラベル文言: Status / Priority / Project / 表示範囲 / Label / 並び順 / 期限）で包む。開いているとき `div.filter-fields` は `open` クラス・`role="dialog"`・`aria-modal="true"`・`aria-label="フィルター"` を持ち、先頭に見出し「フィルター」、末尾に `button.filter-sheet-done`（表示名「完了」）を表示する。閉じているときはこれらの属性・見出し・完了ボタンを持たない。背景は、`div.filter-fields` を包む常設の `div.filter-fields-wrap` が開いているときだけ `filter-sheet-backdrop` クラスを持つ形で表す（押下で閉じる。`useDialogBoundary`がダイアログの兄弟要素を`inert`にするため、背景は祖先に置く）。閉じているときの `div.filter-fields-wrap` は `display: contents`。`useDialogBoundary(ref, { enabled: open, initialFocus: "select", onEscape: close })`。閉じたときはフィルターボタンへ明示的にフォーカスを戻す |
| 変更 | シートの自動クローズ | フィルターシート・Menuシートとも、`window.matchMedia("(min-width: 768px)")` の `change` で一致したら閉じる |
| 変更 | `src/styles.css` | `.mobile-nav` は `grid-template-columns: repeat(5, 1fr)`、項目の文字は11px以上。`.filter-sheet-button`・`.filter-field-label`・見出し・完了ボタンは既定で非表示、`@media (max-width: 767px)` で表示。同メディア内で `.filter-fields` は既定非表示、`.filter-fields.open` を画面下端の固定シート（最大高さ80dvh・縦スクロール・`env(safe-area-inset-bottom)`の下余白・各欄は幅100%・高さ44px以上・文字16px）として表示する。768px以上の `.filter-fields` は `display: contents`、`.filter-field` も `display: contents` として従来の並びを保つ。`.filter-sheet-done` はシート下端に`position: sticky`で固定し、スクロール位置に関係なく見える。Menuシートは下端固定・項目の高さ48px以上・下余白に`env(safe-area-inset-bottom)`を含み、5項目は非選択時に同じ文字色、選択時に同じ選択色とする（ライト・ダークとも）。ダークテーマでは既存のCSS変数（`--orbit-surface-raised`等）を使う。`prefers-reduced-motion`では開閉アニメーションをしない |

- 各欄の既存の `id`（`issues-status-filter` 等）・`aria-label`・`ref`（`displayInputRef`）・`disabled`条件・`onChange` は変えない。
- 新しいキーハンドラーは足さない（Escapeは`useDialogBoundary`が処理する）。

## 実装配置

- `src/components/OrbitApp.tsx`: `MobileNav`、`MobileMenuSheet`、`NavItem`、`IssuesView`のツールバー
- `src/components/issue-list.ts`: `countActiveIssueFilters`
- `src/styles.css`
- テスト: `src/components/mobile-nav-filter-runtime.test.ts`（新規）、`src/components/issue-list.test.ts`（条件数）、`src/components/mobile-layout.test.ts`（既存の7列・`item="cycles"`の固定を、5列・MenuシートにCyclesへ更新）

## UI/UX 方針

- 画面フロー: 下部タブ → Menu → シート → 項目 → 画面遷移。Issue一覧 → フィルター → シート → 値を変更（即時反映）→ 完了。
- 状態設計:
  - 初期: シートは閉じている。フィルターボタンは条件数0でバッジなし。
  - 適用中: バッジに条件数。一覧は即時に絞り込まれる。
  - 処理中: `displaySettingsBusy`の間、欄は`disabled`（既存）。
  - 空: 既存の空表示のまま。
  - エラー: 既存のエラー表示のまま。
- 既存デザインとの整合: Issue作成のモバイル下端シートと同じ角丸・影・背景のぼかしを使う。色は既存のCSS変数。

## レスポンシブ / アクセシビリティ

- 対象端末: スマートフォン。主対象ブレークポイントは〜767px（既存のモバイル区分）。
- タブレット・PC（768px以上）: 表示・操作とも従来どおり。下部タブ自体が非表示。
- スマホ方針: 下部タブ5つ、タップ領域44px以上、シート内の入力は16px（iOSのフォーカス時ズーム回避）。Safe Areaの下余白を取る。
- a11y: シートは`role="dialog"`・`aria-modal`・名前つき、フォーカス閉じ込めと復帰、Escapeで閉じる。現在地は`aria-current="page"`。Create・閉じるボタンは`aria-label`つき。バッジの数値はボタンの名前に含まれる。

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| IME変換中のEscape | シートを閉じない |
| シートを開いたまま768px以上へ | フィルターシートは自動で閉じ、欄はツールバーに並ぶ |
| `displaySettingsBusy` | 欄は`disabled`。シートの開閉とフォーカスは維持 |
| Menuシートから現在と同じ画面を選ぶ | 既存の`navigate`の挙動のまま、シートは閉じる |
| Issue作成・Issue詳細などほかのダイアログが開いている | 下部タブの上に重なる既存の表示順のまま（シートは同時に開かない） |

## テストケース（技法注記付き）

- [代表値] 下部タブは5項目で、順序が Home / Inbox / Create / Search / Menu。
- [同値分割] Inboxのバッジ: 未読0件は表示なし／1件以上は件数を表示。
- [代表値] Createは`aria-label`「Issueを作成」を持ち、押すとIssue作成ダイアログが開く。
- [代表値] Menuタブを押すとMenuシートが開き、項目が Issues / Cycles / Projects / Views / Settings の順。
- [同値分割] Menuシートの各項目（5件）を押すと、その画面へ移動してシートが閉じる。
- [状態遷移] Menuシート: 閉→開（最初の項目へフォーカス、`aria-expanded="true"`）→ Escapeで閉（Menuタブへフォーカス）／背景の押下で閉／閉じるボタンで閉。
- [同値分割] Menuシート: IME変換中（`isComposing:true` / `keyCode:229`）のEscapeでは閉じない。
- [デシジョンテーブル] `aria-current`と選択中表示: 現在の画面（home / inbox / search / issues / cycles / projects / views / settings）ごとに、下部タブの`aria-current`、Menuタブの`active`、Menuシート内の`aria-current`、サイドバーの`aria-current`が期待どおり。
- [デシジョンテーブル] `countActiveIssueFilters`: すべて`all`は0／status・priority・project・label・dueを1つずつ変えると各1／scopeが`archived`で1／`active`と省略は0／全部指定で6。
- [同値分割] フィルターボタン: 条件数0はバッジなし／1以上は数値を表示。
- [状態遷移] フィルターシート: 閉（`role`なし・完了ボタンなし）→ 開（`role="dialog"`・`aria-modal`・名前「フィルター」・見えるラベル7種・完了ボタン）→ Escapeで閉（フィルターボタンへフォーカス）／背景の押下で閉／完了ボタンで閉。
- [代表値] フィルターシートでStatusを変えると、既存と同じURL更新が呼ばれ、シートは開いたまま、バッジが1になる。
- [同値分割] ProjectとIssueの表示範囲の欄は、既存の表示条件を満たさない画面ではシートにも出ない。
- [同値分割] フィルターシート: IME変換中のEscapeでは閉じない。
- [同値分割] フィルターシート・Menuシートとも、開いた状態で`matchMedia("(min-width: 768px)")`が一致へ変わると閉じる。
- [代表値] フィルターシートを開くと最初の欄（Status）へフォーカスする。
- [代表値] CSS: `.filter-sheet-done`が`position: sticky`。Menuシートの下余白が`env(safe-area-inset-bottom)`を含む。Menuシート内の項目の文字色指定がある。
- [代表値] 各欄の`id`と`aria-label`が変更前と同じ（Statusで絞り込む 等）。
- [代表値] CSS: `.mobile-nav`が5列。`.filter-sheet-button`と`.filter-field-label`は既定非表示で、`@media (max-width: 767px)`内で表示される。768px以上の`.filter-fields`は`display: contents`。
