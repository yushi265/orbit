#!/usr/bin/env bash
# Codex PostToolUse(apply_patch) の payload を、Claude Code hook が期待する
# tool_input.file_path 形式へ変換する薄いアダプター。処理の正本は第1引数の hook。
# 不正・未知 payload、抽出対象なし、削除済みパスは既存 hook と同じく fail-open で無音通過する。
set -uo pipefail

target="${1:-}"
input="$(cat)"
repo_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

[ -n "$target" ] || exit 0
[ -f "$target" ] || exit 0

{
  printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null
  printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null \
    | sed -nE \
        -e 's/^\*\*\* (Add|Update|Delete) File: (.*)$/\2/p' \
        -e 's/^\*\*\* Move to: (.*)$/\1/p'
} | awk 'NF && !seen[$0]++' | {
  status=0
  while IFS= read -r file; do
    case "$file" in
      /*) normalized="$file" ;;
      *) normalized="$repo_root/$file" ;;
    esac
    [ -f "$normalized" ] || continue
    jq -cn --arg file "$normalized" '{tool_input:{file_path:$file}}' \
      | CLAUDE_PROJECT_DIR="$repo_root" bash "$target"
    code=$?
    [ "$code" -eq 0 ] || status="$code"
  done
  exit "$status"
}
