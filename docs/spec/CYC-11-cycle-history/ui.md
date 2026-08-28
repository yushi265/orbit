# CYC-11: ui 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: 本人がIssue詳細を開くと、既存の`GET /api/v1/issues/:issueId`は`cycleHistory`（新しい順）と`carryoverCount`を返す。`cycleHistory`の各項目は`id`、対象Issueの`issue`（`id` / `identifier` / `title`）、`fromCycle` / `toCycle`（`id` / `number` / 表示名`name`）、`movedAt`を持ち、`carryoverCount`は配列件数と一致する。履歴がない場合は空配列と0を返し、手動割当・CYC-10の自動割当は繰越として数えない。
- **AC-2**: 本人がCyclesを開くと、既存の`GET /api/v1/bootstrap`は本人の`cycleHistory`だけを返し、Cycle履歴の各Cycle行にそのCycleへ繰り越されたIssue数（`toCycle.id`単位）を表示する。Cycleを選択した詳細では、繰越Issueのidentifier / titleと`元Cycle`（`fromCycle.name`）を表示し、履歴がないCycleは件数0と空状態を表示する。
- **AC-4**: Issue詳細の繰越表示とCycles画面のCycle履歴表示は、既存のDesktop / Tablet / 390px Mobileレイアウトで横overflowを発生させず、初期・読込中・空・エラー・成功の状態を既存導線で示し、既存のCycle選択とIssue詳細表示を壊さない。表示はread-onlyで、既存のキーボード / Pointer操作とアクセシビリティ方針に従う。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| Issue詳細表示 | `/issues/:issueId` | `IssueDetailViewModel.cycleHistory`と`carryoverCount`をread-only表示 | 既存Issue Detailの本人境界 | Issueごとの繰越回数・元Cycle確認 |
| Cycle履歴表示 | `/cycles` / `/cycles/:cycleId` | Bootstrapの`cycleHistory`を`toCycle.id`で集計し、Cycle行と選択詳細へ表示 | 既存Bootstrapの本人境界 | Cycleごとの繰越件数・Issueと元Cycle確認 |

## このレイヤーが依存する下位の契約

- 呼び出す相手: `GET /api/v1/issues/:issueId`、`GET /api/v1/bootstrap`
- 受け渡し: 既存`apiGet` / TanStack Queryを利用し、Token・Cookie・D1 bindingへ直接アクセスしない。既存のIssue更新後refresh、Bootstrap再取得、Issue Detail refetchを再利用する。

## UI/UX 方針

- **画面フロー / 導線**: Issue Detailの既存属性・親子Issueの下にread-onlyの「Cycle履歴」セクションを追加する。見出しに「繰越 N回」を表示し、各行へ`元Cycle → 移行先Cycle`と移動日時を表示する。Cycles画面の既存「Cycle履歴」timeline rowには「繰越 N件」を追加し、選択CycleのIssue一覧の前に、当該Cycleへ入った繰越Issue一覧を表示する。
- **主要操作とフィードバック**: 履歴自体に編集・削除操作は作らない。Cycle rowの既存選択、Issue Detailの閉じる・再認証・Retry、既存のIssue / Cycle Mutation後のrefreshを維持する。繰越Issueはidentifier / title / 元Cycleをテキストで確認できる。
- **状態設計（出し分け）**: Bootstrap / Issue Detailの既存loading中は既存skeleton / loading表示を使う。成功時は件数と履歴を表示し、0件は「繰越履歴はありません。」または「このCycleへ繰り越されたIssueはありません。」を表示する。API error / 401 / 404 / 500は既存のIssue Detail / page error / Retry導線を使い、履歴だけの新しいerror modalは作らない。
- **既存デザインシステムとの整合**: 既存の`detail-section`、`detail-section-heading`、`detail-count`、`timeline-row`、`timeline-list`、`mini-issue`、`detail-empty`、`status-pill`、`eyebrow`を再利用する。新規コンポーネント抽象化・ライブラリ・アイコンセットは追加しない。

### レスポンシブ / アクセシビリティ

- Desktop（1200px以上）はIssue Detailの既存main / activity配置とCycle workspaceのtimeline配置を維持する。Tablet（768〜1199px）は履歴のCycle summaryとIssue summaryをwrap可能にし、Mobile（390pxを含む767px以下）は履歴行を縦積みにしてidentifier / title / 元Cycleを折り返す。固定幅・nowrap依存を追加しない。
- Issue履歴セクションには`aria-label="IssueのCycle履歴"`、Cycleのincoming一覧には`aria-label="このCycleへ繰り越されたIssue"`を付け、見出し・件数・元Cycleをテキストで示す。色やtimeline dotだけで繰越状態を伝えない。
- 既存のCycle timeline buttonはKeyboard / Pointerで選択できる状態を維持する。繰越Issue情報はread-only要素として、フォーカス可能な操作を増やさない。
- loading / empty / error / successは既存のテキスト、`role="status"`、`role="alert"`、見出し階層を再利用する。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| Issue Detail loading / error | 既存skeleton、読み込みエラー、Retry / Not found導線を表示し、履歴の内部値を推測して表示しない |
| Bootstrap loading / error | 既存Bootstrapのloading / page error導線を使い、Cycle履歴だけを別の仮データで補完しない |
| 履歴0件 | count 0と説明的な空状態を表示する。表示領域を空白のままにしない |
| 不正参照entry | serviceが除外したentryは表示しない。Issue IDなどを直接表示しない |
| 390px overflow | 履歴行を縦積み・wrapし、画面横幅を超える固定要素を追加しない |

## テストケース（技法注記付き）

- [代表値] Issue Detailに「繰越 1回」と`元Cycle → 移行先Cycle`、移動日時が表示される。
- [状態遷移] Issue Detailの履歴0件でcount 0と空状態、履歴複数件で新しい順の行を表示する。
- [代表値] Cycle timeline rowにincoming繰越件数が表示され、Cycle選択詳細にIssue identifier / titleと`元Cycle`が表示される。
- [状態遷移] 履歴0件のCycleで件数0と「このCycleへ繰り越されたIssueはありません。」を表示する。
- [異常系] Issue Detail / Bootstrapの既存loading、404、401、500導線を壊さず、履歴データがない状態でクラッシュしない。
- [アクセシビリティ] Issue / Cycleの履歴セクションに見出し・aria-label・テキスト件数があり、色だけに依存しない。
- [境界値] 390px相当のDOMで履歴行の固定幅・nowrapによる横overflowを発生させない。
- [状態遷移] 既存Cycle rowのKeyboard / Pointer選択と、Issue Detailの既存閉じる / Retry導線が維持される。
