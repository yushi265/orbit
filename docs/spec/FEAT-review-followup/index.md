# FEAT-review-followup: ローカル確認後の操作・表示改善

## 概要と範囲

2026-10-02のユーザー追加依頼13件を、操作の不具合、一覧・詳細の表示の順に修正する。新規ブランチで修正・検証・コミットする依頼の続きとして扱う。既存API・Owner境界・Snapshotを再利用し、Migration、認証変更、公開、pushは行わない。既存CLAUDE.md差分は対象外。

## 受け入れ基準

- **AC-1**: HomeのOpen Issues、Active Projects、期限区分、Current Cycleから、表示件数に対応する一覧または詳細へ遷移できる。個別Issue/Projectのリンクも維持する。
- **AC-2**: Issue詳細で本人のLabelを付け外しでき、保存・再読込・一覧へ反映する。保存失敗と競合を表示し、他Ownerの参照を受け入れない。
- **AC-3**: Issue詳細はDesktopで画面幅の約90%を使い、Mobileの余白・内部スクロール・Dialog操作を維持する。
- **AC-4**: Issue詳細のProject選択で自動保存し、Project保存ボタンを除去する。説明の未保存変更と直列化し、連打で重複送信しない。失敗時はRetryできる。
- **AC-5**: Due date入力は枠線・padding・focus・themeを他の入力と揃える。
- **AC-6**: Issue一覧のDue dateをDesktop/Mobileで表示・編集でき、入力幅による横はみ出しがない。
- **AC-7**: 更新日・作成日・タイトル・Status・Priority・期限それぞれの昇順/降順を選択し、URLとProject表示設定へ保存できる。
- **AC-8**: Homeの挨拶を除去し、各ページの過大な見出しを小さくする。
- **AC-9**: 初回遷移の二重表示を調査し、正常な開発StrictModeを維持したまま重複通信・副作用の有無を確認する。ページ全体の再登場アニメーションによるちらつきを抑える。
- **AC-10**: SidebarのMVP表示を除去する。
- **AC-11**: Desktop Sidebarをviewport内に固定し、短い画面でも全項目へ到達できる。Mobileのナビゲーションを維持する。
- **AC-12**: 手動順の上下ボタンを除去する。DnDとキーボードでの並べ替え、保存中・競合表示は維持する。キーボード移動の完了後は元ハンドルへFocusを戻し、他の入力へ移動した場合は奪わない。
- **AC-13**: メモと説明のhttp/https URLを安全なリンクとして開ける。編集と改行・日本語を維持し、HTMLやjavascript/data URLを実行しない。

## 契約

HomeのOpenはCompletedとCanceledを除外する。Issues URLへ`open=true`を追加し、既存`completed=false`の意味は変更しない。Active Projectsは`/projects?active=true`へ遷移し、通常のProjects表示は変更しない。期限の7日以内は本人Timezoneの今日より後、7日後以下を表す`due=next7`とし、共通日付判定・Filter Schema・URL・UIへ追加する。既存upcomingは将来全体のまま維持する。

Sortは既存値に`updated_asc / created_asc / title_desc / status_desc / priority_asc / due_desc`を追加する。Manualに方向はない。Due未設定は両方向とも最後、同値は既存の安定順を維持する。Priority昇順はNo priorityからUrgent、降順はUrgentからNo priority。既存保存値は引き続き有効。

Dueの比較はUTC暦日keyで行う。既存非midnight値が同じ期限日なら同値として扱い、時刻では並べ替えない。

Labelは既存Issue PATCHのlabelIdsを使う。Project自動保存は既存version・idempotencyKey・409同期・説明flushを再利用する。旧FEAT-issue-project-assignmentの手動保存UI要件は今回の明示依頼で置き換える。

リンクは共通LinkifiedTextでReactのtext escapingを利用し、http/httpsだけを許可する。target=_blankにはrel=noopener noreferrerを設定する。説明は編集textareaを維持し、URLを含む場合にリンクを開けるPreviewを表示する。入力原文の保存形式は変更しない。

上下ボタンの代替はDrag handle上のAlt+ArrowUp/Downとし、画面の通常Arrow shortcutへの伝播を止める。List/Boardで既存のreorder可能範囲を維持する。

## テスト戦略・UI/UX

1440px/1024px/390pxと高さ600px、Light/Darkで実Browser確認する。空・loading・保存中・失敗・競合・再読込をテストする。Homeリンクの条件と件数、Label/Projectの直列保存、全Sort方向とnull、URL復元、Keyboard reorder、安全なlinkificationは挙動テストで確認する。CSSはBrowserで実測する。

| 分類 | ケース |
|---|---|
| 境界値 | next7の今日/1日後/7日後/8日後、Due null、短いviewport |
| 状態遷移 | Label付け外し、Project選択/説明保存中/Retry/409、URL再読込 |
| アクセス境界 | Label/RunのOwner分離 |
| セキュリティ | http/https、日本語/改行、HTML/javascript/dataの非実行 |
| 代表値 | 全Sort方向、Home各リンク、Keyboard reorder |

## 進め方

Tier 1（共有Filter/Sortの保存契約を拡張するため）。spec・TDD・品質ゲート・3観点レビューを実行し、ユーザーの修正/コミット指示の範囲で進める。既存FIX-main-reviewのP3（receipt期限・最新Run・長いProject見出し）も適切な作業単位で完了する。
