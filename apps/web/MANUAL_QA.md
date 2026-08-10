# Manual QA — MVP UI acceptance (package 19)

Run against local API + web (`pnpm --filter @cloud-connector/api start` and `pnpm --filter @cloud-connector/web dev`).

Also see [MANUAL_QA_IA.md](./MANUAL_QA_IA.md) for section landmarks.

## Smoke

- [ ] Provider switch Azure → AWS → GCP updates region select and capability meter lines
- [ ] Demo presets: audit-only and comprehensive for Azure, AWS, GCP (6 buttons)
- [ ] Capability toggles refresh breakdown (debounced)
- [ ] Discovery-only shows $0 empty state (no invented meters)
- [ ] Low-confidence (e.g. DSPM) shows low/expected/high bands and never hides “Low”
- [ ] Export JSON/CSV/PDF includes provider, modelVersion, ratesAsOf, disclaimer, meter, confidence, amount
- [ ] Critical-stale rates: export blocked until ack checkbox
- [ ] Invalid volume input shows fail-closed error (not silent zero)
- [ ] Empty advanced field restores preset value (not silent zero)
- [ ] Mobile (~375px): sections readable; demo buttons stack; table scrolls
- [ ] No SaaS/license line items in breakdown or export

## Automated

```bash
pnpm test                 # unit + boundary + spectral + engine + api + web
pnpm test:e2e             # Playwright happy-path (starts api+web)
```
