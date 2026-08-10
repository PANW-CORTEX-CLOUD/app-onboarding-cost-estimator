# Plan-execute loop prompt

Prefer **hooks + handoff** over raw looping:

```bash
bash scripts/plan-execute-enable.sh
# Agent implements; stop hook validates prior + continues with next.json
```

Or `/loop 15m` with:

```text
Read plan-execute skill and .cursor/plan-execute.next.json (if present).
Run: node scripts/plan-execute-handoff.mjs --write-next

Default plan: .cursor/plans/azure_cortex_cost_estimator_4075e709.plan.md

One tick:
1. If next.json priorValidation failed → fix prior only.
2. Else implement first pending package REQ→AC→TEST→EDGE.
3. pnpm test — fail closed.
4. Mark package todos completed only if green.
5. Record gaps in .cursor/plan-execute.gaps.json if needed; --apply-gaps.
6. Always end with: node scripts/plan-execute-handoff.mjs --write-next
Stop at blockers or MVP package 19.
```
