import type { Service } from './types';

// ══════════════════════════════════════════════════════════
//  SERVICES — AstroMart demo universe
//  AstroMart is a fictional space-gear e-commerce platform
//  ("outfitting the galaxy since 2199"). Twelve services across
//  three teams: shopping, fulfillment, engagement.
//  `color` → CSS token (theme-aware). `hex` → for SVG <radialGradient>.
// ══════════════════════════════════════════════════════════
export const SERVICES: Service[] = [
  // ── Shopping cluster (left / top-left) ────────────────────────────────
  {
    id: 'storefront',
    x: 260, y: 700, width: 230, height: 66,
    color: 'var(--svc-cyan)', hex: '#22d3ee',
    name: 'storefront', sub: 'shop.astromart.dev · React',
    code: 'SF-01', lang: 'TypeScript', team: 'team-shopping' as const,
    role: 'Customer-facing web store',
    desc: `The React storefront every customer lands on — product pages, cart drawer, checkout, order tracking. Talks exclusively to api-gateway over HTTP and keeps one WebSocket open to realtime-hub (via hub-push) for live updates: order confirmations, parcel tracking, and back-in-stock banners. The only thing a shopper ever touches directly.`,
    tech: ['typescript', 'react'],
    repo: 'storefront',
  },
  {
    id: 'api-gateway',
    x: 660, y: 560, width: 230, height: 66,
    color: 'var(--svc-blue)', hex: '#4f8ff7',
    name: 'api-gateway', sub: 'Node.js · Koa · edge auth',
    code: 'GW-02', lang: 'TypeScript', team: 'team-shopping' as const,
    role: 'Single HTTP front door',
    desc: `The single HTTP entry point for the storefront. Terminates sessions, validates the shopper's JWT, applies rate limits, and routes each request to the owning service: /v1/search → search, /v1/products → catalog, /v1/cart → cart, /v1/orders → orders. Stamps every request with x-astro-request-id so a checkout can be traced across the whole cosmos.`,
    tech: ['typescript', 'nodejs', 'koa', 'redis'],
    repo: 'api-gateway',
  },
  {
    id: 'cart',
    x: 700, y: 280, width: 200, height: 66,
    color: 'var(--svc-red)', hex: '#f55b5b',
    name: 'cart', sub: 'Node.js · Redis',
    code: 'CRT-03', lang: 'TypeScript', team: 'team-shopping' as const,
    role: 'Session cart store',
    desc: `Holds the shopper's cart as a Redis hash keyed by cartId, with a 30-day TTL that refreshes on every touch. Serves GET/PUT /v1/cart through api-gateway, validates line items against catalog prices on read, and hands the final cart snapshot to orders at checkout. Deliberately boring: no Kafka, no Postgres — just fast Redis reads on the hottest path in the shop.`,
    tech: ['typescript', 'nodejs', 'redis'],
    repo: 'cart',
  },
  {
    id: 'search',
    x: 1140, y: 260, width: 210, height: 66,
    color: 'var(--svc-amber)', hex: '#f5b731',
    name: 'search', sub: 'Node.js · Elasticsearch',
    code: 'SRC-04', lang: 'TypeScript', team: 'team-shopping' as const,
    role: 'Product search & ranking',
    desc: `Full-text product search over an Elasticsearch index of the entire AstroMart catalog — helmets, mag-boots, thruster packs. Receives /v1/search queries from api-gateway, runs a bool query with typo tolerance and category boosts, then calls catalog over HTTP to hydrate the top hits with live price and stock before responding. Re-indexes nightly from catalog's Postgres.`,
    tech: ['typescript', 'nodejs', 'elastic'],
    repo: 'search',
  },
  {
    id: 'catalog',
    x: 1140, y: 540, width: 210, height: 66,
    color: 'var(--svc-green)', hex: '#34d399',
    name: 'catalog', sub: 'NestJS · Postgres',
    code: 'CTL-05', lang: 'TypeScript', team: 'team-shopping' as const,
    role: 'Product record owner',
    desc: `Owns the Product record in Postgres — SKUs, variants, pricing, spec sheets ("rated to -270°C"). Serves /v1/products to the storefront through api-gateway and hydrates search results with live price and stock on request. Product images live in object-storage; catalog resolves each SKU's gallery to short-lived signed URLs so the storefront never talks to the bucket directly.`,
    tech: ['typescript', 'nestjs', 'postgres'],
    repo: 'catalog',
  },

  // ── Fulfillment cluster (right) ───────────────────────────────────────
  {
    id: 'orders',
    x: 1600, y: 720, width: 210, height: 66,
    color: 'var(--svc-purple)', hex: '#a855f7',
    name: 'orders', sub: 'NestJS · Postgres',
    code: 'ORD-06', lang: 'TypeScript', team: 'team-fulfillment' as const,
    role: 'Order lifecycle owner',
    desc: `The source of truth for every order. Receives checkout POSTs from api-gateway, writes a draft order row in Postgres, calls payments synchronously to capture, then flips the order to confirmed when payments.captured arrives. Publishes orders.created (consumed by inventory, shipping, notifications) and orders.cancelled (consumed by payments, inventory). Consumes inventory.reserved to attach the stock hold, and broadcasts "Order confirmed!" to the shopper's live tab via hub.broadcasts through realtime-hub.`,
    tech: ['typescript', 'nestjs', 'postgres', 'kafka'],
    repo: 'orders',
  },
  {
    id: 'payments',
    x: 1560, y: 1060, width: 220, height: 66,
    color: 'var(--svc-pink)', hex: '#f472b6',
    name: 'payments', sub: 'NestJS · Postgres · PCI zone',
    code: 'PAY-07', lang: 'TypeScript', team: 'team-fulfillment' as const,
    role: 'Payment capture & refunds',
    desc: `The only service allowed to touch card data — runs in its own locked-down PCI segment, everything else sees tokens. orders calls POST /v1/payments/capture synchronously at checkout; payments talks to the processor, vaults the payment method, and answers on Kafka: payments.captured on success (also emitted with a negative amount for refunds), payments.failed when the processor declines. Consumes orders.cancelled to issue refunds. Ledger rows in Postgres, immutable, double-entry.`,
    tech: ['typescript', 'nestjs', 'postgres', 'kafka'],
    repo: 'payments',
  },
  {
    id: 'inventory',
    x: 2060, y: 720, width: 220, height: 66,
    color: 'var(--svc-teal)', hex: '#38bdf8',
    name: 'inventory', sub: 'Node.js · DynamoDB',
    code: 'INV-08', lang: 'TypeScript', team: 'team-fulfillment' as const,
    role: 'Stock levels & reservations',
    desc: `Tracks stock per SKU per warehouse in DynamoDB, using conditional writes so two shoppers can never claim the last mag-boot. Consumes orders.created to place a reservation and answers with inventory.reserved; consumes orders.cancelled to release the hold. An internal restock watcher notices when a zero-stock SKU comes back and publishes inventory.back-in-stock — the trigger for wishlist emails and live "It's back!" banners via realtime-hub.`,
    tech: ['typescript', 'nodejs', 'dynamodb', 'kafka'],
    repo: 'inventory',
  },
  {
    id: 'shipping',
    x: 2060, y: 1060, width: 210, height: 66,
    color: 'var(--svc-orange)', hex: '#fb923c',
    name: 'shipping', sub: 'NestJS · Postgres · courier APIs',
    code: 'SHP-09', lang: 'TypeScript', team: 'team-fulfillment' as const,
    role: 'Packing, labels & couriers',
    desc: `Turns a confirmed order into a parcel. Consumes orders.created, builds the pick list, rate-shops the courier APIs (Orbital Express vs. LunaPost), and uploads the generated label PDF to object-storage. Once the courier scans the parcel it publishes shipping.dispatched — notifications mails the tracking link, and shipping pushes live tracking to the shopper's open tab via hub.broadcasts through realtime-hub.`,
    tech: ['typescript', 'nestjs', 'postgres', 'kafka', 's3'],
    repo: 'shipping',
  },

  // ── Engagement cluster (bottom-center) ────────────────────────────────
  {
    id: 'notifications',
    x: 1180, y: 1250, width: 240, height: 66,
    color: 'var(--svc-rose)', hex: '#ec4899',
    name: 'notifications', sub: 'Node.js · email + push',
    code: 'NTF-10', lang: 'TypeScript', team: 'team-engagement' as const,
    role: 'Email & push delivery',
    desc: `Everything AstroMart sends that isn't a WebSocket frame. Consumes orders.created (order confirmation email), shipping.dispatched (tracking email), and inventory.back-in-stock (wishlist "it's back" blast). Renders MJML templates, batches sends through the mail relay, honors per-customer channel preferences, and dedupes so nobody gets the same "your helmet shipped" email twice.`,
    tech: ['typescript', 'nodejs', 'kafka', 'redis'],
    repo: 'notifications',
  },
  {
    id: 'realtime-hub',
    x: 840, y: 1020, width: 240, height: 66,
    color: 'var(--svc-magenta)', hex: '#e879f9',
    name: 'realtime-hub', sub: 'hub-ingest → hub-push',
    code: 'HUB-11', lang: 'Node.js', team: 'team-engagement' as const,
    role: 'Realtime pub/sub fan-out',
    desc: `The WebSocket layer that makes the storefront feel alive. Every browser tab holds one socket to hub-push; every backend broadcast lands on the hub.broadcasts Kafka topic. hub-ingest consumes it, asks hub-presence which socket(s) belong to the target customer, then calls hub-push to deliver — per-tab when a socket_id is set, fan-out to all of a customer's tabs otherwise. Order confirmations, live parcel tracking, and back-in-stock banners all flow through here.`,
    tech: ['nodejs', 'typescript', 'kafka'],
    repo: 'realtime-hub',
    // Order matters — slot 0 → NE (closest to the hub.broadcasts intake),
    // slot 1 → SE, slot 2 → SW, slot 3 → NW. Reads as the data path:
    // ingest (intake) → router → presence → push (output to storefront).
    subServices: [
      {
        id: 'hub-ingest',
        name: 'hub-ingest',
        sub: 'Kafka → WS fan-out',
        role: 'Broadcast consumer (intake)',
        desc: `Consumes the hub.broadcasts Kafka topic — the single intake into the entire realtime-hub ecosystem. Every backend broadcast at AstroMart lands here first. Calls hub-presence to resolve the target socket(s) by socket_id (single tab) or customer_id (all of a customer's tabs), then calls hub-push to deliver the message.`,
        tech: ['nodejs', 'typescript', 'kafka'],
        repo: 'hub-ingest',
      },
      {
        id: 'hub-router',
        name: 'hub-router',
        sub: 'Channel routing',
        role: 'Topic & channel routing rules',
        desc: `Owns the channel-subscription rules — which event types a given page is allowed to receive (order events on /orders, stock banners on product pages). hub-push consults it out-of-band when a socket subscribes or changes page, so routing decisions stay off the hot broadcast path.`,
        tech: ['nodejs', 'typescript', 'redis'],
        repo: 'hub-router',
      },
      {
        id: 'hub-presence',
        name: 'hub-presence',
        sub: 'Connection ledger',
        role: 'Session ledger + presence',
        desc: `Connection registry and presence ledger. Tracks every live WebSocket's lifecycle — open, heartbeat, close — and maps socket_id / customer_id to the hub-push pod hosting that connection. hub-ingest calls it on every broadcast to resolve delivery targets.`,
        tech: ['nodejs', 'typescript', 'redis'],
        repo: 'hub-presence',
      },
      {
        id: 'hub-push',
        name: 'hub-push',
        sub: 'WebSocket gateway',
        role: 'Browser-facing WS endpoint',
        desc: `Long-lived WebSocket server every storefront tab connects to. Owns the live socket → socket_id mapping and is the only hub process the browser talks to. Receives delivery calls from hub-ingest (POST /sockets/:socketId/send) and pushes messages down the open WebSocket to the storefront.`,
        tech: ['nodejs', 'typescript'],
        repo: 'hub-push',
      },
    ],
  },

  // ── Platform infra ────────────────────────────────────────────────────
  {
    id: 'object-storage',
    x: 2360, y: 360, width: 220, height: 66,
    color: 'var(--svc-emerald)', hex: '#34a853',
    name: 'object-storage', sub: 'S3-compatible · astromart-assets',
    code: 'OBJ-12', lang: 'Infra',
    role: 'Object store · images & labels',
    desc: `S3-compatible bucket (astromart-assets) holding everything too big for a database row. Two main tenants: product image galleries, written by the catalog ingest pipeline and read back as signed URLs on every product page; and courier label PDFs, uploaded by shipping at pack time under labels/<orderId>/<parcelId>.pdf. Nothing talks to it without a presigned URL.`,
    tech: ['s3'],
  },
];

export const SERVICES_BY_ID = Object.fromEntries(SERVICES.map(s => [s.id, s]));
