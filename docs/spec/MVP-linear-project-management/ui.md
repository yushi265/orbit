# MVP: 表示層 詳細設計

> TanStack Start / React の Route、TanStack Query による Server state、URL state、Optimistic UI、Mobile / PWA 導線、Background Run Overlay の正本。UI は D1 Binding・Access JWT・Service の内部 Token へ直接アクセスしない。

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: 本人が Issues で `C` → タイトル → Enter を行うと、Preview 環境で Enter 確定から Server 採番済み Issue が一覧へ描画されるまでの p95 が 1 秒以内であり、`TASK-123` 形式の Issue 番号が採番され、専用 URL で同じ Issue 詳細を開ける。
- **AC-2**: 期限を過ぎた Active Cycle を並行して終了しても、Unstarted と Started だけが次 Cycle へ移り、Backlog / Completed / Canceled は元 Cycle に残り、元 Cycle は Completed、次 Cycle は既存行を再利用して 1 件だけ存在し、移動履歴と Outbox event は対象ごとに 1 件だけ冪等に確定する。
- **AC-3**: PC で変更した Issue の High priority がスマートフォンにも表示され、スマートフォンから Status を変更でき、タップ対象が重ならず横にはみ出さない。
- **AC-4**: Issue の Status 保存が失敗した場合、UI は変更前の Status へ戻り、エラー理由と再試行操作を表示し、他 Issue の選択と Scroll 位置を維持する。
- **AC-5**: standalone PWA で Access セッションが失効したとき、401 を Offline / Timeout / 5xx と区別し、現在 URL への Top-level Navigation で Access 再認証へ移り、再認証後に同じ Deep link へ戻り、認証応答と個人データを Service Worker に Cache しない。
- **AC-9**: Settings から Maintenance Run を起動すると 202 と `run_id` が返り、固定 schema 以外は 400、固定 3 Step は `cycle_transition` → `purge` → `outbox_retry` の順で処理され、異なる Key の同時起動は 1 件だけが受理されて他は 423、同じ Key・同じ Request の同時再送・応答紛失後の再送は同じ `run_id` に収束し、`rejected` Run は同じ Key で再起動しない。
- **AC-10**: Background Run が `running` の間、Issue・Cycle・Project・View・Settings 等の業務 Mutation は 423 `OPERATION_IN_PROGRESS` で拒否され、version・Activity・Outbox・Mutation receipt は増えず、読み取り・進捗取得・Run 継続 / 復旧・ログアウト・Access 再認証は許可され、再読み込み後も Overlay と別端末の同一 Run 状態が復元される。
- **AC-11**: Background Run の Heartbeat が途切れて Lease が期限切れになると Run は `paused` になり Lock が解放され、古い HTTP 処理の業務データ・進捗・Run 状態・Heartbeat・Lock 更新は拒否され、同じ Run を cursor 位置から再開でき、Lease 直前は有効・期限ちょうど以降は無効である。
- **AC-12**: `pending` または `running` の Run で Step が失敗すると Run は `failed`、失敗 Step 以降は `skipped` になり、完了済み Step と業務成果物を保持して Lock を解放し、`succeeded` / `rejected` から逆戻りせず、`failed` は同じ Run の resume で失敗箇所から再開できる。
- **AC-13**: 同じ Run・Step・cursor の HTTP Chunk が再送・同時実行されても業務効果は 1 回だけで、前 Step 未完了なら効果を発生させず、resume は同じ Run の Lease を更新し、成功済み Chunk を No-op とし、返却 cursor は同値または前進のみ、`user_id` 不一致・Run 不存在は 404、paused / failed の continue は 409 `RUN_REQUIRES_RESUME`、Lease 競合は 423 になる。

## このレイヤーが公開する契約（外部インターフェース）

### Route / URL state

| Route | 主な Server state / 操作 | Desktop / Tablet / Mobile |
|---|---|---|
| `/` | Current Cycle、期限超過・期限接近、Recently updated | Desktop は高密度、Mobile は Card。 |
| `/issues` | List / Board、Filter、Group、Order、Bulk、Archived | Desktop は List / Board と範囲選択、Mobile は List 優先・Filter Sheet。 |
| `/issues/$issueId` | Issue Detail、Relations、Notes、Activity | Desktop は Modal / Split view でも URL を保持、Mobile は Full screen route。 |
| `/cycles` / `/cycles/$cycleId` | Current / Upcoming / Past、Summary、Graph、Issues、内訳 | Mobile は Summary を折りたたみ、Cycle 選択を Swipe / Select。 |
| `/projects` / `/projects/$projectId` | Project List / Board、Overview、Issues、Progress | Mobile は Card / Section navigation。 |
| `/search` | Query、Recent、Result、Attribute Filter | Mobile は Full screen、下部 Search tab から入る。 |
| `/inbox` | Notification list / detail link | Mobile は下部 Inbox tab。 |
| `/views` | Saved View 一覧・編集 | Mobile は 1 列。 |
| `/trash` | 削除済みデータ、削除予定日、Restore | Settings 配下の Full screen route。 |
| `/settings/$section` | Profile、Workflow、Cycle、Estimate、Label、Project status、通知、Locale、Theme、Background Run | Mobile は項目ごとの下層 Route。 |

Issue Detail は専用 URL を正本とし、Desktop では Modal / Split view を URL と同期する。ブラウザ再読込・URL 共有は同じ Issue を直接取得する。List / Board の主要 Filter は TanStack Router の search params へ canonical に反映し、Saved View の `layout_json` が個人既定表示を上書きする。

### Query / Mutation 契約

| 用途 | Query key / 呼出 | 成功時 | 失敗時 |
|---|---|---|---|
| Issue 一覧 | `['issues', canonicalIssueQuery]` → `issue.list` | cursor page を cache | 400 は Filter 入力、401 は再認証、5xx は retry UI。 |
| Issue 詳細 | `['issue', issueId]` → `issue.get` | detail を cache | 404 は Not Found、401 は Deep link を保持して再認証。 |
| Cycle / Project / View | `['cycles', tab]` 等 → 各 Server Function | URL と Query cache を同期 | 423 は入力を確定せず、409 は再取得。 |
| Issue Mutation | `issue.create / update / bulkUpdate` | `onMutate` で先行反映し、成功 Response で確定 | 409 は最新値再取得、423 は rollback せず処理中状態を維持、その他は snapshot rollback。 |
| Background status | `['background-run', 'current']` → `GET /current` | 30 秒周期・focus 復帰・Network 再接続で再検証 | 401 は再認証、404 は current null と同じ安全な表示。 |
| Background continue | `POST /:id/continue` | `next = continue` の間だけ次呼出。terminal で停止 | expected cursor の敗者は現在進捗を採用、409 は Resume Card、423 は競合表示。 |

検索入力は最大 300ms debounce 後に `search.issues` を呼び、検索 API p95 800ms 以下を Preview の性能検証で確認する。通常 API p95 は 500ms 以下を目標にする。

全非同期 fetch は `credentials: 'same-origin'` と `X-Requested-With: XMLHttpRequest` を付ける。`idempotencyKey` は Mutation ごとに生成し、retry / 応答紛失では同じ Key を使う。入力中の検索語は URL または Local UI state、最近の Issue / 検索は D1 Query で端末間同期する。

### Optimistic UI 契約

1. `onMutate` で対象 Query の snapshot、選択 ID、List scroll anchor を保存する。
2. 入力結果を先に表示し、保存中の属性へ pending 表示を付ける。
3. 成功 Response を Server truth として cache に反映する。
4. 409 は Optimistic 状態を確定せず、最新 Issue を再取得して差分 UI を出す。
5. 423 は Optimistic 状態を確定せず、処理中 Overlay / 再試行導線を維持する。
6. 400 / 404 / 500 / Timeout は snapshot へ rollback し、エラー理由・再試行を表示する。
7. rollback 後も別 Issue の選択、Focus、Scroll 位置、URL state を変更しない。

### Access / PWA 契約

- 共通 Fetch 層は Response status 401、`navigator.onLine`、Timeout、5xx を別分類にする。
- 401 の場合、現在 URL（path + search + hash）を保持し、Router 内遷移ではなく `window.location` の Top-level Navigation で Access 再認証へ送る。再認証後は Access が同じ Deep link へ戻せる契約にする。
- Logout は `/cdn-cgi/access/logout` への Top-level Navigation とし、Service Worker の Cache を経由させない。
- Service Worker の Cache 対象は version 付き JS / CSS / Icon / Manifest 等の公開静的 Asset だけ。SSR HTML、Server Function / API Response、401 / Redirect / Login Response、Cookie、個人データを Cache しない。

## UI/UX 方針

- **画面フロー / 導線**: Desktop は固定 Sidebar（Home / Inbox / Issues / Cycles / Projects / Views / Settings）、Mobile は Home / Inbox / Create / Search / Menu の下部 5 タブ。Issue は主要画面から `C` または Create tab で 2 操作以内に Composer を開き、保存後に一覧・URL・最近閲覧へ反映する。
- **主要操作とフィードバック**: Status / Priority / Project / Cycle / Label は List / Board / Detail から Inline edit または Dialog / Sheet で完了する。保存中は pending 表示、成功は通常表示、失敗は rollback + Error + Retry、Conflict は最新値取得 + 差分確認とする。
- **状態設計（出し分け）**:
  - 初期 / 入力中: Composer、Filter、Command menu は初期値・既定 Status・Keyboard hint を表示し、入力欄 Focus を維持する。
  - ローディング: Route 初回は Skeleton、追加取得は既存行を保持して行単位 Indicator。List / Board の layout shift を抑える。
  - 空（0 件）: Filter 条件、Saved View、Cycle、Inbox ごとに「0 件」と次の作成 / Filter 解除導線を表示する。
  - エラー: 401 は再認証、400 は field error、404 は Not Found、409 は Conflict、423 は Background Overlay、5xx / Timeout は Retry Card。エラーを色だけで伝えない。
  - 成功: Server response で pending 表示を消し、Toast は補助情報に限定して結果を画面本体へ反映する。
  - Background: `pending / running` はフルスクリーン Overlay で Pointer、Keyboard、業務 Route 変更を止める。読み取り、進捗、Logout、再認証は例外。`paused / failed` は Resume Card、`succeeded / rejected` は完了 / 失敗状態を示して Overlay を解除する。
- **既存デザインシステムとの整合**: Tailwind CSS + shadcn/ui（Base UI）の Button、Dialog、Sheet、Popover、Combobox、Toast、Table を再利用する。新規 Primitive は Rule of Three を満たすまで作らず、Status / Priority は色・アイコン・テキストの複数手段で表す。

### レスポンシブ / アクセシビリティ

- 対象端末は最新 2 世代の Chrome / Safari / Edge / Firefox と現行 iOS / Android ブラウザ。主ブレークポイントは Mobile `<=767px`、Tablet `768..1199px`、Desktop `>=1200px`。
- Desktop は固定 Sidebar、高密度 List / Board、Keyboard 中心、Issue Detail は Modal / Split view。Tablet は折りたたみ Sidebar、右 Sheet / Full screen、Touch Drag。Mobile は下部 5 タブ、1 列 List、Bottom Sheet / Full screen、横スクロール可能な Board とする。
- すべての必須操作を Pointer と Keyboard の双方で実行可能にする。Drag はハンドル / 長押しだけで開始し、Menu / Keyboard 操作を代替導線にする。Hover だけに必須操作を隠さない。
- タップ領域は原則 44×44 CSS px 以上、Bottom Sheet は Safe Area を考慮、Focus ring は常時識別可能にする。
- Dialog / Menu / Combobox / Tooltip は適切な ARIA、Focus trap、Escape、Focus return を持つ。選択状態・Status・Priority・エラーは色以外のテキスト / アイコン / 属性でも伝える。
- `prefers-reduced-motion` を尊重し、WCAG 2.2 AA を目標とする。axe 自動検査と Keyboard の主要 Journey を実行する。

## このレイヤーが依存する下位の契約

- [shared.md](./shared.md) の入力 / 出力 Schema、ErrorEnvelope、RunProgress、Filter / URL canonicalization。
- [service.md](./service.md) の Server Functions、Background Run HTTP、401 / 409 / 423 semantics。
- Service Worker からは公開静的 Asset の配信契約だけを利用し、D1 / Access の内部値を参照しない。

## 実装配置

- `src/routes/index.tsx`: Home
- `src/routes/issues/index.tsx` / `src/routes/issues/$issueId.tsx`
- `src/routes/cycles/index.tsx` / `src/routes/cycles/$cycleId.tsx`
- `src/routes/projects/index.tsx` / `src/routes/projects/$projectId.tsx`
- `src/routes/search.tsx`, `src/routes/inbox.tsx`, `src/routes/views.tsx`, `src/routes/trash.tsx`
- `src/routes/settings/$section.tsx`
- `src/components/layout/`: Sidebar、BottomNavigation、PageShell、DeepLink overlay
- `src/components/issues/`: Composer、List、Board、BulkBar、Detail、PropertyPicker、Relations、Notes、Activity
- `src/components/cycles/`, `src/components/projects/`, `src/components/views/`, `src/components/inbox/`
- `src/components/background/`: RunOverlay、RunProgress、ResumeCard
- `src/lib/query/`: Query key、Prefetch、Optimistic mutation、Retry policy
- `src/lib/auth/fetch.ts`: credential / 401 classifier / top-level reauth
- `src/lib/url-state/`: Filter / Group / Order / Layout の canonical search params
- `public/manifest.webmanifest`, `public/icons/`, `src/service-worker.ts`: 公開静的 Asset のみ Cache

TanStack Start の最終 Route ファイル規則は [questions.md](./questions.md) Q-1 の回答で確定する。上記は UI 契約を先に検討するための予定配置であり、回答前に実装を開始しない。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| 初回 Fetch 中 | Skeleton を表示し、既存 Route state がある場合は stale data を保持して layout shift を避ける。 |
| 401 | Offline / Timeout / 5xx と異なる Auth failure として扱い、現在 Deep link を保持して Top-level Access 再認証へ移る。 |
| 400 | fieldErrors を該当入力へ表示し、Composer / Dialog を閉じず、入力値を保持する。 |
| 404 | Issue / Project / Run の Not Found を画面全体へ漏らさず、安全な Not Found / current null を表示する。 |
| 409 | Optimistic state を確定せず、最新値を再取得して Conflict UI / Retry を表示する。 |
| 423 | Optimistic state を確定せず、Background Overlay を最前面にし、業務操作を抑止する。読み取り・進捗・Logout・再認証は使える。 |
| 500 / Timeout / Offline | snapshot へ rollback し、Error / Retry を表示する。選択、Focus、Scroll、URL state を保持する。 |
| Background `paused / failed` | Overlay を再開可能カードへ変更し、Resume 以外の業務 Mutation を再び許可しない。terminal で Overlay を解除する。 |
| Service Worker Cache miss / 401 response | Network へフォールバックし、401 / Redirect / Login Response を Cache Storage へ保存しない。 |

## テストケース（技法注記付き）

- [代表値] Desktop の `C`、Mobile の Create tab、Issue Composer の Enter 確定、TASK 番号描画、専用 URL Deep link を UI Integration で検証する。
- [状態遷移] Optimistic 表示 → 成功確定、Optimistic 表示 → 失敗 rollback → Error / Retry、409 Conflict、423 lock を検証し、選択・Focus・Scroll・URL が変わらないことを確認する。
- [同値分割 + 境界値] Mobile `767 / 768`、Tablet `1199 / 1200` px 境界で Sidebar / BottomNavigation / Sheet / Board の出し分けと横 overflow を検証する。
- [デシジョンテーブル] 401 / Offline / Timeout / 5xx を分類し、401 だけ Top-level Navigation、その他は Retry / Offline 表示とする。
- [状態遷移] Background `pending → running → succeeded`、`running → paused → running`、`running → failed → resume`、`rejected / succeeded` terminal の Overlay 表示を検証する。
- [同時実行 + 状態遷移] 同じ Run の current / continue / resume を別 Tab / 別端末の Query として動かし、同じ run_id、Step、cursor、進捗を表示し、古い cursor の結果で進捗を戻さないことを確認する。
- [代表値] `/current` null、本人 Run、他 Run 404、paused / failed continue 409、Lease 423 の wire response を UI の状態へ変換する。
- [アクセシビリティ] axe 検査、Keyboard の C / Cmd-Ctrl+K / Filter / Display options / List-Board / Selection / Escape、Dialog Focus trap、Focus return、Reduced motion を検証する。
- [タッチ] 44×44 px 操作領域、長押し Drag、Swipe の Menu 代替、Bottom Sheet Safe Area、Board 横スクロールを実機または Browser Touch emulation で検証する。
- [障害注入] Service Worker が SSR HTML / API / 401 / Login を Cache しないこと、認証後に同じ Deep link へ戻ることを standalone PWA Smoke で検証する。
- [性能] 1,000 Issue List の仮想スクロール、操作直後 100ms の Feedback、LCP p75 2.5 秒以下、INP p75 200ms 以下、Issue 作成 p95 1 秒を Preview で計測する。
