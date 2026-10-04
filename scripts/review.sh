#!/bin/sh
# 커밋되지 않은 변경을 독립 리뷰어 한 명에게 맡긴다. 절차는 AGENTS.md "코드 리뷰 절차" 참고.
# 사용법: scripts/review.sh codex|claude ["이번 작업 설명과 이전 회차에서 기각한 지적"]
set -eu
cd "$(dirname "$0")/.."
reviewer="${1:-}"
context="${2:-}"
prompt="$(cat scripts/review-prompt.md)"
if [ -n "$context" ]; then
  prompt="$prompt

## 작업자가 전달한 맥락

$context"
fi
case "$reviewer" in
  codex)
    exec codex exec --sandbox read-only "$prompt"
    ;;
  claude)
    exec claude -p "$prompt" --allowedTools "Read" "Grep" "Glob" \
      "Bash(git status:*)" "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" \
      --disallowedTools "Edit" "Write" "NotebookEdit"
    ;;
  *)
    echo "usage: scripts/review.sh codex|claude [context]" >&2
    exit 2
    ;;
esac
