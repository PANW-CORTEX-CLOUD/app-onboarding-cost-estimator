#!/usr/bin/env bash
# Disable plan-execute auto-continue.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rm -f "${ROOT}/.cursor/plan-execute.active"
rm -f "${ROOT}/.cursor/plan-execute.through-all"
echo "Disabled auto-continue (removed .cursor/plan-execute.active and .cursor/plan-execute.through-all)."
node "${ROOT}/scripts/measure-plan.mjs" --summary || true
