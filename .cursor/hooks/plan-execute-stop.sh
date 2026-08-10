#!/usr/bin/env bash
# plan-execute-stop.sh — stop hook
# Validates prior work, applies plan gaps, writes next.json, emits followup_message
# when .cursor/plan-execute.active exists. Fail-open to {} on infra errors.
set -u

ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-}}"
if [[ -z "${ROOT}" ]]; then
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi

HANDOFF="${ROOT}/scripts/plan-execute-handoff.mjs"
ACTIVE_FILE="${ROOT}/.cursor/plan-execute.active"
LOG_DIR="${ROOT}/.cursor/hooks/logs"
mkdir -p "${LOG_DIR}" 2>/dev/null || true
LOG="${LOG_DIR}/plan-execute-stop.log"

INPUT="$(cat || true)"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

STATUS="$(node -e '
let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
  try { const j=JSON.parse(raw||"{}"); process.stdout.write(String(j.status||"completed")); }
  catch { process.stdout.write("completed"); }
});
' <<<"${INPUT}")"

LOOP_COUNT="$(node -e '
let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
  try { const j=JSON.parse(raw||"{}"); const n=Number(j.loop_count); process.stdout.write(String(Number.isFinite(n)?n:0)); }
  catch { process.stdout.write("0"); }
});
' <<<"${INPUT}")"

LOOP_LIMIT="${PLAN_EXECUTE_LOOP_LIMIT:-40}"

echo "${ts} stop begin status=${STATUS} loop_count=${LOOP_COUNT}" >>"${LOG}" 2>/dev/null || true

if [[ "${STATUS}" != "completed" ]]; then
  echo "${ts} skip non-completed" >>"${LOG}" 2>/dev/null || true
  echo '{}'
  exit 0
fi

ACTIVE=0
[[ -f "${ACTIVE_FILE}" ]] && ACTIVE=1
[[ "${PLAN_EXECUTE_ACTIVE:-0}" == "1" || "${PLAN_EXECUTE_ACTIVE:-}" == "true" ]] && ACTIVE=1

if [[ ! -f "${HANDOFF}" ]] || ! command -v node >/dev/null 2>&1; then
  echo "${ts} ERROR handoff/node missing" >>"${LOG}" 2>/dev/null || true
  echo '{}'
  exit 0
fi

# Always refresh next.json for humans (even when inactive)
if [[ "${ACTIVE}" != "1" ]]; then
  node "${HANDOFF}" --write-next >>"${LOG}" 2>&1 || true
  echo "${ts} inactive — wrote next.json only" >>"${LOG}" 2>/dev/null || true
  echo '{}'
  exit 0
fi

export PLAN_EXECUTE_ACTIVE=1
# followup: validate prior + scan/apply gaps + write next + emit message
OUT="$(node "${HANDOFF}" --followup --loop-count "${LOOP_COUNT}" --loop-limit "${LOOP_LIMIT}" 2>>"${LOG}")"
ec=$?

if [[ -z "${OUT}" ]]; then
  echo "${ts} empty out ec=${ec}" >>"${LOG}" 2>/dev/null || true
  echo '{}'
  exit 0
fi

if ! node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))' <<<"${OUT}" 2>/dev/null; then
  echo "${ts} invalid JSON: ${OUT}" >>"${LOG}" 2>/dev/null || true
  echo '{}'
  exit 0
fi

echo "${ts} emit followup ec=${ec} bytes=${#OUT}" >>"${LOG}" 2>/dev/null || true
printf '%s\n' "${OUT}"
exit 0
