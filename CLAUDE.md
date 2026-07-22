# The Cosmos — notes for Claude Code

## Commands

```bash
npm run dev        # dev server on :5173
npm run build      # tsc -b && vite build — the gate for every change
npm run validate   # data sanity: ids resolve, phaseIds unique, spacing ok
```

**Never run `tsc` without `--noEmit`/`-b`** — emitted `.js` files shadow `.tsx` in Vite and the app silently serves stale code.

## Layout

- `src/scenarios/` — the entire universe as typed data: `services.ts`, `topics.ts`, `scenarios.ts` (domains + scenarios), `owners.ts` (teams), `steps/<domain>.ts`, barrel in `data.ts`. **Most changes belong here.**
- `src/map/` — SVG map rendering: `Map.tsx` (orchestration, layout edit mode), `edge-resolver.ts` (how a step becomes edges; special-cases the expandable `realtime-hub`), `edge-builder.ts` (bezier geometry).
- `src/components/` — UI shell: intro, playback controls, step panel, tech icons.
- `drift-sync/` — the nightly honesty pipeline (its own README).
- `.claude/skills/` — `add-service` and `add-scenario`: THE documented procedures for growing the map. Follow them rather than improvising.

## Invariants

- `phaseId` global, unique, never reused; every step's `phase` equals its scenario's `phaseId`.
- Step `from`/`to`/`via`/`through` must exactly match `SERVICES[].id` / `TOPICS[].id`.
- Service `hex` must match its `color` CSS token hue (`src/styles/tokens.css`); topics always `TOPIC_COLOR`/`TOPIC_HEX`.
- World is 2400×1400; capsules ≥150px apart center-to-center.
- Demo data is fictional (AstroMart). Keep it that way — no real company names/endpoints.
