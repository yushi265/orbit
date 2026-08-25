# FEAT-feedback-polish: UI 詳細設計

## 担保 AC

- **AC-1**: スマートフォンを含むProject一覧からProject詳細へ遷移でき、Project詳細のIssue行を選択すると同じIssueの詳細URLへ遷移できる。Back操作とKeyboard操作を阻害しない。
- **AC-2**: Issue一覧・詳細・新規作成でタイトルが主要領域を確保して表示され、PriorityをNo priority / Low / Medium / High / Urgentから選択・保存できる。保存失敗時は既存のrollback / retry契約を維持する。
- **AC-3**: Upcoming Cycleの詳細から「Cycleを開始」を実行できる。対象が現在Cycleの次Cycleである場合、現在Cycleを既存の繰越処理で完了し、対象Cycleを現在時刻開始・設定期間終了のActiveへ遷移する。同じKeyの再送はNo-op、lock中は423になる。
- **AC-4**: Settingsで選択したLight / Dark / Systemが保存後に画面全体へ反映され、再読み込み後も維持される。Darkでは主要カード、入力、一覧、Navigation、Modalの文字と背景のコントラストを確保する。
- **AC-5**: HTTPSの本番URLでManifest、PNG icon、Service Workerが取得可能な状態を維持し、対応ブラウザではInstall導線を表示できる。認証済みHTML/API/個人データをService Worker Cacheへ保存しない。

## 画面・導線契約

| 画面 | 操作 | 結果 |
|---|---|---|
| Projects | Project card tap/click | `/projects/:projectId`へ遷移 |
| Project detail | Issue row tap/click | `/issues/:issueId`へ遷移 |
| Issues list | Priority select | 既存Issue PATCHを即時実行 |
| New Issue | Priority select | Issue POSTへ値を含める |
| Cycles Upcoming | `Cycleを開始` | 開始中Overlayを表示し、成功後にCurrent tabへ切り替えてBootstrap再取得 |
| Settings Appearance | Theme select | API保存後に`document.documentElement.dataset.theme`へ反映 |

## UI/UX 方針

- **画面フロー / 導線**: Project cardは標準Router Link相当のNavigation、Project detailのIssue rowはbuttonでIssue専用URLへ遷移する。
- **主要操作とフィードバック**: Priorityは一覧で即時保存、詳細では既存属性の保存導線を再利用。Cycle開始中は既存Cycle blocking overlay、Theme保存は既存Toastを利用する。
- **状態設計**: Project / IssueのNot Found、Priority保存中、Cycle開始中、Theme保存失敗、PWA install prompt未発火をそれぞれ既存のError / Empty / Busyパターンで表示する。
- **タイトル表示**: Issue titleはDesktop / Tablet / Mobileとも最低2行を許容し、ID・Status・Priority・Project列がタイトル領域を過剰に奪わないようにする。
- **既存デザインとの整合**: 既存`button`、`select`、`detail-card`、`toast`、`cycle-blocking-overlay`を再利用する。

### レスポンシブ / アクセシビリティ

- 390pxではProject cardとIssue rowのタップ領域を全幅で確保し、タイトルは折り返し表示する。
- 390pxのIssue詳細Modalはsafe-area内の上端から表示し、表示領域を超える本文だけをパネル内でスクロールする。
- Project card / Issue row / Priority select / Cycle startには、目的が分かる可視文言または`aria-label`を付ける。
- Dark themeでもfocus-visible outline、選択状態、Errorを色だけに依存させない。

## PWA契約

- `/manifest.webmanifest`は`start_url: /`、`display: standalone`、192px / 512px PNG iconを含める。
- `/sw.js`は静的AssetのみCacheし、manifest / HTML / API / Access redirectはCacheしない。
- `beforeinstallprompt`が利用可能な場合のみInstallボタンを表示し、利用できない場合は通常のブラウザ導線を壊さない。

## テストケース

- [代表値] Project card / Project issue rowのclickで目的URLへ遷移する
- [代表値] Priority選択がIssue PATCH / POSTへ反映される
- [状態遷移] Upcoming Cycleのstart操作中は二重クリックを無効化し、成功後Currentへ移る
- [代表値] Theme light / dark / systemがroot属性へ反映される
- [Browser smoke] 390 / 768 / 1200px、Tab / Enter、Project→Issue、Cycle start、Dark theme
- [Static asset] Manifest icon、Service Worker Cache対象、apple-touch-iconが正しい

実ブラウザの390 / 768 / 1200px、Tab / Enter、Back、Dark theme、PWA installは、Access・Browser API境界を含むためRelease hardeningへ延期する。延期中も本specの静的Assetテスト、API / Store状態遷移、型・LintをGate 3の証跡とする。
