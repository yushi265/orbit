#!/usr/bin/env bash
# PostToolUse(Edit|Write) hook
# 編集されたファイルを自動整形する。整形コマンドはプロジェクトの言語・ツールに合わせて調整する。
# 最終防衛線は lefthook(pre-commit) なので、ここでの失敗ではブロックせず常に exit 0。
#
# 下の case は例（Go=gofmt / JS・TS 系=prettier）。プロジェクトの整形ツールに置き換える。
set -u

input="$(cat)"

# Claude Code は tool_input.file_path に編集対象パスを渡す
file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"

[ -z "$file" ] && exit 0
[ ! -f "$file" ] && exit 0

case "$file" in
  *.go)
    command -v gofmt >/dev/null 2>&1 && gofmt -w "$file"
    ;;
  *.ts|*.tsx|*.js|*.mjs|*.json|*.yaml|*.yml)
    # prettier があれば整形（失敗しても止めない。最終防衛線は lefthook）
    repo_root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
    if command -v pnpm >/dev/null 2>&1 && [ -f "$repo_root/package.json" ]; then
      (cd "$repo_root" && pnpm exec prettier --write "$file" >/dev/null 2>&1) || true
    fi
    ;;
esac

exit 0
