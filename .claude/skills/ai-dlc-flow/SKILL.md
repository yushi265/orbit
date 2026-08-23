---
name: ai-dlc-flow
description: 要件整理からコミットまで、機能実装を AI 主導 + 人間承認ゲートの短サイクルで進める開発ライフサイクル（AI-DLC）手順。新機能・修正の実装依頼を受けた時、複数レイヤーにまたがる縦切り実装を始める時、進め方の全体像を確認したい時に使用する。
---

# AI-DLC 実装フロー（単一適応フロー）

全タスクが同じフローに入る。冒頭の**Stage 宣言**で実行/スキップを決め、各 Stage の詳細度を複雑さに適応させる。🔓条件付き Stage のみスキップ可・🔒必須 Stage は破れない。

> 用語（ビジネスインテント / BC / ユニット（Unit of Work）/ ボルト / ステージ / ゲート / Tier / SSoT）は [glossary.md](../../../docs/ai-dlc/glossary.md) が正本。

```
0+1. Stage 宣言＋要件整理 …【Gate 1: Tier 1/2 承認・Tier 3 は宣言のみ】
2.   design doc 作成（create-spec）…【Gate 2: spec 承認・条件付き・Gate 1 で委任可】← 以降この doc が契約
3+4. TDD（RED → GREEN → REFACTOR）※レイヤー並列
5.   静的解析・フォーマッター
6.   セルフレビュー（self-review）
8.   成果提示 ──【Gate 3: コミット承認】
```

## 責務分界（オーケストレーター / サブエージェント）

メインループは**オーケストレーター**として「指示・検証・人間ゲート・状態管理・契約確定」に専念し、**実作業はサブエージェントへ委譲**する（可能な限り並列）。

| メインループ（保持する責務） | サブエージェント（委譲する実作業） |
|---|---|
| 人間ゲート運用（Gate 1/2/3・AskUserQuestion） | 既存実装調査（リバースエンジニアリング・Stage 2a） |
| タスク分解・サブエージェントへの指示／コンテキスト配布 | テストコード実装（RED・Stage 3） |
| レイヤー間 IF 契約の**確定**（Stage 2b） | 本実装（GREEN→REFACTOR・Stage 4） |
| 品質ゲートの**再実行による検証**（Stage 5） | 変更レビュー（**code-reviewer / spec-conformance-reviewer / test-quality-reviewer の 3 体並列**・Stage 6） |
| 状態管理（progress.md・Stage 遷移・ティア判定） | |
| レビュー報告の監査（裏取り・抜き取り・裁定） | |
| Must 解消ループの回し・統合判断 | |

- メインループが実作業を持つ例外は 2 つ: **契約の確定**（後段の検証基準）と**ゲート再実行**（証跡の独立性）。
- 並列起動は**1 メッセージで複数サブエージェント**（Workflow ツールは opt-in。人間ゲートを挟むため非デフォルト）。
- 「可能な限り並列」は**ゲートのない fan-out 区間内**を指す。直列バリア（人間ゲート / RED→GREEN / 契約確定→並列実装 / codegen 依存）は保持する。

### モデル階層（オーケストレーター型）

責務分界はモデルの階層割り当てとセットで機能する。**上位モデルが割り振り・契約・監査を持ち、下位モデルが実作業を実行して返す**。サブエージェントの使用モデルは各エージェント定義の frontmatter `model:` が単一ソース（[README](../../README.md)）。

| 層 | 担い手 | モデル | 根拠 |
|---|---|---|---|
| オーケストレーター | メインループ | 上位モデル（＝会話モデル。ユーザーが選択） | 割り振り・契約確定・受領検査・**レビュー報告の監査**（[self-review](../self-review/SKILL.md)）・権威検証・人間ゲートは判断密度が最も高い |
| worker 層 | implementer（Stage 3+4）・`Explore` 調査（Stage 2a）・**レビュアー 3 体**（code / spec-conformance / test-quality・Stage 6） | 下位モデル（既定 `sonnet`。`Explore` は起動時に `model` 指定） | spec・観点表を契約とする定型化された実作業。出力はオーケストレーターの監査を通ってから採用される |
| 節目監査 | impl-auditor | `inherit`（＝オーケストレーターと同格） | 節目の全体監査は判断密度が高く実行頻度が低い（コスト影響小） |

- 原則: **worker の出力を無監査で採用しない**。実装は受領検査（checkreturn・「原則」節）+ referee-check（Stage 5）+ レビュー 3 体で、レビュー報告そのものはオーケストレーター監査（受領検査 + 指摘の裏取り + 「問題なし」の抜き取り + 未確認範囲の裁定: [self-review](../self-review/SKILL.md)）で捕捉する。**監査の最終責任は常に上位モデル側にある**。
- worker 層のモデルは [aidlc-init](../aidlc-init/SKILL.md) で調整できる（コストと品質のトレードオフ・プロジェクト判断）。オーケストレーターより上のモデルは指定できないため、上位モデル運用の前提はメイン会話のモデル選択が担う。

## 必須 Stage と条件付きスキップ基準（最重要）

「品質は人間の注意力ではなく**仕組み**で担保する」。🔒必須 Stage はどんなに軽いタスクでもスキップできない最低保証ライン。🔓条件付き Stage は基準を満たす時**だけ**スキップ可。

| Stage | 区分 | スキップ基準 |
|-------|------|-------------|
| 0+1 Stage 宣言＋要件整理 | 🔒必須 | 深さのみ適応（trivial=最小確認） |
| 2 spec 作成 | 🔓条件付き | spec の要否はリスクティア（[risk-tiers.md](../../rules/risk-tiers.md)）と [spec-driven.md](../../rules/spec-driven.md) の「spec 省略の条件」（4 条件）で判定する（本文はそちらが正本）。Tier 1=必須 / Tier 2=4 条件充足時のみスキップ可 / Tier 3=不要 |
| 3+4 TDD（RED→GREEN→REFACTOR） | 🔒必須 | コード挙動変更があるならスキップ不可・常に test-first（後追い禁止）。Tier 3 の「挙動変更なし」（typo / コメント / doc / フォーマットのみ）はテスト不要・N/A 根拠を Stage 宣言に明記。詳細は [testing.md](../../rules/testing.md) |
| 5 静的解析・フォーマッター | 🔒必須 | — |
| 6 セルフレビュー | 🔒必須 | 深さのみ適応（AI 実行で安価。スコープ逸脱検査が効く） |
| 8 成果提示＋コミットゲート | 🔒必須 | — |

- 必須 Stage の大半は既存ルールが担保する: TDD=[testing.md](../../rules/testing.md) / コミットゲート=[task-and-pr.md](../../rules/task-and-pr.md) と `.claude/settings.json` の `ask`。Stage 宣言はこれらを上書きしない。
- spec をスキップする場合、**Tier 2** は [spec-driven.md](../../rules/spec-driven.md) の「spec 省略の条件」（4 条件）の充足を宣言の理由欄に明記する。**Tier 3** はティア判定根拠の明記のみでよい（4 条件判定は不要）。

## 適応的深さ

実行と決めた Stage の成果物は省略しない。**詳細度**だけ複雑さに合わせる（trivial を膨らませない・複雑を薄く済ませない）。例: 要件整理は trivial なら確定事項一覧のみ、複雑なら未決事項の往復まで。

## 人間ゲート（リスクティア連動）

ゲートの深さは Stage 宣言で判定する**リスクティア**（[risk-tiers.md](../../rules/risk-tiers.md)）で決まる。

| ゲート | 内容 | 適用条件 |
|---|---|---|
| Gate 1 | 要件＋Stage 宣言の承認 | Tier 1/2 はブロッキング・Tier 3 は宣言のみ（Gate 3 で事後確認） |
| Gate 2 | spec 承認 | Stage 2 を実行する時のみ。**Gate 1 で明示委任時は承認待ちなし**（要点サマリ提示のみ・Gate 3 で事後確認。[risk-tiers.md](../../rules/risk-tiers.md) の「Gate 2 委任」） |
| Gate 3 | コミット対象の承認 | 常時ブロッキング（全ティア共通） |

## progress.md による中断 → 再開

進行状態（Stage 宣言・ゲート承認状態・現在位置・実装タスク計画）は `docs/spec/<TICKET>-*/progress.md` に置く（雛形: `docs/spec/_TEMPLATE/progress.md`）。

**再開時（セッション断・コンパクション後）は次の順で読む**（「成果物が先、経緯は後」）:

1. `docs/spec/<TICKET>-*/index.md` の AC・スコープ外 … 契約（何を作るか）
2. 同 `progress.md` … 現在位置・ゲート承認状態・実装タスク台帳
3. `.claude/aidlc/state/<TICKET>.md`（あれば） … 機械 state・audit（時系列）
4. `git status` / `git diff --stat` … 実作業の現況（申告でなく実物）
5. `docs/ai-dlc/retro/<TICKET>.md`（あれば） … 直近の判断・罠

- 各段階で読んだ内容が食い違ったら**実物（git / ディスク）を正**とし、progress.md を直してから先へ進む。
- spec を実行しないボルト（1・2 が無い）は 3 以降から読む。AC は `index.md` が正本・session 内の細粒度タスクは TodoWrite。

> **任意（advisory）**: 機械可読 state ミラーが要るなら `report` CLI（[`.claude/aidlc/src/state/`](../../aidlc/src/state/README.md)）で Stage/Gate 遷移を audit ログ付きで記録できる（`next` の助言ループを閉じる）。**progress.md と並走**する補助で、本フローの正本・必須は progress.md のまま（Gate 強制はしない）。
> ボルトを**意図的に中断**する時は `report <state> park` で正規中断を宣言する（再開は `unpark`）。Stop guard（進行中ボルトの放置ターン終了を観測する仕組み）が「進行中ボルトの放置ターン終了」と「park による正規中断」を区別する判定材料になる。

### ライフサイクル

| イベント | いつ・何をするか |
|---------|----------------|
| 作成 | Stage 0 で `docs/spec/<TICKET>-*/progress.md` として scaffold し、Stage 宣言を記録する。spec を実行する場合のみ（spec をスキップしたボルトでは作らない） |
| 更新 | 各 Stage の完了時・Gate 通過時・中断時に本ファイル（現在位置・ゲートチェック・タスク状態）を更新し、コミットして再開と PR 可視化に使う |
| 除去 | Gate 3 承認後・merge 前に**除去**する（削除をコミットに含める）。足場であり成果物ではないので、merge 時点でリポジトリに存在しないこと（main に残さない） |

## ボルト内学習と振り返り（retro note）

- 進行状態（`progress.md`）と**学習（retro note）を分離**: ボルト内の気づき・摩擦・想定外は retro note （`docs/ai-dlc/retro/<TICKET>.md`）の「各 Stage の気づき」表に notable なものだけ追記する。
- 正本は [`retro/README.md`](../../../docs/ai-dlc/retro/README.md)（書き方・ライフサイクル）と [`retro-triage`](../retro-triage/SKILL.md)（棚卸し手順）。
- Stage 8 で KPT に蒸留する。spec を実行しないボルト（spec スキップ時）では retro note を作らない（v1）。

## 各 Stage の手順

### 0+1. Stage 宣言＋要件整理【Gate 1（要件承認）】

- **チケット取り込み（最初の一手）**: タスクにチケット（例: Jira 等のチケット管理システム）が紐づく場合、まず `import-ticket` スキルで
  チケット本文・AC を取得し、要件整理の入力にする（チケットキー → `docs/spec/<TICKET>-*/`・ブランチ名）。
  **チケットが要件の源泉、spec はそこから導く契約**。チケットレスの場合はティア判定に従い、必要なら番号発行を人間に促す。
- ユーザー入力の要件・設計判断を精査し、確定事項と未決事項を仕分ける。
- 未決事項は推測で埋めない。解消手段は**質問の量と同期性**で使い分ける:

| 状況 | 手段 |
|---|---|
| その場で答えられる単純な選択 1〜3 個 | AskUserQuestion（選択肢 + 推奨案を添える・現行どおり） |
| 4 個以上 / 持ち帰り・調査が要る / 回答が非同期になりそう | `docs/spec/<TICKET>-*/questions.md`（雛形: [`_TEMPLATE/questions.md`](../../../docs/spec/_TEMPLATE/questions.md)）に列挙。人間はファイル直接編集 / チャットのどちらで回答してもよい（どちらも AI がファイルへ収束させる） |
| AskUserQuestion で答えた内容 | AI が questions.md へ転記（UI → ファイルの片方向・記録の一元化） |

  - 空 `[Answer]:` が残る Q は「回答待ち」（Stop guard の機械判定材料）。回答確定分は index.md「判断根拠 / 未決事項」へ転記して該当 Q を消し込む。**Gate 2 提示時に空 `[Answer]:` が残っていたら Gate 2 に進めない**（未決のまま契約を固めない）。questions.md は揮発物（progress.md と同扱い・Gate 3 までに除去）。
- **表示層（UI）が関与する場合は UI/UX も必ず確認する**: 主要画面・主要操作・状態の出し分け（初期 / ローディング / 空 / エラー / 成功）・既存デザインシステムとの整合・**レスポンシブ対応方針（対象端末 / 主対象ブレークポイント / タブレット崩れ許容度 / スマホ方針）**。未確定は AskUserQuestion で解消し、確定内容は Stage 2 で表示層の spec（例: `ui.md`）の「UI/UX 方針」と「レスポンシブ / アクセシビリティ」に記録する。
- 変更コストが高い判断（データスキーマ・API 仕様・認証/認可・権限体系など）は必ずここで確定させる。
- **Stage 宣言**: 上表に従い 7 Stage の実行/スキップ＋理由を提示する（🔒必須は実行固定）。spec をスキップする場合は基準充足を理由欄に明記。
- **リスクティア判定**（[risk-tiers.md](../../rules/risk-tiers.md)）を Stage 宣言に含める。判定根拠（該当行）を 1 行で明記する（これが Gate の深さを決める）。
- spec を実行する場合は `progress.md` を scaffold し、宣言内容を記録する（create-spec が行う）。
- spec を実行する場合は `docs/ai-dlc/retro/<TICKET>.md` を `_TEMPLATE.md` から scaffold し、メタを埋める。
- **retro note 棚卸しトリガーの確認**: [retro/README.md](../../../docs/ai-dlc/retro/README.md) の一覧と実施記録から件数・経過日数を算出。トリガー（3 件 or 1 か月）達成時のみ [`retro-triage`](../retro-triage/SKILL.md) の実施を人間に促す（AI が勝手に始めない・Tier 1/2 は Gate 1・Tier 3 は Gate 3 で）。
- **Tier 1/2**: 要件の確定と Stage 宣言の両方を人間に承認してもらう。**Tier 3**: 宣言（ティア判定根拠含む）を提示して進行可（承認待ち不要・Gate 3 で事後確認）。
- **spec を実行するボルトでは、Gate 2 委任（[risk-tiers.md](../../rules/risk-tiers.md)）の選択肢を Gate 1 で中立に提示する**（「非委任（デフォルト・spec 承認を待つ）/ 委任（要点サマリ提示のみで進み Gate 3 で事後確認）」の 2 択。**AI から委任を勧めない**・依頼文で事前指定があってもここで人間の確認を通す）。委任が選ばれたら宣言に記録し、engine 使用時は `report <state> gate-delegate gate2` を打つ。

### 2. design doc 作成【Gate 2（spec 承認・条件付き）】

> Stage 宣言で spec を**スキップした場合はこの Stage ごと省略**。Gate 2 も無い。

本 Stage は [`create-spec`](../create-spec/SKILL.md) スキルに従い、2 フェーズで進める:

- **2a 既存実装調査（並列・委譲）**: `Explore` サブエージェントを**1 メッセージで複数起動**（read-only・ドメイン単位・worker 層の下位モデルを起動時に指定〔「モデル階層」節〕）。委譲プロンプトに **`docs/ai-dlc/codekb/` の該当ファイルを添付**し、「codekb の記述は仮説・`参照:` パスの実在確認必須・調査は codekb に無い部分と鮮度が怪しい部分の差分に絞る」を定型で課す。各自が担当範囲の「再利用できるもの / 差分 / 衝突 / 依存」を構造化して返す。メインループは結果を統合する。
- **2b 契約確定（メインループ）**: 統合した結果からレイヤー間 IF（データスキーマ / API 入出力契約 / ルーティング等、プロジェクトのレイヤー構成に応じた具体値）を**確定**し、AC・テストケース導出・実装タスク計画・spec ファイル執筆まで一気通貫で行う（契約決定と地続きのため委譲しない）。契約を確定する**前に、`docs/ai-dlc/codekb/` の既知の罠を契約執筆者自身が照合**する（2a の委譲プロンプトへの添付だけでは統合時に落ちる。[create-spec](../create-spec/SKILL.md) 手順 3.5）。
- **表示層（UI）関与時**は表示層 spec（例: `ui.md`）に UI/UX 方針（Stage 1 で確認した状態設計）を書く。UI の不確実性が高ければ画面モックで合意してから契約を固める（モックは設計合意用・実装は合意後 test-first）。
- **（非trivial時）実装タスク計画を `progress.md` に作る**（順序付きタスク × レイヤー × カバーAC × 依存）。これは**実装の段取り**（ボルトの順序）であり、**PR の単位は固定しない**（Gate 3 で人間が決める。[task-and-pr.md](../../rules/task-and-pr.md)）。
- 要点サマリ（契約の具体値 + Why + UI/UX 方針 + テストケース一覧）を提示して Gate 2 承認を得る。以降この doc が契約。**乖離が必要になったら doc を先に更新**して報告する。
- **Gate 2 委任時**（Gate 1 でオプトイン済み）: 同じ要点サマリを**必ず提示**したうえで、承認を待たずに Stage 3+4 へ進む（doc が契約であること・乖離時の doc 先行更新は不変）。事後確認は Stage 8 で受ける（[risk-tiers.md](../../rules/risk-tiers.md)）。

### 3+4. TDD（RED → GREEN → REFACTOR）

- [tdd-cycle](../tdd-cycle/SKILL.md) スキルに従う。
- レイヤー別サブエージェント（プロジェクトの各レイヤー）を**並列**起動。各自が「スキャフォールド + 契約テスト + RED 確認 → GREEN → REFACTOR」を一連で実施する（コンテキスト継続）。
- 委譲プロンプトに「**RED 出力はテスト追加直後に `progress.md`（学習メモ）へ即時記録する**」を定型で含める（報告前にサブエージェントが落ちても test-first の証跡が残る）。
- レイヤー間で共有する契約物（例: API スキーマ・共有型）は、並列化の前にメインループ側で確定配置する。
- 完了条件: 全レイヤーで RED 証跡 → 全テスト green + カバレッジ確認（80%+ 目安）。テストを実装に合わせて甘くしない。乖離が出たら spec に立ち返る。

### 5. 静的解析・フォーマッター

- エージェントの自己申告を鵜呑みにせず、**メインループから全ゲートを再実行して証跡を取る**。
  再実行は `referee-check`（複数コマンド手打ちの実行漏れ防止）に集約する:
  - `pnpm -C .claude/aidlc referee-check`（既定 `--layer all` = 各レイヤーのテスト・型チェックを実行し、最後に `git add` 済みの状態で `npx lefthook run pre-commit`〔lint・フォーマッタ・`gitleaks` による secret 検知はここが担う〕。実行するコマンドはプロジェクトの `referee.config.json` に定義する）
  - **exit 0 の集合だけが権威 green**（コマンド不在の層は unavailable = 総合 green を名乗らない）。単層のみのボルトは `--layer <name>` で絞ってよい。`--state state/<TICKET>.md` を付けると判定を audit に記録する
  - `.claude/aidlc` 自体を変更したボルトは `pnpm -C .claude/aidlc test` / `typecheck` も実行する（referee.config の対象外）
- 生成物・既存の未整形ファイルは ignore 設定で除外し、担当範囲外の整形巻き込みをしない。

### 6. セルフレビュー

- [self-review](../self-review/SKILL.md) スキルに従う（観点別 3 体（code / spec-conformance / test-quality）を**並列**委譲し、報告を**オーケストレーター監査**（受領検査 + 裏取り + 抜き取り）に通してから Must ゼロまで解消ループを回す。起動と監査の詳細は self-review/SKILL.md を参照）。

### 8. 成果提示【Gate 3（コミット承認）】

- **成果提示の冒頭で [`bolt-replay`](../bolt-replay/SKILL.md) を 1 回流す**（read-only）: 経緯の時系列叙述（数字は機械ソース verbatim・創作禁止・15 行以内）を承認者の審査材料に添える。
- AC ごとの達成状況・証跡（テスト数 / ゲート結果）と申し送り事項を報告する。
- **（engine state 使用時）** `report <state> stage-done 8` が出力する **artifact guard の証跡チェックリスト表**（advisory）を成果提示に添付する（spec ファイル・テスト増分・progress.md 除去の機械検証結果を人間の審査材料にする）。あわせて `report <state> summary` の**コストレポート表**（Stage 消化 / gate 往復 / トークン転記の機械集計）も添付する。トークンは `report <state> note tokens=<n>` でボルト末に 1 回転記しておく（`/cost` 相当値・LLM に数えさせない）。
- **Tier 3 はここで Stage 宣言とティア判定根拠を再提示し、事後確認を受ける**（Gate 1 を宣言のみで通過した分の確認）。
- **Gate 2 委任ボルトは、spec 要点サマリ（委任後に doc を改訂した場合はその差分含む）を再提示し、実装とまとめて事後確認を受ける**（Tier 3 の Gate 1 再提示と同じ位置・同じ型）。engine 使用時は承認記録を `gate-approve gate2` → `gate-approve gate3` の順で打ち、委任分の承認を audit に残す。
- **retro note の振り返りを蒸留する**: 各 Stage の気づき**と progress.md の学習メモ**を材料に KPT（Keep / Problem / Try）をまとめ、各 Try を還流先（`docs/ai-dlc/retro/README.md` の表）へ割り付ける。Problem には分類タグ `[カテゴリ]` を付ける（効果測定の集計キー）。
- **retro-surface（per-bolt 学び候補の提示）**: KPT 蒸留の直後に `pnpm -C .claude/aidlc learnings` を実行し（advisory）、出力（未対応 Try・カテゴリ再発）から**このボルトの notable な学び候補を最大 3 件**に絞って提示する。**候補ゼロのボルトは無音でスキップ**（Gate 3 を重くしない）。人間がその場で採否（judge）し、**採用分のみ** `docs/ai-dlc/learnings.md`（未昇格の経験則・機械追記専用）へ追記する（日付・`[category]`・還流先候補・出典 note を含む。フォーマットは [`learnings.md`](../../../docs/ai-dlc/learnings.md) 冒頭）。**追記手順**: ① **conflict-check** — `code-reviewer` を起動し、採用候補と既存 `.claude/rules/*.md` の矛盾を照合する。矛盾があれば追記せずその場で人間にエスカレーション（「既存ルール X と衝突。どちらを採るか」・迷ったら安全側＝エスカレーション）。② 矛盾なしなら `pnpm -C .claude/aidlc learnings persist "<entry 行>"` で **dedup 追記**（同一観察は冪等にスキップ）。**正式 rule への昇格・剪定は per-bolt ではやらず、定期 [`retro-triage`](../retro-triage/SKILL.md)（人間トリガ）に委ねる**（二段昇格）。spec を実行しないボルト（retro note なし）では N/A。
- コミットは**対象ファイルリストを提示して人間の承認を得てから**実行する（毎回）。push も同様。
- **codekb 差分追記**: このボルトで判明した新 API・新スキーマ・新部品・新しい罠を `docs/ai-dlc/codekb/` の該当ファイルへ追記し、`最終更新` を書き換えて**実装と同一コミット**に含める（対象外なら N/A・spec 更新と同じ扱い）。
- `progress.md`・`questions.md` を**除去**してからコミット対象に含める（main に揮発物を残さない。questions.md の確定内容は index.md へ転記済みであること）。**retro note（`docs/ai-dlc/retro/<TICKET>.md`）は残し**、コミット対象に含める（永続の学習資産）。

> 節目（大きな区切り）では [`impl-audit`](../impl-audit/SKILL.md) で全体監査レポートを作成する（毎ボルトでは行わない。diff レビューは self-review）。

## 原則

- Stage を勝手にスキップしない。スキップは**Stage 宣言した🔓条件付き Stage のみ**。「完了の証跡」を残してから次へ。
- **品質ゲートを緩める「プロトタイプモード」は設けない**。技術検証スパイクはハーネス**外**の scratch ブランチで行い、本採用時は本フローで test-first で作り直す。
- サブエージェントには「対象レイヤーの規約・docs 必読」「spec 逸脱禁止」「担当範囲外変更禁止」を必ず課す。
- **受領検査と縮小リトライ**: サブエージェント返答はメインループが受領検査する（implementer は `pnpm -C .claude/aidlc checkreturn implementer-v1`・スキーマは `return-schemas.json`）。
  1. 返答が malformed（必須見出し欠落・自己矛盾）or タスク未完 → 成果は採用しない。
  2. 再委譲は **1 回だけ**・入力は必須分に縮小（spec 該当節 + 失敗箇所の指摘のみ。全 docs を再読ませない）。
  3. 2 回目も失敗 → 人間へエスカレーション（同じ委譲を 3 回投げない）。
  4. 受領検査の結果（malformed 発生回数）は retro note の材料（フローの学び）。
- 横断ルール（`.claude/rules/`）と各レイヤー規約が常に優先。spec で上書きしない。
