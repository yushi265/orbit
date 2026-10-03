# Verification — FIX-mobile-workspace-ux

## CLI

- `pnpm -C .claude/aidlc referee-check --layer app`: GREEN (typecheck / full test / lint)。ハーネス依存が不足していたため、既存lockfileで独立install後に実行。
- `pnpm test --reporter=json --outputFile=/tmp/orbit-mobile-test-results.json`: 871 tests passed, 0 failed。
- `pnpm format:check`: 225 matched files passed。
- `pnpm run deploy:dry-run`: production build + tsc + deploy preflight + Wrangler dry-run passed。APP_ENV=production、既存D1 bindingのみ。
- `git diff --check`: passed。
- DB migration/API schema/auth変更なし。実データへの編集は行っていない。

## Browser fixture

Chromeでlocal developmentのみ操作。320×740 /390×844 /1200×900と320×380縮小viewport。

- 詳細: bottom=画面下端、内部scrollTop1196でもclose44px保持、末尾caret、Escape閉じる、再開。
- Composer: 下端sheet、priority/date選択→fixture作成→一覧/詳細に保存値を確認。
- Search: 6候補表示/選択、Arrow/End/Enter、該当fixture結果1件、画面内portal。
- Views: 条件保存/実際の2件表示、URL再読込、Board編集、詳細→戻る、削除/空/不存在ID。
- Inbox: all-read→mark unread→reload保存→通知を開き詳細へ。実通知生成は未実装、案内を修正。
- Project: PC/mobile末尾余白、期限130px、最終rowとmobile-navの非重複。
- Calendar/Settings: 実SVGを確認。

証跡: `/Users/shiina/Documents/Codex/2026-10-03/task/mobile-workspace-evidence/`。
実機のソフトキーボード・screen readerは未確認。縮小viewportとvisualViewport listenerのruntimeは検証済み。

## Review

code / spec / test-qualityを別agentで並行レビューし、必須指摘を修正後に再確認。
期日の非nullブラウザfixtureでformatterのlocale誤用を発見し、RED→GREENの回帰を追加。
mobile-layoutの削除11行は旧CSS文字列固定を除去したもので、runtime/ブラウザ証跡へ置換。
