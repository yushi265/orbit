---
name: aidlc-init
description: AI-DLC ハーネスを新しいプロジェクトに導入・初期設定する手順スキル。レイヤー構成・各レイヤーの言語/検証コマンド・品質ゲート（lint/format/secret検知）・高リスク要素（Tier1）・プロジェクト固有 sensor の要否を対話で聞き、engine の設定（referee.config / tier-triggers / sensors.manifest / scopes / spec-sections の LAYER_FILES）と lefthook / settings / format.sh / spec 雛形 / architecture を埋める。テンプレを新規プロジェクトに被せた直後、「/aidlc-init」「ハーネスを初期設定」「レイヤーや言語を設定」「ハーネスを init」と言われた時に使用する。
---

# AI-DLC ハーネス 初期設定（aidlc-init）

このテンプレートを自分のプロジェクトに被せた後、`.claude/README.md`「7. 導入時に差し替える箇所」を**対話で埋める**スキル。
プレースホルダ（`<...>`）の残った設定を、プロジェクトのレイヤー・言語・検証コマンドに合わせて確定する。

> **原則**: 各ファイルを埋めるだけ。AI-DLC の骨格（Stage/Gate/Tier/用語）と engine のロジックは変えない。
> 破壊的でない設定変更なので、最後に**まとめて人間へ提示して承認を得る**（1 回のゲート）。

## 0. 前提の確認（最初に 1 回）

```bash
pnpm -C .claude/aidlc install --ignore-workspace   # engine の依存導入（未導入なら）
pnpm -C .claude/aidlc doctor --fast                 # deps / hooks 配線の現状確認
```

- 既存プロジェクトに被せる場合は、まず `.claude/` `docs/` `lefthook.yml` `CLAUDE.md` `AGENTS.md` が配置済みか確認する。

## 1. 対話で構成を確定（AskUserQuestion）

次を順に聞く（項目が多いので 2〜4 問ずつに分ける。回答が非同期になりそうなら `docs/spec/_TEMPLATE/questions.md` の要領で一覧化してもよい）。**推測で埋めない**。

| 聞くこと | 選択肢の例 / 補足 |
|---|---|
| **A. レイヤー構成** | 単一レイヤー（CLI/ライブラリ）/ 2 層 / 3 層（例: `data` / `service` / `ui`）/ カスタム。→ **レイヤー名リストを確定**。表示層（UI）があるレイヤーはどれか（レスポンシブ検査の対象）。「1 機能をデータ層→表示層で縦に貫く」単位で考える |
| **B. 各レイヤーの検証コマンド** | レイヤーごとに「テスト」「型チェック（あれば）」の実コマンド（argv）。例: `["go","test","-race","./..."]` / `["npm","test"]` / `["pytest"]`。cwd（repo root 相対） |
| **C. 品質ゲート（pre-commit）** | lint コマンド / formatter（--check）/ secret 検知に `gitleaks` を使うか / Conventional Commits を強制するか（既定 ON） |
| **D. 編集時の自動整形** | 拡張子ごとの整形コマンド（例: `.go`→gofmt、`.ts`→prettier）。無ければスキップ可 |
| **E. 高リスク要素（Tier 1）** | Tier 1（事前承認必須）に該当する変更は何か（例: DB スキーマ / 認証・認可 / データ境界 / 公開 API）と、その**検出 glob + 内容パターン** |
| **F. プロジェクト固有 sensor** | プロジェクト固有のルールで機械化したい検査があるか（同梱は汎用 4 種のみ）。→ 足すなら `src/sensors/` に純粋関数を実装し `sensors.manifest.json` に登録する（不要なら何もしない） |
| **G. worker 層のモデル** | worker 層（implementer / Stage 2a の `Explore` 調査 / レビュアー 3 体）に使う下位モデル（既定 `sonnet`・さらに軽くするなら `haiku`）。レビュー報告は**オーケストレーターが監査してから採用する**前提（[ai-dlc-flow](../ai-dlc-flow/SKILL.md) の「モデル階層」）。節目監査の impl-auditor は `inherit` のまま推奨 |

## 2. 反映（対話結果で各ファイルを編集）

確定した内容で、次を埋める（プレースホルダ `<...>` を実値に）。

| ファイル | 反映内容 |
|---|---|
| `.claude/aidlc/referee.config.json` | **A/B** → `layers` に各レイヤーの `{cwd, command, precondition?}`、`post` に pre-commit（lefthook 使うなら維持・使わないなら削除） |
| `.claude/aidlc/src/sensors/spec-sections.ts` | **A** → `LAYER_FILES` を各レイヤーの `<layer>.md` の集合に、`UI_LAYER_FILES` を表示層の `.md` の集合に（複数表示層可・表示層が無ければレスポンシブ検査の行を削除）。**変更したら §3 でテストを追随**（下記注意） |
| `.claude/aidlc/tier-triggers.json` | **E** → `triggers` を高リスク要素の `{id, glob, contentPattern}` に。該当が無ければ空配列でよい。glob はブレース展開非対応（複数パスは同一 id の複数エントリに分ける）・ファイル全体が保護対象なら contentPattern は `.+` |
| `.claude/aidlc/sensors.manifest.json` + `src/sensors/dispatch.ts` | **F** → プロジェクト固有 sensor を足すなら **`src/sensors/<name>.ts`（純粋関数）+ `<name>.test.ts` を実装し、manifest のエントリ + dispatch の `registry` 登録を追加**（manifest と registry は双方向突合され、片方だけだと loud error）。**実 config を読む較正テストも追随**（§3）。不要なら何もしない |
| `.claude/aidlc/scopes.json` | **F** → セキュリティ規約を機械化する sensor を足したなら、その id を `security-patch` の `sensors` に列挙（無ければ空配列のまま） |
| `lefthook.yml` | **C/D** → コメントアウトの `lint` / `format-check` 例を実コマンドで有効化。`gitleaks` は使うなら維持・使わないなら削除。`aidlc-*`（anti-tamper/retro-surface/drift-check）と `conventional-commit` は維持推奨 |
| `.claude/settings.json` | **B/C** → `permissions.allow` にプロジェクトの安全な開発コマンド（テスト/lint/format/型チェック）を追加。`deny` は触らない |
| `.claude/hooks/format.sh` | **D** → `case` の整形コマンドをプロジェクトの言語・ツールに差し替え |
| `.claude/agents/`（worker 層） | **G** → implementer / レビュアー 3 体の frontmatter `model:` を選んだ下位モデルに（既定 `sonnet` のままなら変更不要）。impl-auditor の `inherit` は原則維持 |
| `docs/architecture.md` | **A** → レイヤー責務表・依存方向・モジュール入口を実構成で記述（雛形の枠を埋める） |
| `docs/spec/_TEMPLATE/_layer.md` | **A** → 冒頭のレイヤー例（`data/service/ui`）をプロジェクトのレイヤー名に更新（任意・説明の整合） |

- **anti-tamper / artifact guard のテストファイル判定**（`src/guard/artifacts.ts` の `TEST_FILE_PATTERN` / `src/autonomy/anti-tamper.ts` の `TEST_FILE`）は主要言語を既定でカバー。プロジェクトのテスト命名が特殊なら合わせて調整する。
- `tier-triggers.json` を書き換えたら、`src/drift/mirrors.test.ts` の `vocabulary`（トリガー id → risk-tiers.md Tier 1 対象セルの対応語）も追随させ、`risk-tiers.md` の Tier 1 記述と整合させる（drift guard が突合する）。

## 3. 検証（反映のたび / 最後に）

```bash
pnpm -C .claude/aidlc test        # engine テスト（LAYER_FILES 等を変えたら必ず green を確認）
pnpm -C .claude/aidlc typecheck   # 型チェック
pnpm -C .claude/aidlc doctor      # 自己診断（drift 同期・sensor 生存を含む）
```

- **注意（LAYER_FILES を変えた場合）**: `src/sensors/spec-sections.test.ts` は既定のレイヤー名（`service.md`/`ui.md`）でフィクスチャを持つ。レイヤー名を変えたら、このテストのフィクスチャ（spec ファイル名）も新しいレイヤー名に置換して `pnpm test` が green になることを確認する（テストを甘くするのではなく、レイヤー名変更に追随させる）。
- **注意（表示層が無い場合）**: `spec-sections.ts` のレスポンシブ検査行（`UI_LAYER_FILES.has(base) …`）と未使用になる `UI_LAYER_FILES` 定数を削除したら、`spec-sections.test.ts` の `ui.md` レスポンシブ 2 テストも撤去して `pnpm test` を green に戻す。表示層を追加した場合（`UI_LAYER_FILES` に 2 つ以上列挙）は、追加した各 `<layer>.md` のレスポンシブ検査テストも追加する。
- **注意（例 config を差し替えた場合）**: 次の3つは**実 config を読む較正テスト**がある。差し替えたら（テストを消すのではなく）プロジェクトの値へ**追随更新**して `pnpm test` を green にする:
  - `tier-triggers.json` → `src/sensors/tier-tripwire.test.ts` の実データ較正（トリガー id）
  - `scopes.json` の security-patch → `src/scopes/resolve.test.ts`
  - `sensors.manifest.json` の sensor 追加 / 除去 → `src/sensors/manifest.test.ts` の realManifest id 集合
- `referee.config.json` の各コマンドは、埋めた後に `pnpm -C .claude/aidlc referee-check --layer <name>` で 1 度実行し、`unavailable` でなく実際に走ることを確認する。
- **`pnpm test` だけでなく `pnpm typecheck` と `pnpm doctor` も必ず通す**（doctor CLI を読むテストは無いため、型/実行時の破綻は test だけでは捕まらない）。

## 4. 人間確認（Gate・最後に 1 回）

- 埋めた設定の要約（レイヤー / 各検証コマンド / 高リスク要素 / プロジェクト固有 sensor の有無 / lint・format）を提示する。
- `pnpm -C .claude/aidlc doctor` と `pnpm -C .claude/aidlc test` の結果を証跡として添える。
- 承認を得てからコミットする（コミット対象リストを提示・毎回）。以降は通常の [ai-dlc-flow](../ai-dlc-flow/SKILL.md) で実装を進める。

## 原則

- プレースホルダを埋めるだけ。engine のロジック・AI-DLC の骨格は変えない。
- 迷ったら安全側（該当が曖昧な高リスク要素は Tier 1 トリガーに入れておく・sensor は残置しておく）。
- 反映の各ステップで `pnpm -C .claude/aidlc test` を回し、engine を常に green に保つ。
