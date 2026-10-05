# FEAT-project-manual-order: ui 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-8**: Projects一覧の各カードは「上へ」「下へ」ボタン（名前「{Project名}を上へ移動」/「{Project名}を下へ移動」）を持つ。押すと表示中の並びで1つ前／1つ後ろへ移動し、成功後に一覧が新しい順で表示される。先頭の「上へ」と末尾の「下へ」、および処理中の全ボタンは無効になる。
- **AC-9**: 並べ替えが失敗したときは、エラーのトーストを表示し、一覧の順番を変えない。ボタンは再び押せる状態に戻る。
- **AC-10**: ボタンの操作でProject詳細へ遷移しない。カード本体を押したときの遷移と、Project詳細・Home・IssueのProject選択欄・フィルターは、並び順以外は従来と変わらない。

## このレイヤーが公開する契約（外部インターフェース）

画面パスの変更は無い。

| 操作 | 名前 | 具体値 |
|---|---|---|
| 追加 | `beforeProjectIdForMove(ordered, projectId, direction)`（`src/components/project-workspace.ts`） | `ordered`は表示中のProject（`{ id: string }`の配列・表示順）。`direction`は`"up" | "down"`。戻り値は`{ beforeProjectId: string | null } | null`。上へ: 対象が先頭ならnull、そうでなければ1つ前のProjectのID。下へ: 対象が末尾ならnull、そうでなければ2つ後ろのProjectのID（無ければ`beforeProjectId: null`＝末尾）。対象が`ordered`に無ければnull |
| 変更 | `ProjectsView`（`src/components/OrbitApp.tsx`）のカード一覧 | 各カードを`div.project-card-item`（`data-project-id`）で包み、その中に既存の`Link.project-card`と、兄弟として`div.project-order-actions`を並べる（`Link`の中にボタンを入れない）。`div.project-order-actions`は`button.project-order-button`を2つ持つ: 「上へ」（表示「↑」、`aria-label="{name}を上へ移動"`）、「下へ」（表示「↓」、`aria-label="{name}を下へ移動"`）。どちらも`type="button"` |
| 変更 | ボタンの無効条件 | 先頭のカードの「上へ」、末尾のカードの「下へ」、および並べ替えの処理中（`projectReorderBusy`）と既存の保存中（`saving`）は`disabled` |
| 追加 | 並べ替えの実行（`OrbitApp`側のHandler。既存のProject作成と同じ場所・同じ形） | `apiPost("/api/v1/projects/reorder", { idempotencyKey: idempotencyKey(), projectId, beforeProjectId })` → 成功したら`await refresh()`（Bootstrap再取得）。失敗したら`showToast("error", ApiErrorのmessage、それ以外は「Projectの並べ替えに失敗しました」)`。処理中フラグ`projectReorderBusy`は成功・失敗どちらでも解除する。`ProjectsView`へは`onReorderProject(projectId, beforeProjectId): Promise<boolean>`（成功でtrue・失敗でfalse。失敗時のフォーカス復帰と、成功時の並び替え後のフォーカスを区別するため）と`projectReorderBusy`を渡す |
| 変更 | フォーカス | 押したボタンにフォーカスを残す。並べ替え後にそのボタンが無効になった場合（先頭・末尾へ着いた）は、同じカードのもう一方のボタンへフォーカスを移す。失敗時は、処理中の無効化で外れたフォーカスを押したボタンへ戻す |
| 変更 | `src/styles.css` | `.project-card-item`は`position: relative`でグリッドの子になる（既存の`.project-grid`の列定義は変えない）。`.project-order-actions`はカード右下に重ねて表示し、カードの内容と重ならない余白を確保する。`.project-order-button`は32px四方以上（〜767pxでは44px四方以上）、既存の小さなボタンの配色、`disabled`時は薄く表示。ダークテーマは既存のCSS変数を使う |

- 既存の`Link.project-card`の中身（アイコン・優先度・名前・説明・進捗）、`data-project-id`、選択中クラス、カード押下時の遷移は変えない（`data-project-id`は`Link`にも残す）。
- 楽観的な並べ替え（応答前に画面を入れ替える）は行わない。成功後の再取得で表示を更新する。

## 実装配置

- `src/components/project-workspace.ts`: `beforeProjectIdForMove`
- `src/components/OrbitApp.tsx`: 並べ替えのHandlerと状態、`ProjectsView`のカード一覧
- `src/styles.css`
- テスト: `src/components/project-workspace.test.ts`（移動先の算出）、`src/components/project-order-runtime.test.ts`（新規・jsdom描画）

## UI/UX 方針

- 画面フロー: Projects一覧 → カードの↑ / ↓を押す → 処理中は全ボタンが無効 → 成功すると一覧が新しい順になる。
- 状態設計:
  - 初期: 全カードにボタン。先頭の↑と末尾の↓は無効。Projectが1件なら両方無効。
  - 処理中: 全ボタンが無効。カードは押せる（遷移は既存どおり）。
  - 成功: 新しい順で表示。フォーカスは押したボタン（無効になったら同じカードのもう一方）。
  - 失敗: エラーのトースト。順番はそのまま。ボタンは元に戻る。
  - 空: 既存の「Projectはまだありません」のまま（ボタンなし）。
- 表示の絞り込み（`?active=true`など）で一部のProjectだけが表示されている場合も、表示中の並びで1つ動く。
- 既存デザインとの整合: SettingsのWorkflow並べ替え（↑ ↓）と同じ記号を使う。

## レスポンシブ / アクセシビリティ

- 対象端末: PC・タブレット・スマートフォン。主対象ブレークポイントは既存の〜767px。
- タブレット・PC: ボタンは32px四方以上。
- スマホ方針: ボタンは44px四方以上。カードの内容（進捗の行）と重ならない。
- a11y: ボタンは`button`でProject名を含む名前を持ち、キーボード（Tab・Enter・Space）で操作できる。カードの`Link`とボタンは入れ子にしない。無効なボタンは`disabled`属性で表す。並べ替え後のフォーカス位置を保つ。

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| APIが404 / 400 / 409 / 423 / 500 | エラーのトースト（APIのメッセージ）。順番はそのまま。処理中を解除 |
| 通信エラー | 「Projectの並べ替えに失敗しました」のトースト。同上 |
| 処理中の連打 | ボタンが無効のため、APIは1回だけ呼ばれる |
| Projectが1件 | 両方のボタンが無効 |
| 成功後のBootstrap再取得が失敗 | 既存の再取得失敗の扱いのまま（古い順の表示が残り、既存のエラー表示が出る） |

## テストケース（技法注記付き）

- [デシジョンテーブル] `beforeProjectIdForMove`（A,B,C,D）: Aを上へ → null／Bを上へ → `{ beforeProjectId: A }`／Dを上へ → `{ beforeProjectId: C }`／Aを下へ → `{ beforeProjectId: C }`／Cを下へ → `{ beforeProjectId: null }`／Dを下へ → null／一覧に無いID → null／1件だけの一覧で上へ・下へ → null。
- [代表値] 描画: Projectが3件のとき、各カードに名前つきのボタンが2つあり、先頭の「上へ」と末尾の「下へ」だけが`disabled`。ボタンは`Link`の子孫ではない。
- [境界値] 描画: Projectが1件のとき両方`disabled`。0件のときボタンが無く、既存の空表示が出る。
- [代表値] 描画: 2件目の「上へ」を押すと、`POST /api/v1/projects/reorder`が`{ projectId: 2件目, beforeProjectId: 1件目, idempotencyKey: 文字列 }`で1回呼ばれ、成功後にBootstrapが再取得され、カードの並びが新しい順になる。
- [代表値] 描画: 1件目の「下へ」を押すと、`beforeProjectId`が3件目で呼ばれる。2件目（3件中）の「下へ」は`beforeProjectId: null`。
- [状態遷移] 描画: 押下 → 応答待ちの間は全ボタンが`disabled` → 成功後に解除される。応答待ちの間にもう一度押してもAPIは1回だけ。
- [同値分割] 描画: APIが423 / 404を返すと、エラーのトーストが出て、カードの並びが変わらず、ボタンが再び押せる。通信エラーでは既定のメッセージが出る。
- [代表値] 描画: ボタンを押しても`navigate`（Project詳細への遷移）が起きない。カード本体を押すと従来どおり遷移する。
- [状態遷移] 描画: 2件目の「上へ」を押して先頭へ着くと、「上へ」が無効になり、フォーカスが同じカードの「下へ」へ移る。途中の移動ではフォーカスが押したボタンに残る。
- [代表値] CSS（セレクタ単位のソース文字列検査）: `.project-card-item`、`.project-order-actions`、`.project-order-button`の規則があり、〜767pxで`.project-order-button`が44px以上。
