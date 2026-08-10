#!/usr/bin/env bash
# plan-measure-inject.sh — postToolUse hook
# When the agent reads/writes the plan file (or measure script), inject fresh measure
# context. Works around sessionStart additional_context drops. Fail-open.
set -u

ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-}}"
if [[ -z "${ROOT}" ]]; then
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi

MEASURE="${ROOT}/scripts/measure-plan.mjs"
STATUS_FILE="${ROOT}/.cursor/plan-execute.status.json"
LOG_DIR="${ROOT}/.cursor/hooks/logs"
mkdir -p "${LOG_DIR}" 2>/dev/null || true
LOG="${LOG_DIR}/plan-measure-inject.log"

INPUT="$(cat || true)"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Decide if this tool event is plan-related
RELEVANT="$(node -e '
let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
  const s = (raw || "").toLowerCase();
  const needles = [
    "azure_cortex_cost_estimator_4075e709.plan.md",
    "plan-execute",
    "measure-plan.mjs",
    "cloud_cost_model",
    "architecture.md",
    ".cursor/plans/",
  ];
  const hit = needles.some((n) => s.includes(n));
  process.stdout.write(hit ? "1" : "0");
});
' <<<"${INPUT}")"

if [[ "${RELEVANT}" != "1" ]]; then
  echo '{}'
  exit 0
fi

if [[ ! -f "${MEASURE}" ]] || ! command -v node >/dev/null 2>&1; then
  echo '{}'
  exit 0
fi

CONTEXT="$(node "${MEASURE}" --context --write-status "${STATUS_FILE}" 2>>"${LOG}" || true)"
if [[ -z "${CONTEXT}" ]]; then
  echo '{}'
  exit 0
fi

CONTEXT_JSON="$(node -e 'const fs=require("fs"); process.stdout.write(JSON.stringify(fs.readFileSync(0,"utf8")))' <<<"${CONTEXT}")"
node -e 'process.stdout.write(JSON.stringify({ additional_context: JSON.parse(process.argv[1]) })+"\n")' "${CONTEXT_JSON}"

echo "${ts} injected measure context" >>"${LOG}" 2>/dev/null || true
exit 0
