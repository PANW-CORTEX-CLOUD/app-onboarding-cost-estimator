#!/usr/bin/env bash
# plan-execute-after-response.sh — afterAgentResponse hook
# Side-effect: refresh .cursor/plan-execute.next.json so the next turn / stop hook
# always has fresh next steps. Fail-open.
set -u

ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-}}"
if [[ -z "${ROOT}" ]]; then
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi

HANDOFF="${ROOT}/scripts/plan-execute-handoff.mjs"
LOG_DIR="${ROOT}/.cursor/hooks/logs"
mkdir -p "${LOG_DIR}" 2>/dev/null || true
LOG="${LOG_DIR}/plan-execute-after-response.log"

cat >/dev/null || true
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -f "${HANDOFF}" ]] && command -v node >/dev/null 2>&1; then
  node "${HANDOFF}" --write-next >>"${LOG}" 2>&1 || true
  echo "${ts} wrote next.json" >>"${LOG}" 2>/dev/null || true
fi

# afterAgentResponse has no consumed output fields — emit empty object
echo '{}'
exit 0
