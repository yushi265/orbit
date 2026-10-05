# FEAT-issue-hierarchy-list: ui 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: List表示では、一覧に表示されているIssueのうち親も一覧に表示されているものを、親の直下に字下げして並べる。孫以降も同じ規則で入れ子にし、字下げの見た目は3段で頭打ちにする。
- **AC-2**: 選択中の並び順は、同じ親を持つ兄弟どうし（最上位どうしを含む）に適用する。どの並び順でも、子は親の直下にまとまる。
- **AC-3**: 表示中の子を持つ親の行は、開閉ボタン（`aria-expanded`つき、名前「子Issueを折りたたむ」/「子Issueを展開する」）を持つ。閉じると、その親の子孫の行を表示しない。初期状態はすべて開いている。
- **AC-4**: 閉じた親はこの端末のlocalStorage（キー`orbit.issues.collapsedParents`）に保存し、再読込後も閉じたままにする。localStorageが使えない・値が壊れている場合は、すべて開いた状態で表示する。
- **AC-5**: 子を持つIssueの行は、直下の子の完了数バッジ「完了数/母数」を表示する。数え方はIssue詳細の子の進捗と同じ（母数は直下の子の総数でCanceledも含み、Completedカテゴリを完了と数える）で、フィルターで隠れている子も数える。直下の子が0件のときはバッジを表示しない。
- **AC-6**: 親を持つIssueのうち、親が一覧に表示されていないものは、字下げせず最上位に並べ、タイトルの下に「↳ 親のID 親のタイトル」を表示する。親が一覧のデータに無い場合は何も添えない。
- **AC-7**: 並び順が「手動」のとき、ドラッグとAlt+↑ / Alt+↓による並べ替えは、同じ親を持つ表示中の兄弟の間でだけ行える。兄弟でない行へのドロップと、兄弟の端を越える移動は何も起こさない（並べ替えAPIを呼ばない）。
- **AC-8**: 「全選択」は表示中の行（閉じた親の子孫を除く）だけを選択する。行ごとの選択・一括操作・Issueを開く操作・行内のStatus / 重要度 / Project / 期限の変更は従来どおり動く。
- **AC-9**: Board表示と、親子関係を持たないIssueだけの一覧は、表示と操作が従来と変わらない。

## このレイヤーが公開する契約（外部インターフェース）

画面パス・API・URL状態の変更は無い。

| 操作 | 名前 | 具体値 |
|---|---|---|
| 追加 | `src/components/issue-hierarchy.ts` | 下記の純粋関数と保存の読み書き |
| 追加 | `buildIssueHierarchyRows(input)` | 入力 `{ issues: Issue[]（絞り込み・並び替え済みの表示対象）, allIssues: Issue[]（絞り込み前）, workflowStates: WorkflowState[], collapsed: ReadonlySet<string> }`。戻り値 `IssueHierarchyRow[]`（表示順）。`IssueHierarchyRow = { issue: Issue; depth: number（0始まり）; parentKey: string | null（表示上の親のID。最上位はnull）; hasVisibleChildren: boolean; collapsed: boolean; childProgress: { completed: number; total: number } | null; parentHint: { identifier: string; title: string } | null }` |
| 規則 | 表示上の親 | `issue.parentId`のIssueが`issues`に含まれるときだけ、それを表示上の親とする。含まれなければ最上位（`parentKey: null`）。祖先をたどって代わりの親を探すことはしない |
| 規則 | 順序 | 最上位を`issues`の順で並べ、各Issueの直後に、その表示上の子を`issues`の順で深さ優先に並べる。`collapsed`に含まれるIssueの子孫は戻り値に含めない（そのIssue自身は含め、`collapsed: true`）。循環は訪問済み集合で打ち切り、未訪問のまま残ったIssueは最上位として`issues`の順で末尾に並べる |
| 規則 | `childProgress` | `allIssues`のうち`parentId === issue.id`の直下の子を対象に、`calculateCycleMetrics(children, workflowStates)`の`completed`と`total`を使う。`total`は直下の子の総数（Canceledを含む）。直下の子が0件のとき`null` |
| 規則 | `parentHint` | `issue.parentId`があり、その親が`issues`に含まれず`allIssues`に含まれるとき、親の`identifier`と`title`。それ以外は`null` |
| 追加 | `readCollapsedParents(storage)` / `writeCollapsedParents(storage, ids)` | キー`orbit.issues.collapsedParents`、値は文字列IDのJSON配列。読み込みは、取得・parseの例外、配列でない値、文字列以外の要素をすべて「空集合」として扱う。書き込みの例外は握りつぶす。`storage`は`Pick<Storage, "getItem" | "setItem"> | undefined` |
| 変更 | `IssuesView`（`src/components/OrbitApp.tsx`）のList | `issues.map`での描画を、`buildIssueHierarchyRows`の戻り値の描画に変える。開閉状態は`useState`で持ち、初期値と更新時にlocalStorageへ読み書きする。Boardは変えない |
| 変更 | `IssueRow` | 追加props（すべて省略可。`depth`を省略した行は従来と同じDOM）: `depth`、`hasVisibleChildren`、`collapsed`、`onToggleChildren`、`childProgress`、`parentHint`、`reserveToggleSpace`。`depth`が渡された行は、既存の開くボタン（`button.issue-main`）を`div.issue-title-cell`で包み、その中に［開閉ボタン、または`reserveToggleSpace`のとき同じ幅の`span.issue-children-toggle-spacer`］と`button.issue-main`を並べる（ボタンを入れ子にしないため）。`reserveToggleSpace`は、その一覧の表示中の行に開閉ボタンを持つ行が1つ以上あるときだけtrueにし、そのとき行に`has-toggle-column`クラスを付ける。親子の無い一覧ではスペーサーも`has-toggle-column`も出さず、タイトルの左端は従来と同じ位置になる。行の要素に`data-depth={depth}`と`style={{ "--issue-depth": Math.min(depth, 3) }}`。`hasVisibleChildren`のとき、タイトルの前に`button.issue-children-toggle`（`type="button"`、`aria-expanded={!collapsed}`、`aria-label`は開いているとき「子Issueを折りたたむ」・閉じているとき「子Issueを展開する」、表示は開「▾」閉「▸」）。`childProgress`があるとき、タイトルの後ろに`span.issue-child-progress`（表示「完了数/母数」、`aria-label`「子Issue 完了数 / 母数 完了」）。`parentHint`があるとき、タイトルの下に`span.issue-parent-hint`（表示「↳ {identifier} {title}」）。開閉ボタンの押下は行を開く操作・ドラッグを起こさない |
| 変更 | 手動並べ替え | `dropIssue`: ドラッグ元とドロップ先の`parentKey`が異なる、またはどちらかが表示中の行に無いとき、何もしない。同じときは既存どおり`onReorder(dragged, beforeIssueIdForDrop(orderedIssues, draggedId, dropTargetId))`。`moveIssue`: 表示中の行のうち同じ`parentKey`の兄弟の列で前後を求め、端なら`false`を返して何もしない。前後があれば`onReorder(issue, beforeIssueIdForDrop(orderedIssues, issue.id, sibling.id))`を呼び`true`を返す |
| 変更 | 全選択と選択の剪定 | 全選択のチェック時は`buildIssueHierarchyRows`の戻り値のIssue IDだけを選択する。選択中のIDは、表示中の行（同じ戻り値）に含まれるものだけを保つ。親を閉じる・絞り込みを変えるなどで表示されなくなった行は選択から外れ、一括操作の対象にならない。この剪定はList表示のときだけ行う（Boardでは閉じた親の子も見えているため、選択を外さない） |
| 変更 | `src/styles.css` | `.issue-row .issue-title-cell`に`padding-left: calc(var(--issue-depth, 0) * 20px)`の字下げ（〜767pxでは1段12px）。期限の欄（`.due-cell`）が下段に回る幅（〜1199px）では、階層表示の行（`.issue-row[data-depth]`）の期限にも同じ字下げを適用し、`has-toggle-column`のときは開閉ボタンの幅と間隔（PC 28px・〜767px 36px）を足して、タイトルと期限ラベルの左端を揃える。`.issue-children-toggle`は24px四方（〜767pxでは32px）、印は16px・本文色（`--orbit-text`）、`:focus-visible`の輪郭を持つ。`.issue-child-progress`は既存の`.detail-count`系の小さなバッジの配色。`.issue-parent-hint`は補助テキストの色・11px以上・1行で省略（`text-overflow: ellipsis`）。ダークテーマは既存のCSS変数を使う |

- `Issue` / `WorkflowState`の型、`sortIssues`、`beforeIssueIdForDrop`、`calculateCycleMetrics`は変えない。
- 既存の行のDOM（チェックボックス、開くボタン、Status / 重要度 / Project / 期限の各欄、`data-issue-id`、並べ替えハンドル）とその`aria-label`は変えない。

## 実装配置

- `src/components/issue-hierarchy.ts`（新規）
- `src/components/OrbitApp.tsx`: `IssuesView`のList描画・`dropIssue`・`moveIssue`・全選択、`IssueRow`
- `src/styles.css`
- テスト: `src/components/issue-hierarchy.test.ts`（新規・単体）、`src/components/issue-hierarchy-runtime.test.ts`（新規・jsdom描画）

## UI/UX 方針

- 画面フロー: 一覧を開く → 子が親の直下に字下げで並ぶ → 親の▾で閉じる／▸で開く → 行を押すと従来どおり詳細が開く。
- 状態設計:
  - 初期: すべて開いている。
  - 閉じた親: ▸表示。子孫の行は出ない。バッジは出たまま。
  - 絞り込みで親が非表示: 子は最上位に「↳ 親」つきで出る。
  - 親子なし: 従来と同じ見た目。
  - 空・読み込み・エラー: 既存のまま。
- 既存デザインとの整合: 字下げは余白だけで表し、罫線は足さない。バッジと補助テキストは既存の小さな表記（`.detail-count`、`.issue-id`）に合わせる。

## レスポンシブ / アクセシビリティ

- 対象端末: PC・タブレット・スマートフォン。主対象ブレークポイントは既存の〜767px。
- タブレット・PC: 1段20pxの字下げ。
- スマホ方針: 1段12pxの字下げ。開閉ボタンは32px以上。親名は1行で省略。
- a11y: 開閉ボタンは`button`で`aria-expanded`と名前を持ち、キーボード（Enter / Space）で操作できる。バッジは`aria-label`で読み上げる。親名は見えるテキストとして読める。字下げの深さは`data-depth`で持ち、色だけに頼らない。

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| localStorageが無い・例外・壊れたJSON・配列でない・文字列以外の要素 | すべて開いた状態で表示。書き込み失敗でも画面は開閉する |
| 保存済みのIDが一覧に無い | 無視する（保存値はそのまま残してよい） |
| 親子データの循環 | 訪問済みで打ち切り、残りは最上位として表示 |
| 手動以外の並び順でのドラッグ・Alt移動 | 既存どおり無効 |
| 兄弟でない行へのドロップ／兄弟の端での移動 | 並べ替えAPIを呼ばない |
| 並べ替え・更新の処理中 | 既存どおり（開閉は処理中でも操作できる） |
| 選択中の行が表示されなくなる（親を閉じる・絞り込み） | 選択から外す。一括操作の対象にしない |
| 親が非表示で最上位に出ている子と、本来の最上位のIssueの並べ替え | どちらも表示上は最上位（`parentKey`がnull）なので、兄弟として並べ替えられる。位置は平坦なので親子関係は変わらない |

## テストケース（技法注記付き）

- [代表値] `buildIssueHierarchyRows`: 親P（子A・B）と無関係なXが`[X, B, P, A]`の順で入力されると、戻り値は`[X(0), P(0), B(1), A(1)]`（括弧は深さ）で、`parentKey`はB・AがPのID、X・Pがnull。
- [境界値] 深さ: 親→子→孫→ひ孫→玄孫の5世代で`depth`は0〜4。描画の`--issue-depth`は0,1,2,3,3。
- [同値分割] 並び順: 同じ入力集合を`sortIssues`で「タイトル昇順」「期限が近い順」「手動」に並べ替えてから渡すと、それぞれ最上位どうし・兄弟どうしがその並び順になり、子は必ず親の直後にまとまる。
- [デシジョンテーブル] 表示上の親: 親が`issues`にある／`issues`に無いが`allIssues`にある／どちらにも無い／`parentId`がnull、の4列で、`depth`・`parentKey`・`parentHint`が期待どおり。
- [同値分割] 祖父母は表示中だが親が非表示の孫は、最上位で`parentHint`は直接の親。
- [状態遷移] 開閉: すべて開（子孫が出る）→ 親を`collapsed`に入れる（親は`collapsed: true`で残り、子孫は出ない。孫を持つ子が閉じた親の下にあっても出ない）→ 外す（元に戻る）。
- [デシジョンテーブル] `childProgress`: 直下の子が0件はnull／全てCanceled（2件）は`0/2`／Completed 1・Started 1は`1/2`／Completed 1・Canceled 1・Unstarted 1は`1/3`／子が絞り込みで`issues`に無くても`allIssues`にあれば数える／孫は数えない。
- [同値分割] `readCollapsedParents`: 正常なJSON配列は集合になる／storageがundefined・getItemが例外・壊れたJSON・オブジェクト・数値混じりの配列は空集合。`writeCollapsedParents`: 配列をJSONで保存する／setItemが例外でも投げない。
- [代表値] 循環（A.parent=B、B.parent=A）でも無限ループせず、両方が戻り値に1回ずつ含まれる。
- [代表値] 親子なしの入力は、入力と同じ順で全て`depth: 0`・`hasVisibleChildren: false`・`childProgress: null`・`parentHint: null`。
- [代表値] 描画: 子の行に`data-depth="1"`、親の行に開閉ボタン（`aria-expanded="true"`、名前「子Issueを折りたたむ」）とバッジ（表示と`aria-label`）。
- [状態遷移] 描画: 開閉ボタンを押すと子の行が消え、`aria-expanded="false"`・名前「子Issueを展開する」になり、localStorageに親のIDが保存される。もう一度押すと戻り、保存値から消える。開閉ボタンの押下でIssue詳細は開かない。
- [代表値] 描画: localStorageに親のIDを入れてから描画すると、最初から閉じている。
- [代表値] 描画: Statusで絞り込んで親が消えると、子は`data-depth="0"`で`span.issue-parent-hint`に「↳ 親のID 親のタイトル」が出る。
- [デシジョンテーブル] 手動並べ替え（描画）: Alt+↓を、兄弟の途中の子／兄弟の末尾の子／最上位の途中／最上位の末尾で押す。途中は並べ替えAPIが`beforeIssueId`つきで1回呼ばれ、末尾は呼ばれない。ドロップは、兄弟への移動は呼ばれ、別の親の子・親自身へのドロップは呼ばれない。
- [代表値] 描画: 親を閉じた状態で「全選択」を押すと、表示中の行だけが選択され、閉じた親の子は選択されない（一括操作の対象件数で確認）。
- [代表値] 描画: Board表示では開閉ボタン・字下げ・親名が出ない。親子なしの一覧は開閉ボタン・バッジ・親名・スペーサー・`has-toggle-column`が1つも無い。親子ありの一覧では、開閉ボタンの無い行にスペーサーがある。
- [状態遷移] 描画: Listで親を閉じた後にBoardへ切り替え、閉じた親の子を選択しても選択が保たれる。
- [状態遷移] 描画: 子を選択 → 親を閉じると選択から外れる（選択件数が減る）→ 親を開いても未選択のまま。親と子を選択 → 親を閉じると親だけが選択中。
- [境界値] 描画: 5世代の一覧で`data-depth`は0〜4、`--issue-depth`は0,1,2,3,3。
- [デシジョンテーブル] 手動並べ替え（描画・平坦な位置で兄弟の間に別の親の子が挟まる配置 P1, c1, P2, c2, P3）: P1でAlt+↓は`beforeIssueId`がc2／P2でAlt+↑はP1／P3をP1へドロップはP1／P1をP3へドロップはnull／c1をc2へドロップは呼ばれない。P1を閉じた状態でも同じ結果。
- [代表値] 描画: 親の行・子の行それぞれで、タイトルのボタンを押すとそのIssueの詳細が開く。子の行のチェックボックスで選択できる。
- [代表値] CSS（セレクタ単位のソース文字列検査）: `.issue-row .issue-title-cell`の字下げが`--issue-depth`を使い、〜767pxで1段12px。`.issue-row[data-depth] .due-cell`の字下げと`has-toggle-column`時の加算。`.issue-children-toggle`の16px・本文色・`:focus-visible`。`.issue-child-progress`と`.issue-parent-hint`の規則がある。
