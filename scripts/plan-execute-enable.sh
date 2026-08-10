#!/usr/bin/env bash
# Enable plan-execute auto-continue (stop-hook follow-ups + handoff).
#
# Usage:
#   bash scripts/plan-execute-enable.sh              # through MVP only (default)
#   bash scripts/plan-execute-enable.sh --through-all # also auto-continue post-MVP until all-complete
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "${ROOT}/.cursor"

THROUGH_ALL=0
for a in "$@"; do
  case "$a" in
    --through-all|--all) THROUGH_ALL=1 ;;
    --help|-h)
      echo "Usage: $0 [--through-all]"
      echo "  Default: auto-continue stops after MVP (mvpStop)."
      echo "  --through-all: continue packages after MVP until the plan is all-complete."
      exit 0
      ;;
    *)
      echo "Unknown arg: $a (try --through-all)" >&2
      exit 1
      ;;
  esac
done

echo "Checking plan format compatibility…"
if ! node "${ROOT}/scripts/measure-plan.mjs" --check; then
  echo "Refusing to enable: plan is incompatible with plan-execute." >&2
  exit 1
fi

touch "${ROOT}/.cursor/plan-execute.active"
if [[ "${THROUGH_ALL}" == "1" ]]; then
  touch "${ROOT}/.cursor/plan-execute.through-all"
  echo "Enabled through-all: ${ROOT}/.cursor/plan-execute.through-all"
else
  rm -f "${ROOT}/.cursor/plan-execute.through-all"
fi

node "${ROOT}/scripts/plan-execute-handoff.mjs" --write-next
echo "Enabled: ${ROOT}/.cursor/plan-execute.active"
if [[ "${THROUGH_ALL}" == "1" ]]; then
  echo "Stop hook will: validate prior → apply gaps → write next.json → auto-continue through ALL packages (past MVP)."
else
  echo "Stop hook will: validate prior → apply gaps → write next.json → auto-continue through MVP."
  echo "Post-MVP packages require: $0 --through-all (or user explicit opt-in)."
fi
echo "Next steps file: ${ROOT}/.cursor/plan-execute.next.json"
echo "Disable: scripts/plan-execute-disable.sh"
