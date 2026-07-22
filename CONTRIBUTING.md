# Contributing to The Cosmos

Thanks for wanting to make the galaxy bigger. Two rules of the universe before you start:

1. **The map is data.** Almost everything lives in `src/scenarios/` — services, topics, scenarios, steps. If your change is "the demo should show X", it's probably a data change, not a code change.
2. **Never run `tsc` without `--noEmit`** (or `-b`). Stray `.js` files shadow `.tsx` in Vite and the app silently serves stale code.

## Dev setup

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build — must pass before a PR
npm run validate   # data sanity checks (ids resolve, phaseIds unique, …)
```

## Data invariants (the ones that bite)

- `phaseId` is **global and never reused** — steps are filtered by phase; a collision plays the wrong steps.
- Every step's `from`/`to`/`via`/`through` must exactly match a `SERVICES[].id` or `TOPICS[].id` — typos silently drop edges.
- A service's `hex` must visually match its `color` CSS token (SVG gradients can't read CSS vars).
- Keep ≥150px center-to-center spacing between capsules.

If you use [Claude Code](https://claude.com/claude-code), the repo ships with two skills that enforce all of this: `/add-service` and `/add-scenario`.

## Pull requests

- Fork → feature branch → PR against `main`.
- `npm run build` and `npm run validate` must pass (CI checks both).
- One logical change per PR. Screenshots/GIFs for anything visual are hugely appreciated.
- New scenario for the AstroMart demo? Great — keep it fictional, keep payloads plausible, and showcase at least one mechanic (kafka `via:`, broadcast `through:`, `parallel:`, split storage hops).

## Reporting bugs / proposing features

Open an issue with repro steps (bugs) or the problem you're trying to solve (features). "It would be cool if…" is a valid problem statement here.
