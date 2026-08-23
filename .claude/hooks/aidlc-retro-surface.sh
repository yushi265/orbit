#!/usr/bin/env bash
# pre-commit hook（lefthook 経由）— retro-surface の着火自動化（advisory）
#
# staged 差分に retro note（docs/ai-dlc/retro/*.md）の新規/変更が含まれるとき＝ボルトの Gate 3 相当で、
# learnings surface（未対応 Try + カテゴリ再発）を自動発火して提示する。retro note をコミットする瞬間
# （= Gate 3）に自動で着火し、人間採否 → persist の入口を逃さない（手動だと着火がドロップしやすいため）。
#
# advisory: 提示のみ・commit はブロックしない（常に exit 0）。採否と persist は人間が行う。
# retro note を含まないコミット・環境未整備なら無音で exit 0。
set -u

repo_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
aidlc="$repo_root/.claude/aidlc"

# フェイルセーフ: 依存未導入 / pnpm 不在なら黙って通す。
[ -d "$aidlc/node_modules" ] || exit 0
command -v pnpm >/dev/null 2>&1 || exit 0

# staged に retro note（_TEMPLATE.md / README.md を除く）の追加/変更があるか。
touched="$(git -C "$repo_root" diff --cached --name-only -- 'docs/ai-dlc/retro/*.md' 2>/dev/null \
  | grep -vE '/(README|_TEMPLATE)\.md$' || true)"
[ -z "$touched" ] && exit 0

{
  echo "[aidlc:retro-surface 自動着火] retro note をコミットします（= Gate 3）。学び候補を surface します（advisory）:"
  pnpm -s -C "$aidlc" learnings 2>&1 || true
  echo "→ 採用する候補があれば conflict-check（code-reviewer）後に 'pnpm -C .claude/aidlc learnings persist \"<entry>\"' で docs/ai-dlc/learnings.md へ追記してください。"
} >&2
exit 0
