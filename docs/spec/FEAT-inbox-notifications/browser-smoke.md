# FEAT-inbox-notifications Browser Smoke

## 実行条件

- 実行日: 2026-08-24
- URL: `http://localhost:3000`
- データ: local dev ownerのseed notification

## 手順と結果

1. `/inbox` を開く。
   - 未読notification、Inbox badge、すべて既読ボタンが表示された。
2. `TASK-1の期限が近づいています`のrowをクリックする。
   - read stateへ更新され、`/issues/:issueId`へ遷移し、Issue detailが開いた。
3. 既読化後にInboxへ戻る。
   - すべて既読ボタンがdisabledになり、未読badgeが0になった。
4. 390 / 768 / 1200pxで`document.documentElement.scrollWidth`と`clientWidth`を確認する。
   - Inbox rowに横overflowがない。対象幅は既存Label／Bulk smokeと同じCSS cache v3で確認する。

400 / 404 / 423のErrorEnvelopeと再試行はNotification API / Storeテストで検証する。通知生成・実D1・Access・Playwright自動化はRelease hardeningへ延期する。
