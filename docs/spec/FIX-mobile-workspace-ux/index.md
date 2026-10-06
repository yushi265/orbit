# FIX-mobile-workspace-ux

最新main b7349caを基点とした、2026-10-03の追加UI修正。
ユーザーが実装・検証・commit/push・PR/CI/merge・CLI本番反映まで明示承認。
選択ViewのURL query検証をsrc/routes/views.tsxに追加するため、routing契約に該当するTier 1。ユーザーの最新の全工程実施指示を本範囲の承認として適用。既存IssueQuery・通知read API・認証・DBスキーマを維持する。

## 受け入れ条件

1. Mobile詳細・作成は下端シート。320/390pxで画面内、内部スクロール、safe area、背景scroll lock、閉じる/戻る/focus復元を維持。
2. 検索の各候補は画面内に表示・選択可能。アプリ内listboxをportalで描画し、overflowによる切断を防止。Escape/Tab/Arrow/Enterで操作可能。
3. Mobile一覧の期限入力は130pxに抑え、日付とcalendar triggerの重なり・横overflowを防ぐ。
4. 詳細を初めて開いたとき、非同期タイトルが届いた後にcaretを末尾に置く。ユーザーの選択・入力・IME開始後は動かさない。再開時も適用。
   - **2026-10-06 FIX-detail-views-polish で置換**: 詳細は開いた直後にタイトルへFocusしなくなった（FocusはDialog自身）。このため詳細側のcaret制御は削除した。Composer側の末尾caretは継続。以下の検証記録の「末尾caret」は当時の結果。
5. Mobile SettingsはSVGで他のアプリUIと色を統一。
6. Mobileの44px操作、長文、320/390px、縮小viewportと背景固定を確認。実機キーボードは別途確認対象。
7. PC calendar triggerはSVG。フォントglyphに依存しない。
8. Viewsは条件編集、保存、選択結果のlist/board表示、選択URL再読込、削除/空状態を提供。既存query条件を編集時に保持。
9. Inboxは既読・一括既読・未読に戻す/再試行を提供。通知の自動生成は現行未実装と明記。期限の確認は既存Homeへ案内。外部配信は追加しない。
10. Project詳細Issue一覧末尾にPC/mobileの余白を設ける。

## 検証方針

Runtime回帰テストと型/test/lint/format/build。ブラウザはローカルfixtureのみ編集。
本番検証は表示の確認、正式Worker version/100%配信、D1バックアップと業務データ保持の比較。

## 調査・実装記録

- mainはb7349ca、開始時clean。既存19+13修正とPR3/4を再実装していない。
- Views既存CRUDは正常だが、選択がmetadata表示のみ・新規filter={}で実用経路がなかった。既存IssueQueryのclient実行で接続。
- Inboxはdev seedのみ通知生成。read APIは正常。新しい通知生成・外部送信を追加せず実態の案内とread:false UIに限定。
- より小さい候補: 検索native selectの幅のみ調整。ただし候補描画がOS依存でブラウザ内で確認不能のためportal listboxを採用。
- RED: calendar glyph期待変更の既存回帰テスト失敗、OrbitSelect未実装module失敗、Viewshelper未実装module失敗、Inbox生成案内の追加テスト失敗を確認。
- mobile-layout.test.tsのsafe-area文字列一致11行を削除。旧padding式に固定して新しいvisualViewport下端シートを拒否するため。代替はdialog runtimeのviewport/scroll lock/復元検証と実ブラウザ320×740・390×844・320×380縮小viewportのgeometry/長文scroll証跡。
- Browser fixture: detail bottom=viewport bottom、320/390で横overflowなし、scrollTop1196時close44×44が上方に保持、末尾caret、Composer作成/期限calendar選択/再開を確認。実機キーボードは未確認、縮小viewportとvisualViewport listenerは検証。
- Browser Search: 6候補の表示/選択/閉じる、320のArrow/End/Enter、選択条件でfixture検索1件を確認。
- Browser Inbox: 一括既読→未読復元→reload保存→開くと既読/Issue詳細遷移を確認。
- Browser Views: High条件で保存→2件を表示、URL再読込で同条件復元、Board/Status groupへ編集、結果から詳細→browser backで選択を復元、削除でURL/一覧を解除、削除済みIDは不存在案内。320px横overflowなし。
- Browser Project: PC一覧内padding-bottom24px/card margin-bottom28px、Mobile期限130×44px、最終row bottom559px < nav top655pxで重なりなし。PC calendar SVG20×20px、Mobile Settings SVG18×18px。
- Reviewer Must: routing risk宣言、RED/単純候補記録、URL統合test、独立filter/order fixture、削除test代替証跡を解消。Should: IME Escape・jsdom focus shim・formatter回帰・label group/limit境界を解消。
