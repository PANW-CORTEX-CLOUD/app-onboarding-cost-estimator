---
name: Estimator button flow UX
overview: "Document every estimator control, define a clear end-user concept (when to press what), then remove/merge/relabel overlapping CTAs so Inputs→Run→Cost is obvious without redundant buttons."
todos:
  - id: req-01-concept-doc
    content: "[REQ] Add docs/ESTIMATOR_UI_FLOW.md with flowgraph + when-to-press concept (SSOT for this cleanup)"
    status: pending
  - id: req-02-run-step-cta
    content: "[REQ] Run step footer — single primary Run estimate; hide disabled Continue on last step; Back stays"
    status: pending
  - id: req-03-remove-view-cost
    content: "[REQ] Remove view-cost-output button; Cost mode only via journey-tab-cost or successful Run"
    status: pending
  - id: req-04-merge-retry
    content: "[REQ] Merge retry-estimate into run-estimate label (Retry estimate when error); drop second button"
    status: pending
  - id: req-05-auto-chip-toggle
    content: "[REQ] auto-update-status-chip toggles auto-run in place (no navigate-to-buried-toggle)"
    status: pending
  - id: req-06-surface-auto-run
    content: "[REQ] Surface auto-run-toggle beside Run (not only inside run-controls-collapse)"
    status: pending
  - id: req-07-fix-jump-links
    content: "[REQ] CostDrivers jump-* calls goToInputsStep(size|start|run) then focus input"
    status: pending
  - id: req-08-empty-cost-cta
    content: "[REQ] Cost empty — keep Go to Inputs; empty-run-estimate becomes Run estimate with switchToCost or removed if Go-to-Inputs suffices"
    status: pending
  - id: req-09-advanced-bury
    content: "[REQ] Keep freeze/offline/calibration/assumptions under Advanced only; no new primary buttons"
    status: pending
  - id: ac-01-happy-path
    content: "[AC] Happy path needs only preset (or caps) → Continue×2 → Run estimate → Cost shows $"
    status: pending
  - id: ac-02-no-duplicate-nav
    content: "[AC] No View cost button; journey-tab-cost is sole explicit Cost nav without running"
    status: pending
  - id: ac-03-one-run-primary
    content: "[AC] Exactly one primary run control on Run step (run-estimate); label Retry when error"
    status: pending
  - id: ac-04-auto-chip
    content: "[AC] Clicking auto-update-status-chip flips autoRunEnabled; stays on Cost mode"
    status: pending
  - id: ac-05-jump-works
    content: "[AC] jump-audit_logs-input-peak-mbps switches to Inputs·Size and focuses peak field"
    status: pending
  - id: test-01-flow-doc
    content: "[TEST] Doc or unit asserts inventory table lists run-estimate and omits view-cost-output"
    status: pending
  - id: test-02-journey-cta
    content: "[TEST] estimator-journey — last step Continue absent/disabled; Run present; no view-cost-output"
    status: pending
  - id: test-03-auto-chip
    content: "[TEST] Chip click toggles auto-run without forcing Inputs mode"
    status: pending
  - id: test-04-jump
    content: "[TEST] Driver jump opens Inputs size step (mock)"
    status: pending
  - id: test-05-e2e
    content: "[TEST] mvp-happy-path still Inputs→Continue→Run→Cost meters; no view-cost click"
    status: pending
  - id: edge-01-error-retry
    content: "[EDGE] On estimate error, run-estimate shows Retry and still switchToCost on success"
    status: pending
  - id: edge-02-stale-cost-tab
    content: "[EDGE] Opening Cost tab without estimate shows CostOutputEmpty + Go to Inputs (no invented $)"
    status: pending
  - id: edge-03-debounce
    content: "[EDGE] Auto-update still does not force Cost mode on debounce"
    status: pending
  - id: edge-04-advanced-intact
    content: "[EDGE] Offline/freeze/calibration still reachable under Advanced; e2e/testid freeze-rates remains"
    status: pending
isProject: false
---

# Estimator button flow — concept then straighten

## 1. Current flowgraph (as-built)

```mermaid
flowchart TB
  brand[Brand_JourneyIntro]
  modeIn[Inputs_tab]
  modeCost[Cost_tab]
  brand --> modeIn
  brand --> modeCost

  subgraph inputsMode [Inputs]
    start[Start_provider_preset_caps]
    size[Size_estate_volume]
    runStep[Assumptions_and_run]
    start -->|"Continue"| size
    size -->|"Continue"| runStep
    runStep -->|"Back"| size
    size -->|"Back"| start
    runEst[Run_estimate]
    viewCost[View_cost_output]
    autoBuried[Auto_update_in_collapse]
    retryBtn[Retry_after_error]
    runStep --> runEst
    runStep --> viewCost
    runStep --> autoBuried
    runStep --> retryBtn
  end

  modeIn --> start
  runEst -->|"success"| modeCost
  viewCost --> modeCost
  autoBuried -->|"debounce"| api[POST_estimates]
  runEst --> api

  subgraph costMode [Cost_output]
    empty[Go_to_Inputs]
    chip[Auto_update_chip_navigates]
    flip[Show_meters]
    jump[Jump_to_input_often_dead]
    emptyRun[empty_run_estimate]
    exportRow[Export_share_CSV]
  end

  modeCost --> empty
  modeCost --> chip
  chip -->|"opens collapse"| autoBuried
  emptyRun --> api
```

### Pain (why straighten)

| Problem | User effect |
|---------|-------------|
| **Run + View cost + Cost tab** | Three ways to “see cost”; View does not refresh |
| **Continue disabled on last step** | Looks broken; users expect Continue → results |
| **Auto-update buried + chip navigates** | Chip looks like a toggle; it teleports to Inputs |
| **Retry ≈ Run** | Duplicate primary |
| **Jump-to-input from Cost** | Often no visible effect (hidden Inputs panel) |
| **empty-run-estimate vs Run** | Second Run entry |

---

## 2. Concept — how the UI should work

**Jobs**

1. **Enter** (Inputs) — set what feeds the estimate  
2. **Compute** (Run) — one deliberate action when ready (or leave Auto-update on while editing)  
3. **Read** (Cost output) — understand $, drivers, then details / export  

**Happy path (minimal presses)**

1. Inputs · Start — pick **Azure · audit-only** (or set provider + caps)  
2. **Continue** → Size (tweak only if needed) → **Continue** → Run  
3. Press **Run estimate** once → land on Cost with monthly $ + drivers  
4. Optional: flip meters, Projections, Compare, Export  

**While refining**

- Leave **Auto-update** on (visible next to Run). Editing Size refreshes the estimate **without** leaving Inputs.  
- Open **Cost** tab anytime to read; if nothing computed yet → **Go to Inputs**.  
- From a driver, **Jump to input** must switch to the right Inputs step and focus the field.

**Advanced (not in the happy path)**

- Assumptions knobs, offline, freeze rates, billing calibration, inputs CSV import — stay behind Advanced / Export.

**Primary vs secondary rule**

- **One primary CTA per screen**: Continue (steps 1–2) or Run estimate (step 3) or results-tab content actions.  
- Mode tabs = navigation, not “do work.”  
- Never two adjacent buttons that both claim to show cost.

---

## 3. Target flowgraph (after cleanup)

```mermaid
flowchart TB
  modeIn[Inputs_tab]
  modeCost[Cost_tab]
  start[Start]
  size[Size]
  runStep[Run_step]
  start -->|Continue| size
  size -->|Continue| runStep
  runStep -->|Back| size
  runEst[Run_estimate_primary]
  autoVisible[Auto_update_checkbox_visible]
  runStep --> runEst
  runStep --> autoVisible
  runEst -->|success| modeCost
  autoVisible -->|debounce_no_mode_switch| api[POST_estimates]
  runEst --> api
  modeCost --> read[Summary_drivers_flip_export]
  jump[Jump_from_driver] -->|Inputs_plus_step_plus_focus| size
  chip[Auto_update_chip] -->|toggles_auto_run| autoVisible
```

### Concrete control changes

| Control | Action |
|---------|--------|
| `view-cost-output` | **Remove** |
| `retry-estimate` | **Remove**; `run-estimate` label becomes “Retry estimate” when `error` |
| `journey-step-continue` on last step | **Hide** (not disabled primary) — only Back + Run |
| `auto-update-toggle` | **Surface** beside Run (still also in Advanced for offline/freeze) |
| `auto-update-status-chip` | **Toggle** `autoRunEnabled` in place; stay on Cost |
| `jump-*` | **Fix** → `goToInputsStep` + focus (Size for volume, Start for caps) |
| `empty-run-estimate` | **Remove** if Cost empty already has Go to Inputs; else same as Run with `switchToCost` |
| `freeze-rates` / offline / calibration | **Keep** Advanced only |
| sr-only `demo-preset-*` | **Keep** (e2e; not user-visible) |

### Copy (Run step)

- Hint under Run: “Auto-update refreshes the estimate as you edit. Run switches you to Cost output when ready.”  
- Do not invent prices; no change to cost-engine.

---

## 4. Implementation (small blast radius)

Touch primarily:

- [`InputsJourneySteps.tsx`](apps/web/src/widgets/InputsJourneySteps/InputsJourneySteps.tsx) — hide Continue on last step  
- [`EstimatorPage.tsx`](apps/web/src/pages/estimator/EstimatorPage.tsx) — remove View cost / Retry; surface auto-run; Run label  
- [`ResultsSummary.tsx`](apps/web/src/widgets/ResultsSummary/ResultsSummary.tsx) — chip toggles auto-run (`onAutoUpdateToggle`)  
- [`CostDrivers.tsx`](apps/web/src/widgets/CostDrivers/CostDrivers.tsx) — jump callback + remove/repurpose empty-run  
- New short [`docs/ESTIMATOR_UI_FLOW.md`](docs/ESTIMATOR_UI_FLOW.md) — concept + inventory SSOT  
- Tests: [`estimator-journey.test.tsx`](apps/web/src/__tests__/estimator-journey.test.tsx), [`ui-ia.test.tsx`](apps/web/src/__tests__/ui-ia.test.tsx), e2e [`mvp-happy-path.spec.ts`](apps/web/e2e/mvp-happy-path.spec.ts)

---

## 5. Quadruple rollup

| Kind | Criteria |
|------|----------|
| **REQ** | Concept doc + CTA straighten (one Run primary; no View cost; chip toggles; jumps work) |
| **AC** | Happy path Continue×2 → Run → $; no duplicate cost nav button; chip stays on Cost |
| **TEST** | Journey/unit + e2e without view-cost; chip toggle; jump opens Size |
| **EDGE** | Error→Retry label; empty Cost CTA; debounce no mode yank; Advanced intact |

Out of scope: cost-engine, new capabilities, sticky layout, redesign of export formats.
