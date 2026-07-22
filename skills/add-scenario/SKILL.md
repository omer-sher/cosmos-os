---
name: add-scenario
description: Add a scenario (animated flow) to the Cosmos map. Use when the user says "add a scenario", "add a flow", "show what happens when X", or names a user action whose path through the system should play on the map. Traces the real flow from source across repos, then writes Scenario + Step entries (and any missing services/topics) into src/scenarios/.
---

# Add a scenario (flow) to the Cosmos

Use this skill when the user asks to "add a scenario", "add a flow", "show what happens when X", or "trace flow Y and add it". A scenario is a named, animated sequence of steps that plays end-to-end across services on the map.

If the service nodes involved don't exist yet, run the `add-service` skill first — this skill assumes all `from` / `to` / `via` ids already exist in `SERVICES` / `TOPICS`.

---

## What you'll touch

| File | Why |
|---|---|
| `src/scenarios/scenarios.ts` | Scenario entry (and Domain entry if new) |
| `src/scenarios/steps/<domain>.ts` | Step entries for the flow |
| `src/scenarios/data.ts` | Barrel — only if you add a new steps file |
| `src/scenarios/services.ts` / `topics.ts` | Any missing services/topics |
| `src/scenarios/types.ts` | Only if you need a new `Tech` variant |

---

## Step 1 — Gather the three inputs

Ask the user if any are missing:

1. **Domain** — which domain does this flow belong to? Check `DOMAINS` in `src/scenarios/scenarios.ts` (the demo ships with `shopping`, `fulfillment`, `engagement`). If it doesn't fit, confirm a new domain name — you'll add a `Domain` entry too.
2. **User-facing trigger** — what action starts the flow? ("customer clicks Buy", "webhook lands", "cron fires")
3. **Done state** — what does the user see/hear when it's over? ("order confirmed banner", "email arrives", "live tracking updates")

---

## Step 2 — Trace the real flow

Spawn an Explore agent (or grep yourself if scope is small) to map every hop end-to-end. **Don't invent — read source code.** For the shipped AstroMart demo there are no source repos; the demo data is illustrative. For YOUR system, this step is the whole point.

For every hop, capture:

| Field | Description |
|---|---|
| `from` | service id (must match `SERVICES[].id` or `TOPICS[].id`) |
| `to` | service id |
| `via` | topic id — only for Kafka hops; `from → topic → to` renders as 2 edges |
| `through` | intermediate hub id — only for 3-hop broadcast: `producer → topic → hub → browser` |
| `type` | `'http' \| 'ws' \| 'kafka' \| 'internal'` |
| `label` | short noun phrase for the timeline chip (≤35 chars) |
| `title` | sentence-case side-panel header |
| `plain` | 1–3 sentence narrative for the panel |
| `payload` | optional headers + body + response sample |
| `parallel` | optional `true` if this fires alongside the previous step |

Good Explore agent prompt:
```
Trace the end-to-end flow of "<ACTION>" across these repos: <paths>.
For every step report:
  STEP N · [from] → [to]
    Protocol: HTTP | WS | Kafka | Internal
    Topic (if Kafka): exact name
    Source: file:line
    What it does: 1–3 sentences
    Payload (if HTTP/Kafka): headers + body shape
List any Kafka topics not in this existing list: <TOPICS ids>.
Don't guess — grep the source. Flag unclear hops.
```

---

## Step 3 — Inventory gaps

- Which services from the trace are **missing** from `SERVICES`? → add them (see `add-service` skill)
- Which topics from the trace are **missing** from `TOPICS`? → add them
- What is the **next free `phaseId`**? Phase ids are GLOBAL — never positional, never reused:

```bash
grep -rh 'phaseId:' src/scenarios/scenarios.ts | grep -o '[0-9]*' | sort -n | tail -1
```

- Does this scenario already exist with `status: 'soon'`? → flip it to `'ready'` and assign the phaseId.

---

## Step 4 — Add the Scenario entry

Add to the `SCENARIOS` array (grouped by domain):

```ts
{
  id: 'fulfillment.pack-and-ship',        // domain.kebab-slug — globally unique
  domain: 'fulfillment',                   // must match a DOMAINS[].id
  phaseId: 6,                              // next free GLOBAL phase id
  label: 'Pack & ship',                    // shown in the scenario picker
  color: 'var(--svc-emerald)',             // chip accent color
  status: 'ready',                         // 'ready' | 'soon'
  short: 'One sentence describing what the user experiences end-to-end.',
},
```

If the domain doesn't exist yet, add it to `DOMAINS` first:
```ts
{ id: 'my-domain', label: 'My Domain', glyph: '·', short: 'One-line domain summary' },
```

---

## Step 5 — Add the Steps

Append to the domain's steps file (`src/scenarios/steps/<domain>.ts`). All steps for this scenario share `phase: <phaseId>`.

```ts
// ─── Phase 6 — Fulfillment · Pack & ship ────────────────────────────────
{ phase: 6, from: 'storefront', to: 'api-gateway', type: 'http',
  label: 'POST /orders', title: 'Storefront → gateway: place the order',
  plain: `One to three sentences explaining what happens and why.`,
  payload: `POST /api/v1/orders
Headers:
  Content-Type: application/json
  Authorization: Bearer <jwt>

Body:
{ "cartId": "cart_01...", "shippingAddress": { ... } }

// 201 Created
{ "orderId": "ord_01..." }` },
```

### Step type reference

| `type` | When to use | Edge rendering |
|---|---|---|
| `'http'` | REST/HTTP call | amber edge |
| `'ws'` | WebSocket message | cyan edge |
| `'kafka'` | Kafka publish/consume | add `via: 'topic-id'`; renders 2 orange edges |
| `'internal'` | In-process logic, no network | dashed grey edge (self-loop if from === to) |

### Special patterns

**Kafka with intermediary:**
```ts
{ phase: 6, from: 'orders', to: 'shipping',
  via: 'orders.created', type: 'kafka', ... }
// Renders: orders → [topic node] → shipping
```

**3-hop broadcast (producer → hub → browser):**
```ts
{ phase: 6, from: 'shipping', through: 'realtime-hub', to: 'storefront',
  via: 'hub-broadcasts', type: 'kafka', ... }
// Renders: shipping → [hub-broadcasts] → realtime-hub → storefront
// When the hub is expanded, the packet re-routes through its sub-services
```

**Parallel step (fires alongside the previous step):**
```ts
{ phase: 6, ..., parallel: true }
```

**Self-loop (internal in-process step):**
```ts
{ phase: 6, from: 'orders', to: 'orders', type: 'internal',
  label: 'Persist order · DB write', ... }
```

### Tips for great steps

- **Split storage hops** into read + transform + write. Each pulse on the storage capsule tells the viewer something. Don't collapse "reads, transforms, writes" into one internal step.
- **Add payloads** for HTTP and Kafka steps whenever you know the real shape. `payload-parser.ts` auto-splits `Headers:` / `Body:` / response sections.
- **Keep `label`s under ~35 chars** — they're timeline chips.
- **Mark parallel steps** when services genuinely fire together (e.g. an email and a live push triggered by the same event).

---

## Step 6 — Verify

```bash
npx tsc -b --noEmit    # types must pass
npm run build          # vite build must pass
npm run dev            # eyeball the new scenario
```

**Hard rules:**
- ❌ Never run `tsc` without `--noEmit`/`-b` — stray `.js` files shadow `.tsx` in Vite.
- ❌ Never reuse a `phaseId`. Steps are filtered by phase — collision = wrong steps play.
- ❌ `from` / `to` / `via` ids must exactly match `SERVICES[].id` or `TOPICS[].id`. Typos silently break edges.
- ❌ `phase:` on every step must equal the scenario's `phaseId`. Mismatches = silent dead steps.

---

## Step 7 — Eyeball checklist

Open the dev server, switch to the new scenario, press play:

- [ ] Map pans + zooms to fit only the involved nodes
- [ ] Uninvolved nodes fade out (isolation effect)
- [ ] Comet packets fly along the right edges in the right order
- [ ] Step panel shows the right title + body + payload at each step
- [ ] Parallel steps fire simultaneously
- [ ] Hub expand/collapse still works (if the hub is in the flow)

**Debugging mismatches:**
- Edge not rendering? → `from`/`to`/`via` id doesn't match `SERVICES`/`TOPICS`
- Wrong steps playing? → Two steps with the same `phase` from different scenarios (`grep -rn "phase: <N>" src/scenarios/steps/`)
- Map doesn't zoom to the right set? → A service id referenced in a step isn't in `SERVICES`
