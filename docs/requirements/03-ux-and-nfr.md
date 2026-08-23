# 7. UI / UX要件

## 7.1 共通原則

1. 主要操作は画面遷移なしのインライン編集またはDialog / Sheetで完結させる
2. Mutationは楽観的更新し、失敗時にロールバックと再試行を提示する
3. URLは選択中View、Issue、主要Filterを表現する
4. Focus、選択、Hover、Drag、保存中、エラーの状態を視覚的に区別する
5. PointerとKeyboardのどちらでも同じ操作結果へ到達できる
6. 端末幅ではなく利用文脈に合わせて情報密度を変える

## 7.2 レスポンシブ設計

| 区分 | 目安 | ナビゲーション | Issue詳細 | 一覧操作 |
| --- | --- | --- | --- | --- |
| Mobile | 〜767px | 下部5タブ + 必要時Sheet | Full screen route | 1列、Swipe補助、長押しMenu |
| Tablet | 768〜1199px | 折りたたみSidebar | 右側SheetまたはFull screen | List / Board、タッチDrag |
| Desktop | 1200px〜 | 固定Sidebar | Modal + URL、またはSplit view | 高密度List / Board、Keyboard中心 |

モバイル下部タブは Home / Inbox / Create / Search / Menu とする。LinearのモバイルもHome、Inbox、Create、Search、Settingsを主要入口としている。[Linear mobile](https://linear.app/docs/get-the-app)

## 7.3 タッチ要件

- タップ領域は原則44×44 CSS px以上
- Drag開始はハンドルまたは長押しとし、スクロールを妨げない
- Hoverでのみ現れる必須操作を作らない
- Swipe actionは補助導線とし、同じ操作をMenuからも実行可能にする
- Bottom sheetはSafe Areaを考慮する
- Boardは横スクロール可能にし、列幅を端末幅に合わせる

## 7.4 アクセシビリティ

- WCAG 2.2 AAを目標とする
- すべての操作をキーボードで実行可能にする
- Focus ringを常時識別可能にする
- 色だけでStatus、Priority、エラーを伝えない
- Dialog、Menu、Combobox、Tooltipは適切なARIAとFocus trapを持つ
- `prefers-reduced-motion`を尊重する

## 7.5 体感性能

- 操作直後100ms以内に視覚フィードバックを返す
- List初回表示のLCP（最大コンテンツ描画）p75を2.5秒以下にする
- INP（操作応答性）p75を200ms以下にする
- 1000 IssueのViewで仮想スクロールし、DOM行数を抑える
- Route単位でデータを先読みし、戻る操作でScroll、Filter、選択状態を復元する

# 8. 非機能要件

| 分類 | 要件 |
| --- | --- |
| 可用性 | 月間99.9%を目標とし、Cloudflare障害時を除くアプリ起因エラー率を監視する |
| 性能 | 通常APIのp95を500ms以下、検索APIのp95を800ms以下とする |
| 整合性 | Issue更新はversionによる楽観的ロックを行い、競合時は上書きせず再取得させる |
| セキュリティ | OWASP ASVS Level 2相当、全Mutationで認証・認可・入力検証・CSRF対策を行う |
| データ保護 | 全Queryを認証済みuser_idでスコープし、他アカウントのデータへアクセスできないようにする |
| プライバシー | ログへ本文、Cookie、Token、メールアドレスを不用意に出力しない |
| バックアップ | D1 Time Travelを利用し、定期Export手順を用意する。FTS Virtual tableは派生IndexとしてExport前に除外し、復元後にMigrationと再Indexで再構築する。[D1 import / export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) |
| 観測性 | request ID、構造化ログ、エラー、Latency、D1 query、Queue失敗を追跡する |
| 保守性 | TypeScript strict、境界Schema、Migration、ADR、Feature単位のモジュール構成を採用する |
| 互換性 | 最新2世代のChrome、Safari、Edge、Firefoxおよび現行iOS/Androidブラウザを対象とする |
| テスト | Domain unit、Repository / Service / UI integrationを一次担保とし、Playwright E2EはAccess・PWA・実Browser固有の少数Smokeへ限定する |
