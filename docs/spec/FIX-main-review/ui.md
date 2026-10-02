# 表示層

## 担保AC

- **AC-8**: 期限を時刻を持たない日付として扱い、入力した暦日をTimezone変更後も維持する。入力・表示・UI Filter・検索APIは同じ暦日判定を行う。
- **AC-2**: 実行中Runの再読込・通信中断後も進捗を再取得し、安全にcontinueできる。Lease失効時は再開導線が表示される。
- **AC-3**: 有効な長いProject名を含むIssue Filterは1440px・390px幅でページ全体を横にはみ出さない。
- **AC-4**: 390×600のComposerでタイトル・作成・キャンセルへスクロールして到達できる。
- **AC-5**: Darkの親子Issue欄はテーマに対応した背景と読める文字色を使う。
- **AC-6**: Issue詳細・Composer・Command Paletteの初期Focus、Tab巡回、復帰とEscapeがDialogの境界を守る。
- **AC-7**: Issue Filter・Mode・OrderをURLから復元し、詳細往復・再読込で保持する。
- **AC-14**: 古い検索応答・失敗が新しい検索結果や空検索を上書きしない。
- **AC-15**: Project作成の連打・保存中のEnterを重複送信せず、IME確定Enterでは作成しない。
- **AC-16**: Autosaveの409後に最新IssueをDetailと一覧Cacheへ同期する。
- **AC-19**: 1024pxの長いProject名でも操作ボタンの文字が細かく折り返されない。

## 契約・UI/UX方針

- Runの既存APIを維持し、currentを定期取得する。running復元時に安全なcontinueを起動し、同一画面で二重runnerを作らない。通信失敗時は誤った成功Toastを出さず、進捗の再取得を続ける。paused/failedは既存Resume導線。無制限のtight loopにせずChunk間で制御を返す。
- 初期・保存中・空・エラー・競合の既存表示を保持する。新しい画面やデザインシステムは追加しない。
- URLは既存MVPが要求するFilter/Mode/Orderの正本とする。Issues一覧・詳細に同じvalidatorを置き、Route.useSearch()の結果を表示へ渡す。
- search keysは`q`（文字列）、`status`/`label`（Owner ID）、`priority`（既存5値）、`project`（Owner IDまたは既存`__none__`）、`due`（none/overdue/today/upcoming）、`scope`（active/archived）、`order`（既存IssueSort 7値）、`mode`（list/board）、`completed`（boolean）。all/list/active/updated_descの既定値はURLから省略できる。`completed`は生成URLへ実効値を明示し、初回省略時のみStorageへfallbackする。
- 不正Enum、配列、object、未知keyは安全な既定値へ正規化する。qは入力中の空白を保持し、手入力URLの数値primitiveは文字列として扱う。参照IDの存在補正はBootstrap取得後に行う。
- Filter更新はreplace/resetScroll:false、解除は一括navigation。Issuesから詳細・詳細内Issue切替・閉じるでは同じsearchを保持する。他画面からはIssuesの既定条件で開く。閉じる先は既存どおり`/issues`。global EscapeはDetailの保存flushを迂回しない。
- 一覧復帰時のFocusは対象行描画後に`preventScroll:true`で復元する。現在のRouter scrollRestorationを維持し、開閉時はresetScroll:falseを指定する。
- Detail/Composer/Commandは初期Focus・Focus trap・元要素への復帰を持つ。背景はinertとし、DetailのEscapeは保存flushを待つ。既存Run Overlayとの重なりを壊さない。
- 検索は既存300ms debounceを維持する。発行済みrequestの応答が現在の要求と一致した場合のみ反映する。空検索とunmountで旧応答を破棄する。
- Projectはrefによる即時重複guardと表示pendingを持つ。失敗時は再試行可能で、IME Enterは無視する。
- Autosave競合の最新Detailを既存applyUpdatedIssueでActive/Archived等の既存一覧Cacheにも反映する。別操作でlifecycleが変わった場合は各scopeの所属を保ち、無関係な行を保持する。
- Issue期限の表示/入力はUTC暦日を維持する。List/Filter/Home/relative dayだけsharedの期限日helperへ統一し、本人Timezoneのtodayと比較する。Activity・Project/Cycle等のtimestamp表示は変更しない。
- blocking Runの視覚上のz-indexをDialog/Toastより上へ置き、Focus/inertの最前面priorityと一致させる。非blocking表示は従来の重なりを維持する。

## レスポンシブ・アクセシビリティ

1440×900、1024×768、390×844、390×600、320×740を確認する。toolbarは必要時に折り返し、selectは親幅を超えない。Composerはviewport/safe area内で縦スクロールできる。Darkのhierarchyはsurface/text変数を使用する。Project actionsは縮み過ぎずTabletで折り返す。

開発時のstylesheet URLはViteのreserved `v` queryを追加せず、`appCss`をそのまま使用する。現行`/src/styles.css?v=5`は`max-age=31536000,immutable`、query無しは`no-cache`であり、実測前の古いCSS残留を防ぐ。本番のhash付きasset URLとAPP_ASSET_VERSIONは維持する。

## テストケース

実DOMでrunning復元/通信失敗後の継続・paused表示、Focus巡回/復帰/保存待機、URL再読込/詳細往復、検索順逆転/空検索/unmount、Project連打/IME、Autosave409のCache同期をTDDで確認する。CSSはBrowserで寸法と操作到達性を実測する。
