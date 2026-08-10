# Manual QA — UI information architecture (journey era)

Checklist for the estimator at `http://localhost:5173/` (or `pnpm --filter @cloud-connector/web dev` + API). See also [docs/ESTIMATOR_UI_FLOW.md](../../docs/ESTIMATOR_UI_FLOW.md).

## Journey shell

| # | Check | Pass criteria |
| --- | --- | --- |
| 1 | Mode tabs | Inputs \| Cost output; `?view=` syncs; invalid → Inputs |
| 2 | Journey intro | Full bullets on Inputs; minimized one-liner on Cost **after** estimate |
| 3 | Inputs steps | Start → Size → Assumptions & run; panels stay mounted (hidden) |

## Inputs · Start

| # | Check | Pass |
| --- | --- | --- |
| 4 | Provider & region | Azure default; AWS/GCP selectable |
| 5 | Demo presets | **Chips only** (`demo-presets` group, no `<select>`) |
| 6 | Capabilities | Selected cards have stronger border (`data-selected`) |
| 7 | Sticky footer | Back + **Continue** reachable without scrolling past fold |

## Inputs · Size

| # | Check | Pass |
| --- | --- | --- |
| 8 | Estate + volume | Accounts / MAU / ingress / peaks |
| 9 | Affects chips | Quiet styling; not primary CTAs |
| 10 | Calibration | Under Advanced only |

## Inputs · Assumptions & run

| # | Check | Pass |
| --- | --- | --- |
| 11 | Continue | **Absent** on last step (Back only in step nav) |
| 12 | Run primary | Single `run-estimate` (label **Retry estimate** when error) |
| 13 | No View cost | `view-cost-output` not in DOM |
| 14 | Auto-update | Checkbox beside Run (`auto-run-toggle`) |
| 15 | Assumptions | Default **collapsed** |
| 16 | Offline / freeze | Under run-controls Advanced collapse |

## Cost output

| # | Check | Pass |
| --- | --- | --- |
| 17 | Empty | `CostOutputEmpty` + Go to Inputs; **no** `empty-run-estimate` |
| 18 | Summary | Slim $ + freshness + auto-chip |
| 19 | Auto-chip | Toggles auto-run **in place**; stays on Cost |
| 20 | Drivers / flip | Drivers front; meters via flip |
| 21 | Jump to input | Switches to Inputs · Size (or Run) and focuses field |
| 22 | Notes | Human summary; raw HTTP/detail in `<details>` |
| 23 | Compare | `compare-empty` until side-by-side run |
| 24 | Export | Disclaimer + JSON/CSV/PDF; critical stale requires ack |

## A11y / motion

| # | Check | Pass |
| --- | --- | --- |
| 25 | Landmarks | One `main`; skip link `#main-estimator` |
| 26 | Dual tablists | Journey + Input steps (+ results tabs on Cost) have distinct `aria-label`s |
| 27 | Reduced motion | Sticky nav / flip still usable under `prefers-reduced-motion` |

## Out of scope (do not expect)

- Sticky two-column results canvas
- `#breakdown` as a top-level section id (meters live under Cost flip)
