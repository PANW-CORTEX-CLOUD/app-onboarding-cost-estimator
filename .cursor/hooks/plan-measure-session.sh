#!/usr/bin/env bash
# plan-measure-session.sh — sessionStart hook
# Injects plan progress into conversation context + session env for later hooks.
# Fail-open: on errors print {} and exit 0 so Cursor is not blocked.
set -u

ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-}}"
if [[ -z "${ROOT}" ]]; then
  # Fallback: walk up from this script → .cursor/hooks → repo root
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi

MEASURE="${ROOT}/scripts/measure-plan.mjs"
ACTIVE_FILE="${ROOT}/.cursor/plan-execute.active"
STATUS_FILE="${ROOT}/.cursor/plan-execute.status.json"
LOG_DIR="${ROOT}/.cursor/hooks/logs"
mkdir -p "${LOG_DIR}" 2>/dev/null || true
LOG="${LOG_DIR}/plan-measure-session.log"

# Consume stdin (sessionStart payload) — keep for logging
INPUT="$(cat || true)"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
{
  echo "${ts} sessionStart begin root=${ROOT}"
} >>"${LOG}" 2>/dev/null || true

if [[ ! -f "${MEASURE}" ]]; then
  echo "${ts} ERROR missing ${MEASURE}" >>"${LOG}" 2>/dev/null || true
  echo '{}'
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "${ts} ERROR node not on PATH" >>"${LOG}" 2>/dev/null || true
  echo '{}'
  exit 0
fi

CONTEXT="$(node "${MEASURE}" --context --write-status "${STATUS_FILE}" 2>>"${LOG}" || true)"
# --context prints howto even on failure (exit 1); keep stdout for injection
if [[ -z "${CONTEXT}" ]]; then
  # Fallback: run check explicitly
  CONTEXT="$(node "${MEASURE}" --check 2>&1 || true)"
fi
if [[ -z "${CONTEXT}" ]]; then
  echo "${ts} ERROR empty context from measure-plan" >>"${LOG}" 2>/dev/null || true
  echo '{}'
  exit 0
fi

ACTIVE=0
if [[ -f "${ACTIVE_FILE}" ]]; then
  ACTIVE=1
fi

# Escape context for JSON string
CONTEXT_JSON="$(node -e 'const fs=require("fs"); const s=fs.readFileSync(0,"utf8"); process.stdout.write(JSON.stringify(s))' <<<"${CONTEXT}")"

# Emit env (reliable) + additional_context (best-effort; some Cursor builds drop it)
node -e '
const active = process.argv[1];
const ctxJson = process.argv[2];
const statusFile = process.argv[3];
const out = {
  env: {
    PLAN_EXECUTE_ACTIVE: active,
    PLAN_EXECUTE_STATUS_FILE: statusFile,
    PLAN_EXECUTE_MVP: "19",
  },
  additional_context: JSON.parse(ctxJson),
};
process.stdout.write(JSON.stringify(out) + "\n");
' "${ACTIVE}" "${CONTEXT_JSON}" "${STATUS_FILE}"

echo "${ts} sessionStart ok active=${ACTIVE}" >>"${LOG}" 2>/dev/null || true
exit 0
