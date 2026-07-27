---
name: add-service
description: Add a service capsule (or Kafka topic node) to the Cosmos map. Use when the user says "add service X to the cosmos", "wire X into the map", or "add a topic node for Y". Researches the service from source, maps all its connections, then adds SERVICES/TOPICS entries to src/scenarios/ with correct position, color, and tech tags. Does not add scenario steps — that's add-scenario.
---

# Add a service (or topic) to the Cosmos

Use this skill when the user says "add X to the cosmos", "wire service X into the map", or "add a topic node for Y". This covers adding a standalone capsule — it does **not** add scenario steps (use the `add-scenario` skill for that).

---

## What you'll touch

| File | Why |
|---|---|
| `src/scenarios/services.ts` | Add entries to `SERVICES` |
| `src/scenarios/topics.ts` | Add entries to `TOPICS` (only for topics used in scenario steps) |
| `src/scenarios/owners.ts` | Team ownership mapping |
| `src/scenarios/types.ts` | Only if you need a new `Tech` variant |
| `src/components/TechIcon.tsx` | Only if you added a new `Tech` variant |
| `src/styles/tokens.css` | Only if you need a new `--svc-*` color hue |
| `src/map/UICluster.tsx` | Only if the new service is a browser-facing UI surface |

---

## Step 1 — Research the service

Before touching any file, **grep and read the service's source code** (use an Explore agent for repos not in the workspace). You need:

- What does this service do? (one sentence role)
- What stack does it run on? (framework, language)
- What databases / infra does it use? (Kafka, Redis, Postgres, object storage…)
- What Kafka topics does it produce / consume?
- What HTTP endpoints does it expose or call?
- What other services call it? What does it call?
- What WebSocket connections does it open or accept?
- What is its repository name in your GitHub org?

Only proceed once you can answer all of these from source — never guess.

---

## Step 2 — Map all connections

Before writing any entry, build a connection table. This is the most important step — it determines what goes into `desc`, what Kafka topics to add, which existing service descriptions to update, and what to flag as missing.

For every connection the new service has, fill in this table:

| Direction | Protocol | Counterpart | Counterpart in cosmos? | Topic in cosmos? |
|---|---|---|---|---|
| → outbound | HTTP | `payments` | ✅ `payments` | n/a |
| ← inbound | Kafka (consume) | `orders` | ✅ `orders` | `orders.created` ❌ missing |

Rules:
- **Counterpart in cosmos?** — `grep -n "id: 'svc-id'" src/scenarios/services.ts` for each one
- **Topic in cosmos?** — `grep -n "id: 'topic-name'" src/scenarios/topics.ts` for Kafka hops
- For anything ❌: either add it now (if it's a known service) or flag it in the **Connection summary** below

After filling the table, for each ❌:

- **Missing service** → add it using this skill, OR note it as "not yet in cosmos" in `desc`
- **Missing topic** → add a `TOPICS` entry if it will be used in a scenario step `via:`; otherwise just document it in the `desc` of both producer and consumer
- **Existing service whose `desc` is now stale** → update its `desc` to mention the new connection

---

## Step 3 — Decide what to add

- **Service** = a deployed process (backend service, browser app, binary). Gets a capsule.
- **Topic** = a Kafka topic used as an intermediary between two services. Gets a small orbital node. Add a topic entry **only** if it is referenced via the `via:` field in an existing or planned scenario step.

Check it doesn't already exist first:

```bash
grep -n "id: 'your-service-id'" src/scenarios/services.ts src/scenarios/topics.ts
```

If it exists — stop, inform the user, and suggest updating the existing entry instead.

---

## Step 4 — Add the Service entry

Append to the `SERVICES` array in `src/scenarios/services.ts`, near logically related services:

```ts
{
  id: 'my-service',               // kebab-case repo name — must be unique
  x: 1300, y: 600,                // see positioning rules below
  width: 230, height: 66,         // 200–250 width; height always 66
  color: 'var(--svc-blue)',       // CSS token from tokens.css
  hex: '#4f8ff7',                 // MUST match the token's hue — used in SVG gradients
  name: 'my-service',
  sub: 'NestJS · Postgres',       // short stack line
  code: 'MYS-19',                 // arbitrary display code
  lang: 'TypeScript',
  role: 'One-line role label',
  desc: `Full description. Cover: what it owns, what triggers it,
  what it produces, AND which other services it connects to (with protocol).
  Call out any connections to services not yet in the cosmos explicitly.
  2–5 sentences.`,
  tech: ['typescript', 'nestjs', 'postgres', 'kafka'],
  repo: 'my-service',             // repo name in your org; omit for non-repo nodes (object storage etc.)
},
```

**The `desc` field must include all connections.** Pattern:
- "Receives checkout requests from `api-gateway` over HTTP"
- "Produces `orders.created` (consumed by `shipping`, `inventory`)"
- "Pushes live updates to `storefront` via `realtime-hub`"

### Positioning rules

The world is **2400 × 1400**.

- Read existing `x/y` positions before placing. Don't overlap (capsules are `width × 66`; keep ≥150px center-to-center).
- Group with logically related services — look at where the service's main callers/callees sit and join that neighborhood.
- Browser-facing UI surfaces live in the left band by convention.
- If the user gives you coordinates, use them directly.

### Colors

Pick the `--svc-*` token (see `src/styles/tokens.css`) that is least used nearby OR best matches the service's family. `hex` must visually match the token's hue — it's used in SVG gradients where CSS vars don't work. Topics always use `TOPIC_COLOR` / `TOPIC_HEX` (orange) — never change that.

If you need a truly new hue, add it to **every theme block** in `tokens.css`.

### Tech tags

Valid values are the `Tech` union in `src/scenarios/types.ts`. If you need a new tech tag:
1. Add it to the `Tech` union in `types.ts`
2. Add a `{ label, color, monogram }` entry to `TECH_META` in `src/components/TechIcon.tsx`

### Service ecosystems (sub-services)

If the service is an umbrella over several deployed processes (like the demo's `realtime-hub` = ingest + router + presence + push), use `subServices: SubService[]` instead of adding N separate capsules. The parent capsule renders a `+` expand button and explodes into a mini solar system. Slot order matters: slot 0 (NE) = intake, slot 3 (NW) = output.

If you add a **new** expandable ecosystem, also extend `legsForStep()` in `src/map/edge-resolver.ts` and the internal-edges block in `src/map/Map.tsx` (both currently handle `realtime-hub`).

### UI cluster

If the new service is a standalone browser-facing UI, add its `id` to `UI_SERVICE_IDS` in `src/map/UICluster.tsx`. Don't add embedded overlays or in-app views — standalone web surfaces only.

---

## Step 5 — Add Topic entries (if needed)

```ts
{
  id: 'my-service.event-name',   // exact Kafka topic name
  x: 1450, y: 820,               // between producer and consumer
  name: 'my-service.event-name',
  color: TOPIC_COLOR, hex: TOPIC_HEX,
  desc: `Producer: X. Consumer: Y. What it carries and when it fires.`,
},
```

---

## Step 6 — Update affected service descriptions

Go back to the connection table from Step 2. For every ✅ counterpart whose `desc` doesn't already mention the new service, update it so the relationship is visible from both sides.

---

## Step 7 — Connection summary (always output this)

```
### Connections wired into cosmos
- my-service ←HTTP— api-gateway  (api-gateway.desc updated)
- my-service —Kafka→ orders  (orders.created topic added)

### Connections NOT yet in cosmos
- my-service —HTTP→ legacy-billing  (service not in cosmos — noted in desc)
```

---

## Step 8 — Verify

```bash
npx tsc -b --noEmit    # must pass
npm run build          # must pass
```

Hard rules:
- ❌ Never run `tsc` without `--noEmit`/`-b` — stray `.js` files shadow `.tsx` in Vite and silently break the app.
- ❌ Never duplicate an `id` — ids must be unique across both `SERVICES` and `TOPICS`.
- ❌ Never place a service that overlaps an existing node.
- ❌ Never invent a `hex` that doesn't match the CSS-var hue.

---

## Quick checklist

- [ ] Researched from source (not guessed)
- [ ] Connection table filled — every counterpart checked
- [ ] `id` unique — confirmed with grep
- [ ] Position doesn't overlap
- [ ] `color`/`hex` consistent
- [ ] All `tech` values exist in the `Tech` union
- [ ] Team added/updated in `owners.ts`
- [ ] Topic nodes added for topics used in `via:` steps
- [ ] Counterpart `desc` fields updated
- [ ] Connection summary printed
- [ ] `npx tsc -b --noEmit` and `npm run build` pass
