---
name: plan-execute
description: >-
  Walk a Cursor plan file package-by-package ([NN/M]), implement REQ→AC→TEST→EDGE,
  write next-steps handoff, validate prior work, auto-gap-fill the plan, and
  auto-continue via stop hooks. Use when the user says plan-execute, execute the
  plan, next package, walk the plan, handoff, or /loop with plan-execute.
---

# Plan Execute

Walk a plan: first pending package → REQ → AC → TEST → EDGE → validate → write handoff → mark complete. Hooks auto-continue when enabled.

## Invocation

| Mode | How |
|------|-----|
| Single package | `plan-execute` / `plan-execute next` |
| Through MVP | `plan-execute until mvp` |
| Auto-continue | `bash scripts/plan-execute-enable.sh` then implement — **stop hook** validates + continues |
| Loop | `/loop` + [LOOP_PROMPT.md](LOOP_PROMPT.md) |

Default plan: `.cursor/plans/azure_cortex_cost_estimator_4075e709.plan.md`

## Artifacts (SSOT for follow-through)

| File | Role |
|------|------|
| `.cursor/plan-execute.next.json` | **End-of-turn next steps** — written by handoff / afterAgentResponse / stop |
| `.cursor/plan-execute.gaps.json` | Agent-discovered missing plan work (applied automatically on stop) |
| `.cursor/plan-execute.active` | Opt-in auto-continue sentinel |
| `.cursor/plan-execute.status.json` | Latest measure snapshot |

## Tooling

| Command | Role |
|---------|------|
| `node scripts/measure-plan.mjs --check` | Format gate + HOW TO |
| `node scripts/plan-execute-handoff.mjs --write-next` | **Mandatory end of turn** — refresh next.json |
| `node scripts/plan-execute-handoff.mjs --validate-prior` | `pnpm test` + `--check` |
| `node scripts/plan-execute-handoff.mjs --scan-gaps --apply-gaps` | Detect missing cited paths; append todos to plan |
| `node scripts/plan-execute-handoff.mjs --followup` | Stop-hook payload (validate + gaps + next) |
| `bash scripts/plan-execute-enable.sh` | Enable auto-continue |
| `bash scripts/plan-execute-disable.sh` | Disable |

Hooks (`.cursor/hooks.json`): `sessionStart` / `postToolUse` inject measure; `afterAgentResponse` writes next.json; `stop` validates prior → applies gaps → followup (`loop_limit: 40`).

## One tick

```
Plan-execute tick:
- [ ] 0. --check ; read next.json if present
- [ ] 1. Pick first pending package
- [ ] 2. Sync TodoWrite (4 quadruple items)
- [ ] 3. REQ → AC → TEST → EDGE
- [ ] 4. pnpm test (+ spectral/boundary when present) — fail closed
- [ ] 5. Mark package todos completed in plan
- [ ] 6. HANDOFF: --write-next (and gaps scan/apply if needed)
```

### End-of-turn handoff (mandatory)

Before finishing the turn, always:

```bash
node scripts/plan-execute-handoff.mjs --write-next
```

If you found missing plan work during the tick, write `.cursor/plan-execute.gaps.json`:

```json
{
  "gaps": [
    {
      "createPackage": true,
      "slug": "boundary-lint-ci",
      "title": "Add boundary lint CI gate",
      "reason": "Discovered during pkg 02 — AC requires import boundary fail"
    }
  ]
}
```

Then:

```bash
node scripts/plan-execute-handoff.mjs --apply-gaps
node scripts/plan-execute-handoff.mjs --write-next
```

When auto-continue is enabled, the **stop hook** also validates prior work. If tests fail, follow-up says **fix prior** (do not advance).

### Auto-continue behavior

1. Enable: `bash scripts/plan-execute-enable.sh`
2. Implement one package (or let stop hook kick the next turn)
3. Stop hook: `pnpm test` + `--check` → `--scan-gaps`/`--apply-gaps` → write `next.json` → `followup_message`
4. Next turn reads `next.json` + skill and continues
5. Stops at MVP (19) unless `.cursor/plan-execute.through-all` is set (`enable --through-all`), or on blocker / abort / disable

On first `plan-execute` in a session, **enable** auto-continue unless the user said single-package only.  
When the user says **run all remaining / through-all / continue past MVP**, enable with `--through-all`.

## Load plan + pick package

0. `--check` — incompatible → stop + HOW TO  
1. Prefer instructions in `.cursor/plan-execute.next.json` when fresh  
2. Else first pending `[NN/M]` resume REQ→AC→TEST→EDGE  
3. Package > MVP without through-all opt-in → stop  
4. With through-all → continue until `all-complete` 

## Validate (fail closed)

- `pnpm test` when present; no silent skip flags  
- Diff AC/EDGE with evidence  
- Failures → do not mark complete; handoff still writes next.json with failed priorValidation  

## Plan edits

- Mark only the finished package’s four todos `completed`  
- Gaps append only via handoff `--apply-gaps` (keeps `[NN/M][KIND]` + `--check` green)  
- Do not reorder/delete unrelated todos  

## Anti-patterns

- Ending a turn without `--write-next`  
- Advancing after failed prior validation  
- Inventing packages without tagged todos / HOW TO  
- Leaving `.cursor/plan-execute.active` forever after MVP (disable, or use `--through-all` intentionally then disable when all-complete) 

## Related

- [LOOP_PROMPT.md](LOOP_PROMPT.md)  
- Rule: `.cursor/rules/plan-execute-auto.mdc`  
- babysit = PR/CI only — not for building from the plan  
