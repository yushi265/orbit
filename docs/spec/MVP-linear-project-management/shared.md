# MVP: 共有契約層 詳細設計

> `ui` と `service` の境界で共有する Zod Schema、公開型、列挙値、エラー Envelope、Background Run の JSON 契約の正本。D1 の内部 Schema や UI コンポーネントへ依存しない。

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: 本人が Issues で `C` → タイトル → Enter を行うと、Preview 環境で Enter 確定から Server 採番済み Issue が一覧へ描画されるまでの p95 が 1 秒以内であり、`TASK-123` 形式の Issue 番号が採番され、専用 URL で同じ Issue 詳細を開ける。
- **AC-3**: PC で変更した Issue の High priority がスマートフォンにも表示され、スマートフォンから Status を変更でき、タップ対象が重ならず横にはみ出さない。
- **AC-4**: Issue の Status 保存が失敗した場合、UI は変更前の Status へ戻り、エラー理由と再試行操作を表示し、他 Issue の選択と Scroll 位置を維持する。
- **AC-5**: standalone PWA で Access セッションが失効したとき、401 を Offline / Timeout / 5xx と区別し、現在 URL への Top-level Navigation で Access 再認証へ移り、再認証後に同じ Deep link へ戻り、認証応答と個人データを Service Worker に Cache しない。
- **AC-7**: 同じ Issue version を読んだ 2 つの Mutation を並行実行したとき、条件付き UPDATE に成功した 1 件だけが保存され、もう 1 件は 409 Conflict になり、Activity・Outbox event・Mutation receipt は勝者の 1 件だけ作成される。
- **AC-8**: 成功済み Issue Mutation を同じ `idempotencyKey` と同じ Request で再送すると初回と同じ Response を返し、Issue version・Activity・Outbox event・Mutation receipt は増えず、同じ Key で異なる Request を送ると 409 `IDEMPOTENCY_KEY_REUSED` になり業務データを更新しない。
- **AC-9**: Settings から Maintenance Run を起動すると 202 と `run_id` が返り、固定 schema 以外は 400、固定 3 Step は `cycle_transition` → `purge` → `outbox_retry` の順で処理され、異なる Key の同時起動は 1 件だけが受理されて他は 423、同じ Key・同じ Request の同時再送・応答紛失後の再送は同じ `run_id` に収束し、`rejected` Run は同じ Key で再起動しない。
- **AC-10**: Background Run が `running` の間、Issue・Cycle・Project・View・Settings 等の業務 Mutation は 423 `OPERATION_IN_PROGRESS` で拒否され、version・Activity・Outbox・Mutation receipt は増えず、読み取り・進捗取得・Run 継続 / 復旧・ログアウト・Access 再認証は許可され、再読み込み後も Overlay と別端末の同一 Run 状態が復元される。
- **AC-11**: Background Run の Heartbeat が途切れて Lease が期限切れになると Run は `paused` になり Lock が解放され、古い HTTP 処理の業務データ・進捗・Run 状態・Heartbeat・Lock 更新は拒否され、同じ Run を cursor 位置から再開でき、Lease 直前は有効・期限ちょうど以降は無効である。
- **AC-12**: `pending` または `running` の Run で Step が失敗すると Run は `failed`、失敗 Step 以降は `skipped` になり、完了済み Step と業務成果物を保持して Lock を解放し、`succeeded` / `rejected` から逆戻りせず、`failed` は同じ Run の resume で失敗箇所から再開できる。
- **AC-13**: 同じ Run・Step・cursor の HTTP Chunk が再送・同時実行されても業務効果は 1 回だけで、前 Step 未完了なら効果を発生させず、resume は同じ Run の Lease を更新し、成功済み Chunk を No-op とし、返却 cursor は同値または前進のみ、`user_id` 不一致・Run 不存在は 404、paused / failed の continue は 409 `RUN_REQUIRES_RESUME`、Lease 競合は 423 になる。

## このレイヤーが公開する契約（外部インターフェース）

### 列挙値

```ts
type Locale = 'ja' | 'en'
type Theme = 'light' | 'dark' | 'system'
type ColorTheme = 'coral' | 'ocean' | 'violet' | 'forest' | 'amber'
type Priority = 'no_priority' | 'low' | 'medium' | 'high' | 'urgent'
type Estimate = null | 1 | 2 | 3 | 5 | 8
type WorkflowCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
type ProjectStatusCategory = 'backlog' | 'planned' | 'in_progress' | 'completed' | 'canceled'
type CycleStatus = 'upcoming' | 'active' | 'completed'
type RunStatus = 'pending' | 'running' | 'paused' | 'failed' | 'succeeded' | 'rejected'
type RunStep = 'cycle_transition' | 'purge' | 'outbox_retry'
type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
```

列挙値は表示名ではなく wire value として固定する。表示名・色・翻訳は UI / User 設定で解決し、`status` と `category` を混同しない。

### 共通 Mutation / Error 契約

```ts
type MutationMeta = {
  idempotencyKey: string // 空でない opaque string。Key 自体は画面・ログへ出さない
  version?: number       // Issue の競合制御で必須
}

type ErrorEnvelope = {
  error: {
    code:
      | 'AUTH_REQUIRED'
      | 'VALIDATION_ERROR'
      | 'RESOURCE_NOT_FOUND'
      | 'ISSUE_VERSION_CONFLICT'
      | 'IDEMPOTENCY_KEY_REUSED'
      | 'OPERATION_IN_PROGRESS'
      | 'RUN_REQUIRES_RESUME'
      | 'BACKGROUND_RUN_REJECTED'
      | 'INTERNAL_ERROR'
    message: string
    fieldErrors?: Record<string, string[]>
    requestId: string
  }
}
```

HTTP status は `401 / 400 / 404 / 409 / 423 / 500` を Error code と一対一に対応させる。全 Response に `requestId` を含め、内部 Token・Cookie・Payload 本文を Error message とログへ含めない。

### Issue / View 契約

```ts
type CreateIssueInput = MutationMeta & {
  title: string // Unicode code point で 1..255
  descriptionJson?: TiptapDocument
  statusId?: string // 省略時は Owner の既定 Workflow state
  priority?: Priority
  estimate?: Estimate
  dueAt?: number | null
  projectId?: string | null
  cycleId?: string | null
  parentId?: string | null
  labelIds?: string[]
}

type UpdateIssueInput = MutationMeta & {
  id: string
  patch: Partial<Omit<CreateIssueInput, 'idempotencyKey' | 'version'>>
}

type IssueQuery = {
  mode: 'list' | 'board'
  filter: {
    statusIds?: string[]
    priorities?: Priority[]
    labelIds?: string[]
    projectIds?: string[]
    cycleIds?: string[]
    due?: 'none' | 'overdue' | 'today' | 'upcoming'
    created?: { from?: number; to?: number }
  }
  group?: 'status' | 'priority' | 'project' | 'cycle' | 'label'
  showEmptyGroups: boolean
  order: 'manual' | 'priority' | 'updated' | 'created' | 'due_at' | 'estimate'
  layout: Record<string, boolean>
  cursor?: string
  limit: number
}
```

`filter` は MVP では複数値を含む AND 条件だけを持つ。高度な AND / OR と入れ子条件は含めない。`layout` は個人既定値または Saved View の `layout_json` から作る。Pagination の cursor は Service が生成する opaque string であり、クライアントは比較・加工しない。

### Background Run 契約

```ts
type MaintenanceRunCreateInput = {
  kind: 'maintenance'
  idempotencyKey: string
}

type RunProgress = {
  current_step: RunStep | null
  step_index: number
  step_count: 3
  cursor: string | null
  processed: number
  total: number | null
  percent: number | null
}

type RunError = {
  code: string
  message: string
  failed_step: RunStep | null
  retryable: boolean
  request_id: string
}

type RunSummary = {
  run_id: string
  kind: 'maintenance'
  status: RunStatus
  progress: RunProgress
  error: RunError | null
  requested_at: number
  started_at: number | null
  heartbeat_at: number | null
  finished_at: number | null
  resume_count: number
  // lock_token / admission_token は含めない
}

type ContinueRunInput = MutationMeta & {
  expected_cursor: string | null
}

type ResumeRunInput = MutationMeta

type ContinueRunResponse = {
  run: RunSummary
  step: RunStep | null
  cursor: string | null
  processed_count: number
  next: 'continue' | 'resume' | 'none'
}
```

公開 HTTP 契約は次の通りとする。

| Method | Path | Request | Response / status | 認証・副作用 |
|---|---|---|---|---|
| POST | `/api/v1/background-runs` | `MaintenanceRunCreateInput` | 初回・既存 pending / running は `202` + `RunSummary`。既存 rejected は同じ `409 BACKGROUND_RUN_REJECTED` Response。 | Access 必須。異なる Key の Lock 競合は `423`。固定 schema 以外は `400`。 |
| GET | `/api/v1/background-runs/current` | なし | `{ run: RunSummary | null }`、本人の `pending / running / paused / failed` のみ | Lease を確認してから読み取る。本人外は存在を返さない。 |
| GET | `/api/v1/background-runs/:id` | なし | `{ run: RunSummary }` または `404` | `user_id` 一致を確認する。 |
| POST | `/api/v1/background-runs/:id/continue` | `ContinueRunInput` | `200` + `ContinueRunResponse` | 1 回の D1 `batch()` は 1 Chunk。古い cursor は現在進捗を返す。paused / failed は `409`。 |
| POST | `/api/v1/background-runs/:id/resume` | `ResumeRunInput` | `200` + `RunSummary` | `paused / failed` のみ。Lease を再取得し `resume_count + 1`。 |

同じ `idempotencyKey` の同じ `MaintenanceRunCreateInput` は既存 Run と同じ Response に収束する。Lock 競合で `rejected` になった Run の同じ Key は同じ `rejected` を返し、新しい Key だけを新規起動に使う。`continue` の業務効果は Key だけでなく `run_id + step + expected_cursor` と Effect dedupe で一度だけにする。

### HTTP 共通条件

- 非同期リクエストは `credentials: 'same-origin'` と `X-Requested-With: XMLHttpRequest` を付ける。
- `401` は Network Offline、Timeout、`5xx` と異なる分類値として扱う。
- Request hash は Operation 名と、`idempotencyKey` を除く Validation 済み Payload の Canonical JSON から生成する。Key の順序、既定値、空条件を正規化する。
- Cursor は opaque string。クライアント / Service の比較は cursor の文字列順ではなく、D1 の Step 状態・version・CAS 結果で行う。
- `progress_json` は `RunProgress`、`error_json` は `RunError` に適合し、Token を含めない。

## このレイヤーが依存する下位の契約

- なし。`shared` は `ui` と `service` の双方から利用されるが、Router、D1、Cloudflare Binding、React コンポーネントには依存しない。

## 実装配置

- `src/shared/contracts/enums.ts`: wire enum と公開型
- `src/shared/contracts/errors.ts`: ErrorEnvelope と Status / code map
- `src/shared/contracts/issues.ts`: Issue / Filter / View / Mutation Schema
- `src/shared/contracts/background-runs.ts`: Run / Step / progress / error Schema
- `src/shared/contracts/rich-text.ts`: Tiptap document の境界型
- `src/shared/canonical-json.ts`: Request hash 用の正規化（I/O なし）

Zod Schema は `service` の入口と `ui` の Response decode の双方で利用する。Schema を `data` の内部 DB 行へそのまま流用せず、DB row mapper は `service` または `data` 側で明示的に変換する。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| title / 日付 / Enum / cursor の不正 | `VALIDATION_ERROR` と fieldErrors を作る。入力値全体・Token はログへ出さない。 |
| 401 / Offline / Timeout / 5xx | Error code と Transport failure を別型にする。`AUTH_REQUIRED` だけを再認証へ流す。 |
| Response の未知 enum / progress 形状 | Decode 失敗として `INTERNAL_ERROR` 相当の安全な表示へ変換し、Token を含む raw Response は保存しない。 |
| 同じ Key の異なる Request | `IDEMPOTENCY_KEY_REUSED` を返し、Key / hash はユーザー向け message に含めない。 |
| cursor の再送 | 現在の `ContinueRunResponse` を返す扱いとし、cursor を Client 側で書き換えない。 |
| `lock_token` / `admission_token` が応答に現れる | Contract decode / Security test で失敗させ、Service の公開処理から除外する。 |

## テストケース（技法注記付き）

- [同値分割 + 境界値] title `0 / 1 / 255 / 256` 文字、estimate 許可値 / 不許可値、Cycle / Run の Enum 値を Schema が正しく受け入れ・拒否する。
- [デシジョンテーブル] HTTP `401 / Offline / Timeout / 5xx` を分類し、401 だけが `AUTH_REQUIRED` になる。
- [代表値] ErrorEnvelope の各 code が指定 HTTP status、requestId、任意 fieldErrors へ変換される。
- [代表値 + 状態遷移] `RunProgress` の `current_step / step_index / step_count / cursor / processed / total / percent` を encode / decode し、Token を含む入力を拒否する。
- [状態遷移] Run と Step の terminal / resume 可能状態を Schema の union と Service mapper が同じ意味で扱う。
- [代表値] Filter の複数条件を AND として正規化し、URL / Saved View の同一条件が同じ Canonical JSON になる。
- [同値分割] 同一 Mutation payload の Key 順・既定値・空条件の違いが同じ request hash になり、意味の異なる payload は異なる hash になる。
- [契約] Background API の初回起動、current null、本人外 404、paused continue 409、Lease 競合 423、terminal response を wire format として検証する。
- [セキュリティ境界] `lock_token`、`admission_token`、Access Cookie、メールアドレス、Issue 本文が ErrorEnvelope / RunSummary / progress JSON へ混入しない。
