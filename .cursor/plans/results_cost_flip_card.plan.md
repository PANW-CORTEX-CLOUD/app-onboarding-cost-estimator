---
name: Results cost flip card
overview: "Replace Drivers+Breakdown tabs with one Cost flip card (front drivers / back meters); keep Projections and Compare; accessible toggle + reduced-motion."
todos:
  - id: req-flip
    content: "[01/01][REQ] Cost flip card: drivers front / meters back; Cost tab replaces Drivers+Breakdown"
    status: completed
  - id: ac-flip
    content: "[01/01][AC] Toggle faces; Projections/Compare unchanged; reduced-motion instant swap; e2e path"
    status: completed
  - id: test-flip
    content: "[01/01][TEST] result-flip-card.test.tsx + update ui-ia/e2e tab selectors"
    status: completed
  - id: edge-flip
    content: "[01/01][EDGE] Empty/discovery faces; invalid session → high; no estimate empty front"
    status: completed
isProject: false
---

# Results cost flip card

## Decision

One **Cost** tab with a flip card: **front = CostDrivers**, **back = CostBreakdown**. Hero/provenance/honesty unchanged. Projections/Compare stay tabs.

## Package `[01/01]`

**REQ:** Flip between high-level drivers and meter breakdown in Cost view.

**AC:** Default high; toggle to low shows breakdown; reduced-motion instant; e2e uses cost + flip.

**TEST:** `result-flip-card.test.tsx` + ui-ia/e2e updates.

**EDGE:** Invalid session → high; empty/discovery on both faces.
