# FEAT-feedback-polish: 動作確認フィードバック対応

## 概要

実機・ローカル動作確認で見つかった7件の不具合・不足を、導線、Issue操作、Cycle、テーマ、PWAの順に解消する。
既存のOwner境界・冪等性・Issue version CAS・Cloudflare Access契約は維持する。

## 対象範囲

- 対象レイヤー: [service.md](./service.md)、[ui.md](./ui.md)
- 対象ドメイン: routing / issues / cycles / preferences / PWA
- 対象外: 新しいDBテーブル、外部連携、PWAのオフライン業務データ、Cycle自動Scheduler

## ユニット計画

| # | ユニット | 含むAC | 依存 | 状態 |
|---|---|---|---|---|
| 1 | Project / Issue navigation | AC-1 | 既存Route / Bootstrap | 完了 |
| 2 | Issue display and priority | AC-2 | Issue PATCH / POST | 完了 |
| 3 | Cycle start | AC-3 | Cycle close / settings | 完了 |
| 4 | Theme and PWA | AC-4, AC-5 | Preferences / static assets | 完了 |

## 受け入れ基準（AC）

- [x] **AC-1**: スマートフォンを含むProject一覧からProject詳細へ遷移でき、Project詳細のIssue行を選択すると同じIssueの詳細URLへ遷移できる。Back操作とKeyboard操作を阻害しない。
- [x] **AC-2**: Issue一覧・詳細・新規作成でタイトルが主要領域を確保して表示され、PriorityをNo priority / Low / Medium / High / Urgentから選択・保存できる。保存失敗時は既存のrollback / retry契約を維持する。
- [x] **AC-3**: Upcoming Cycleの詳細から「Cycleを開始」を実行できる。対象が現在Cycleの次Cycleである場合、現在Cycleを既存の繰越処理で完了し、対象Cycleを現在時刻開始・設定期間終了のActiveへ遷移する。同じKeyの再送はNo-op、lock中は423になる。
- [x] **AC-4**: Settingsで選択したLight / Dark / Systemが保存後に画面全体へ反映され、再読み込み後も維持される。Darkでは主要カード、入力、一覧、Navigation、Modalの文字と背景のコントラストを確保する。
- [x] **AC-5**: HTTPSの本番URLでManifest、PNG icon、Service Workerが取得可能な状態を維持し、対応ブラウザではInstall導線を表示できる。認証済みHTML/API/個人データをService Worker Cacheへ保存しない。

## アーキテクチャ / レイヤー間フロー

```text
Project Card / Project Issue Row → TanStack Router URL navigation
Issue List / Detail / Composer → existing Issue POST/PATCH
Upcoming Cycle Start → POST /api/v1/cycles/:cycleId/start
Settings Theme → PATCH /api/v1/preferences → document[data-theme]
PWA Install → manifest + service worker + beforeinstallprompt
```

## エラー・ログ方針（横断サマリ）

| シナリオ | service | UI |
|---|---|---|
| Route対象不存在 | 404 `RESOURCE_NOT_FOUND` | Not Foundと戻る導線 |
| Issue属性保存失敗 | 既存ErrorEnvelope / 409 / 423 | draft rollback、Toast、再試行 |
| Cycle対象不存在・状態不正 | 404または400、業務副作用なし | エラー表示、現在のCycleを維持 |
| Cycle Runtime lock | 423 `OPERATION_IN_PROGRESS` | 開始操作を確定せず再試行表示 |
| Theme保存失敗 | 既存ErrorEnvelope | 選択値を維持しエラーToast |
| PWA install条件未成立 | Browser APIの未提供 / prompt未発火 | Installボタンを表示しない。説明導線はSettingsへ置く |

## テスト戦略

| AC | 単体 | レイヤー内結合 / Smoke |
|---|---|---|
| AC-1 | route target mapper — | local browser smoke、Route生成確認 |
| AC-2 | title display / priority mapper | Issue POST/PATCH API、local browser smoke |
| AC-3 | Cycle start state transition | Store / API state transition、local browser smoke |
| AC-4 | theme resolution mapper | Preferences API、local browser smoke |
| AC-5 | manifest / install capability mapper | static asset check、authenticated browser smoke |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `OrbitApp`、Bootstrap、既存Issue mutation、`closeCycle`の繰越ロジック、Preferences API、Manifest / Service Worker。
- 差分: Project cardをRouter Link相当の導線へ整理し、Project issue rowにIssue navigationを追加する。Cycle start APIを追加し、既存close処理を委譲する。
- 衝突回避: PWA Cacheは既存どおり静的Assetだけに限定し、ThemeはCSSの追加オーバーライドで既存Light表示を壊さない。

## 実装に効く制約

- Cycle startはJSON bodyのOwner、idempotency、Runtime lock、対象Cycle状態をServer側で検証する。
- Cycle startは現在Cycleの次Cycle以外を開始しない。
- Issue Priorityは既存`priority` Zod契約を再利用し、許可値以外を受け付けない。
- PWAの認証応答・個人データ・Access redirectをCacheしない。
- スマホ幅390pxで横overflowを増やさない。

## 判断根拠 / 未決事項

- 対応順は、操作不能な導線と業務Mutationを先に直し、その後に見た目・インストール体験を直す。
- Project詳細のIssue行は新しいページ状態を増やさず、既存Issue専用URLへ遷移する。
- Cycle startは新しいCycle遷移ロジックを複製せず、既存`closeCycle`を内部委譲して繰越の一貫性を保つ。
- Browser smokeは実Access / PWA境界の確認として、各実装ユニット後とRelease hardeningで実施する。
- CYC-08の本番D1条件付きCASは既存のMVP Release hardening境界に従い、今回のMemory StoreではOwner / lock / idempotency / 日付再計算 / 重複拒否を検証する。
- 未決事項なし。ユーザーの自律実行指示によりGate 2は要点提示後に委任する。
