#!/usr/bin/env bash
# lefthook pre-commit — drift guard（条件付き実行ラッパ）
#
# 散文正本（risk-tiers.md / ai-dlc-flow SKILL.md）と JSON ミラー（tier-gate-map / stage-graph /
# scopes / tier-triggers）・verification/ 分離の同期を drift テストで検査する。
# lefthook 側の glob で「対象ファイルが staged の時だけ」呼ばれる（毎コミットのコスト増を回避）。
#
# fail した時: 正本を変えたならミラーを追随させる／ミラーだけ変えたなら差し戻す。
# フェイルセーフ: 依存未導入 / pnpm 不在なら黙って通す（無音死は doctor の検査対象）。
set -u

repo_root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
aidlc="$repo_root/.claude/aidlc"

[ -d "$aidlc/node_modules" ] || exit 0
command -v pnpm >/dev/null 2>&1 || exit 0

cd "$aidlc" && node --import tsx --test "src/drift/parse-rules.test.ts" "src/drift/mirrors.test.ts"
