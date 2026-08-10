# Continuous improvement loop prompt

> **Single source of truth.** The `Stop` hook (`hooks/stop.mjs`) re-injects this file
> verbatim on every iteration. Edit this file to change the loop; do not fork the text elsewhere.

---

## PART 1 — THE WORK

CONTINUE IMPLEMENTATION AND BEST NEXT STEPS. FIRST PRIORITY IS THE IMPLEMENTATION PLAN TO FULFIL COMPLETELY

THEN ALSO APPLY THIS:

- make sure those improvements are significant for the application or a bug hunt, write a document use a structure that makes sense writing down > requirements > split it in use Cases > and in atomar tasks

- add a Ideation Process and research for long, mid and short term improvements of the application

- make sure every todo is validated after being implemented

- if any issue arises make sure it is fixed !

- if something new comes up, add new tasks to the todo list and continue implementation

- sweep the code context for remaining architecture anti patterns, like silent fallbacks, persistence drift, loose validation patterns, backward compatibility and other patterns

- Before coding this todo: use WebSearch (and WebFetch on authoritative docs/issues) for current third-party pitfalls related to: Prefer official docs, GitHub issues, CVEs; apply findings only when they change the correct fix for THIS todo — do not invent unrelated work.

- If research surfaces a real blocker or a new fail-closed gap in our code, add a new atomic plan todo (requirement, use-case, test-case incl. edge, end2end test ) and keep this turn on the assigned todo.

- analyse and check for any dead code, in case it was an old feature not finished - provide a summary what it is and let me approve to delete or add it to finish to the todo list - in other cases handle it like a bug

- every hard coded parameter that should be centrally managed should be handled in a structured way

- spaghetti code and long trail of interdependencies should be refactored using best practices (DRY, CLEAN ARCHITECTURE), packages for high scalable applications, check the architecture guide

- if there is an opportunity for improvement add a TODO into the code so I can find it later

- if there is a BUG on the way add also a TODO to fix the bug in a later run

- always add code comments also to the code, so it is compatible with actual convention JSDoc/TSDoc (/** ... */ blocks), optionally piped to GitBook via jsdoc-to-markdown.

- research everything that is not clear and if confidence is still low you can ask me

- use ad-hoc tasks only for debugging or testing purposes, do not use ad-hoc scripts to overcome a bug or issue - always fix the root cause and use the gained knowledge to fix the root cause

- use professional debugging features for the task you work on, if no available implement a logging and debug framework - research and check other repos how they did it

- One command finds every todo or bug marker across the whole workspace: grep -rn "TODO" --include="*.ts" --include="*.py" from the active repository.

- always check for opportunities to refactor the code for best practices and code reduction and better maintenance, use code comments todos to mark those opportunities and provide a useful description why and what

- before signing off the feature implementation is correct do an end to end test on the code and in ui and starting the app with debug mode on

- if you have learned something from fixing bug or improving a situation at the code that is related you could add comments to help avoid the issue in the future

- bypass the PR and commit to main push it to remote

- ALWAYS BE BRUTALLY HONEST, NEVER INVENT THINGS - ALWAYS VALIDATE, ANALYSE USING CONFIDENCE OR ASK

- At the end of every turn, ask "what is next?"

---

## PART 2 — THE LOOP PROTOCOL (extension)

This turn is **one iteration** of an automated loop. The loop is driven by a `Stop` hook that
reads the **last line** of your final message. What you write there decides whether the loop
runs again, changes gear, or ends.

### Scope of one iteration

Do **one** coherent unit of work, then hand off. Do not try to finish the whole backlog in a
single turn — the loop exists so that each turn stays small, validated, and reviewable.

An iteration is finished only when **all** of these hold:

1. The unit of work is implemented (not stubbed, not deferred).
2. It is **validated** — the repository's own gate was run and is green
   (`pnpm test` here; whatever the project's gate is elsewhere). Fail closed: a red gate means
   the iteration is *not* done and the next iteration fixes it before advancing.
3. Anything discovered on the way was **captured** — new plan todos, `TODO:`/`BUG:` code
   comments, or a document entry. Discoveries are never dropped just because they were
   out of scope for this iteration.
4. Work is committed (per the repository's delivery policy).

### Mandatory end-of-turn control block

**Every** turn must end with a `LOOP CONTROL` block. It must be the **last thing** in your
message, with the trigger line as the final non-empty line:

```
=== LOOP CONTROL ===
ITERATION-SUMMARY: <one line: what changed, and what proves it works>
VALIDATION: <the exact gate command you ran and its result, or "none — why">
CAPTURED: <new todos / TODO markers / doc entries created this turn, or "none">
NEXT-STEP: <TRIGGER> — <one line>
```

`<TRIGGER>` is exactly one of four words. Choose it honestly — the hook cannot see your
reasoning, only this word.

| Trigger | Use when | Hook reaction |
|---|---|---|
| `CONTINUE` | There **is** a concrete next step: an unfinished plan item, a red gate, a captured TODO/BUG, a follow-up this turn created. | Re-runs this prompt in **IMPLEMENT** mode, carrying your one-liner forward. |
| `INVESTIGATE` | The plan is empty and the gate is green — nothing is *known* to be left. | Re-runs this prompt in **INVESTIGATE** mode with a **fresh angle** supplied by the hook. Each angle is handed out at most once. |
| `COMPLETE` | Plan empty, gate green, **and** the investigation angles have been worked through without producing new work. | Ends the loop and deactivates it. |
| `BLOCKED` | You need a human decision: low confidence after research, an approval gate (e.g. deleting dead code), a credential/access wall, or a destructive/irreversible action. | Ends the loop and hands back to the user. Put the actual question in the one-liner. |

Examples of the final line:

- `NEXT-STEP: CONTINUE — pnpm test red: check-openapi-drift fails after the new /v1/estimate field; fix drift stamp next.`
- `NEXT-STEP: INVESTIGATE — plan empty, pnpm test green, no open TODO markers.`
- `NEXT-STEP: INVESTIGATE [angle:security-and-secrets] — want to look at PII in proxy logs next.`
- `NEXT-STEP: COMPLETE — plan empty, pnpm test green, all 14 angles swept, last 2 sweeps found nothing.`
- `NEXT-STEP: BLOCKED — scripts/refresh-fallback-prices.mjs looks like an abandoned feature; approve delete or should I finish it?`

### Rules that keep the loop honest

- **Never** emit `COMPLETE` to escape a hard problem. `BLOCKED` with a real question is
  always the correct alternative; a wrong `COMPLETE` silently ends the work.
- **Never** emit `CONTINUE` with a vague next step ("keep improving"). If you cannot name the
  next step in one concrete line, the honest trigger is `INVESTIGATE`.
- **Never** emit the trigger for work you have not actually validated. State the real gate
  result in `VALIDATION:`, including a red one.
- If you mention the trigger words earlier in a message (e.g. quoting this file), the hook
  reads the **last** occurrence, so keep the real control block last.
- An `INVESTIGATE` turn that finds real work must **capture** it and then emit `CONTINUE` —
  investigation without capture is a wasted iteration.

### IMPLEMENT mode

Pick the highest-value next step in this order and do only that:

1. A **red gate** or known-broken behaviour (always first — fail closed).
2. The next unfinished item in the implementation plan.
3. A `BUG:` marker captured in an earlier iteration.
4. A `TODO:` marker captured in an earlier iteration.
5. Work captured by the previous `INVESTIGATE` iteration.

### INVESTIGATE mode

The hook supplies one **angle** and will not supply it twice. Work only that angle:

1. Sweep the codebase for that angle's specific failure shape (see
   [`REFERENCE.md`](REFERENCE.md) for the full catalogue and each angle's checklist).
2. Research it against authoritative sources when third-party behaviour is involved.
3. For every real finding: write an atomic todo (requirement → use case → test case incl.
   edge → end-to-end test) and/or a `TODO:`/`BUG:` code comment at the site.
4. Findings → emit `CONTINUE`. Genuinely nothing → emit `INVESTIGATE` again for the next
   angle. Do not invent work to justify the angle; "this angle is clean, here is what I
   checked" is a valid, useful outcome.
