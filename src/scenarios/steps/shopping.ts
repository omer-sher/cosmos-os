import type { Step } from '../types';

export const SHOPPING_STEPS: Step[] = [
  // ─── Phase 1 — Search for a product ──────────────────────────
  { phase: 1, from: 'storefront', to: 'api-gateway', type: 'http', label: 'GET /v1/search?q=mag+boots', title: 'Shopper searches — GET /v1/search',
    plain: `The shopper types "mag boots" into the storefront search bar. After a 150ms debounce the browser fires the query at the api-gateway — the single front door for every HTTP call at AstroMart.`,
    payload: `GET /v1/search?q=mag+boots&limit=12
Headers:
  Accept: application/json
  Authorization: Bearer eyJhbGciOi...
  x-astro-session: ":sessionId"

// 200 OK (see final step for the response body)` },
  { phase: 1, from: 'api-gateway', to: 'search', type: 'http', label: 'Route to search', title: 'api-gateway validates & routes the query',
    plain: `The gateway checks the shopper's JWT, applies the per-session rate limit, stamps the request with x-astro-request-id, and proxies it to the search service. Every downstream hop carries that request id — one checkout, one trace.`,
    payload: `GET /internal/search?q=mag+boots&limit=12
Headers:
  x-astro-request-id: "req_01JXPZ8Q4T"
  x-astro-customer-id: ":customerId"
  x-astro-session: ":sessionId"` },
  { phase: 1, from: 'search', to: 'search', type: 'internal', label: 'Elasticsearch bool query', title: 'search: ranked query against the product index',
    plain: `search runs a bool query against the Elasticsearch product index — full-text match on name and description, typo tolerance ("mag botos" still works), and a boost for in-stock items and the shopper's favorite categories. Twelve ranked SKU ids come back in ~15ms.` },
  { phase: 1, from: 'search', to: 'catalog', type: 'http', label: 'Hydrate top hits', title: 'search → catalog: hydrate hits with live price & stock',
    plain: `The index stores lean documents, so search asks catalog to hydrate the top hits with the freshest data — current price, sellable stock, and the variant matrix. A single batched call, not twelve.`,
    payload: `POST /internal/products/batch
Headers:
  Content-Type: application/json
  x-astro-request-id: "req_01JXPZ8Q4T"

Body:
{
  "skuIds": ["sku_magboot_gravlock_9", "sku_magboot_titan_2", "sku_magboot_luna_lite"],
  "fields": ["name", "price", "stock", "variants", "imageKeys"]
}

// 200 OK
{
  "products": [
    {
      "skuId": "sku_magboot_gravlock_9",
      "name": "GravLock Mag Boots Mk IX",
      "price": { "amount": 42900, "currency": "GCR" },
      "stock": 17,
      "imageKeys": ["products/magboot-gravlock-9/hero.webp"]
    }
  ]
}` },
  { phase: 1, from: 'catalog', to: 'object-storage', type: 'http', label: 'Sign image URLs (read)', title: 'catalog → object-storage: presign the gallery images',
    plain: `Product images live in the astromart-assets bucket, never behind a public URL. catalog presigns a short-lived GET URL for each hero image so the storefront can render the grid without ever holding bucket credentials. A pure read hop — nothing is written.`,
    payload: `GET s3://astromart-assets/products/magboot-gravlock-9/hero.webp
Headers:
  x-amz-expires: 900

// catalog generates presigned GET URLs (15 min TTL) for each image key
// and inlines them into the product payload:
{
  "imageUrls": [
    "https://assets.astromart.dev/products/magboot-gravlock-9/hero.webp?X-Amz-Signature=..."
  ]
}` },
  { phase: 1, from: 'search', to: 'api-gateway', type: 'http', label: 'Ranked + hydrated results', title: 'search returns the assembled results page',
    plain: `search merges the Elasticsearch ranking with catalog's hydrated product data and hands the finished results page back to the gateway. Ranking decisions stay in search; product truth stays in catalog.` },
  { phase: 1, from: 'api-gateway', to: 'storefront', type: 'http', label: '200 OK — results grid', title: 'Results land in the browser — grid renders',
    plain: `The gateway streams the response back to the browser. Twelve product cards render with prices, stock badges, and signed image URLs. Total round trip: ~80ms — fast enough that the shopper never sees a spinner.`,
    payload: `// 200 OK
{
  "query": "mag boots",
  "total": 34,
  "results": [
    {
      "skuId": "sku_magboot_gravlock_9",
      "name": "GravLock Mag Boots Mk IX",
      "price": { "amount": 42900, "currency": "GCR" },
      "stock": 17,
      "badge": "BESTSELLER",
      "imageUrl": "https://assets.astromart.dev/products/magboot-gravlock-9/hero.webp?X-Amz-Signature=..."
    }
  ]
}` },

  // ─── Phase 2 — Place an order (the hero flow) ────────────────
  { phase: 2, from: 'storefront', to: 'storefront', type: 'internal', label: 'Shopper clicks "Place order"', title: 'Checkout begins — cart snapshot + idempotency key',
    plain: `The shopper hits "Place order" on a cart holding one pair of GravLock Mag Boots and a spare O₂ scrubber. The storefront freezes the cart snapshot, generates an idempotency key, and disables the button — double-clicking will never create two orders.` },
  { phase: 2, from: 'storefront', to: 'api-gateway', type: 'http', label: 'POST /v1/orders', title: 'POST /v1/orders — the checkout request',
    plain: `The browser ships the checkout payload: cart snapshot, shipping address (Luna Colony addresses are surprisingly long), the tokenized payment method, and the socketId of its live realtime-hub connection — so the confirmation can be pushed to this exact tab later.`,
    payload: `POST /v1/orders
Headers:
  Content-Type: application/json
  Authorization: Bearer eyJhbGciOi...
  x-astro-idempotency-key: "idem_01JXQ0A7C3"

Body:
{
  "cartId":   ":cartId",
  "items": [
    { "skuId": "sku_magboot_gravlock_9", "qty": 1, "unitPrice": 42900 },
    { "skuId": "sku_o2_scrubber_std",    "qty": 1, "unitPrice": 7900 }
  ],
  "currency": "GCR",
  "shippingAddress": {
    "name":   "R. Vega",
    "line1":  "Hab-Ring 4, Module 17B",
    "city":   "Luna Colony",
    "system": "Sol"
  },
  "paymentMethodToken": "pm_tok_9f2c...",
  "socketId": ":socketId"
}

// 202 Accepted
{ "orderId": ":orderId", "status": "processing" }` },
  { phase: 2, from: 'api-gateway', to: 'orders', type: 'http', label: 'Route to orders', title: 'api-gateway forwards checkout with auth context',
    plain: `The gateway validates the JWT one more time, resolves the customerId, checks the idempotency key against Redis (fresh — proceed), and forwards the request to the orders service with the full auth context attached.` },
  { phase: 2, from: 'orders', to: 'orders', type: 'internal', label: 'Draft order row (Postgres)', title: 'Order drafted — status: draft',
    plain: `orders writes the draft order row to Postgres inside a transaction: line items, totals, address, status 'draft'. The order now exists and has an id — everything after this point is recoverable, even if the process dies mid-checkout.` },
  { phase: 2, from: 'orders', to: 'payments', type: 'http', label: 'POST /v1/payments/capture', title: 'orders → payments: capture 508.00 GCR',
    plain: `orders calls payments synchronously — checkout is the one place a shopper is actively waiting, so this hop stays HTTP rather than Kafka. payments lives in its own PCI segment; orders only ever sees the token, never the card.`,
    payload: `POST /v1/payments/capture
Headers:
  Content-Type: application/json
  x-astro-request-id: "req_01JXQ0A9RD"

Body:
{
  "orderId":            ":orderId",
  "amount":             50800,
  "currency":           "GCR",
  "paymentMethodToken": "pm_tok_9f2c...",
  "idempotencyKey":     "idem_01JXQ0A7C3"
}

// 202 Accepted — capture running, result arrives on Kafka
{ "captureId": ":captureId", "status": "pending" }` },
  { phase: 2, from: 'payments', to: 'payments', type: 'internal', label: 'Processor round-trip (PCI)', title: 'payments: card authorized at the processor',
    plain: `Inside the PCI zone, payments detokenizes the payment method, calls the card processor, and writes the double-entry ledger rows. The galaxy's banks still take ~900ms to say yes — some things never change, even in 2199.` },
  { phase: 2, from: 'payments', to: 'orders', via: 'payments.captured', type: 'kafka', label: 'payments.captured', title: 'Capture confirmed — receipt on Kafka',
    plain: `The processor approved. payments publishes the capture receipt on payments.captured — keyed by orderId. orders consumes it as the authoritative "the money is real" signal. (Declines would arrive on payments.failed instead, parking the order for retry.)`,
    payload: `// Kafka record on payments.captured
// key: orderId
{
  "captureId":  ":captureId",
  "orderId":    ":orderId",
  "amount":     50800,
  "currency":   "GCR",
  "method":     "card_vault",
  "processorRef": "prc_8842190",
  "capturedAt": "2199-07-22T14:03:22.412Z"
}` },
  { phase: 2, from: 'orders', to: 'orders', type: 'internal', label: 'Status → confirmed', title: 'Order flips draft → confirmed',
    plain: `orders matches the capture receipt to the draft row and flips the status to confirmed inside the same Postgres transaction that records the ledger reference. This is the moment the order becomes a promise to ship.` },
  { phase: 2, from: 'orders', to: 'inventory', via: 'orders.created', type: 'kafka', label: 'orders.created → reserve stock', title: 'orders.created — inventory reserves the units',
    plain: `orders announces the confirmed order on orders.created. inventory consumes it and places a reservation: one GravLock Mk IX from the Luna warehouse, one O₂ scrubber from Phobos. DynamoDB conditional writes guarantee two shoppers can never claim the same last unit.`,
    payload: `// Kafka record on orders.created
// key: orderId — fan-out to inventory, shipping, notifications
{
  "orderId":    ":orderId",
  "customerId": ":customerId",
  "items": [
    { "skuId": "sku_magboot_gravlock_9", "qty": 1 },
    { "skuId": "sku_o2_scrubber_std",    "qty": 1 }
  ],
  "total":      { "amount": 50800, "currency": "GCR" },
  "shippingRegion": "luna-colony",
  "confirmedAt": "2199-07-22T14:03:22.671Z"
}` },
  { phase: 2, from: 'inventory', to: 'orders', via: 'inventory.reserved', type: 'kafka', label: 'inventory.reserved', title: 'Stock held — reservation confirmed',
    plain: `Both conditional writes succeeded, so inventory publishes inventory.reserved with the per-SKU warehouse assignments and a 48-hour expiry. orders attaches the reservation id to the order row — the last gate before the shopper gets the good news.`,
    payload: `// Kafka record on inventory.reserved
// key: orderId
{
  "reservationId": ":reservationId",
  "orderId":       ":orderId",
  "lines": [
    { "skuId": "sku_magboot_gravlock_9", "qty": 1, "warehouse": "wh-luna-1" },
    { "skuId": "sku_o2_scrubber_std",    "qty": 1, "warehouse": "wh-phobos-2" }
  ],
  "expiresAt": "2199-07-24T14:03:23.008Z"
}` },
  { phase: 2, from: 'orders', through: 'realtime-hub', to: 'storefront', via: 'hub-broadcasts', type: 'kafka', label: '"Order confirmed!" → shopper\'s tab', title: 'hub.broadcasts: Order confirmed! pushed to the originating tab',
    plain: `orders publishes the confirmation on hub.broadcasts with the socket_id from checkout. hub-ingest consumes, asks hub-presence exactly which socket that is, and hub-push delivers it down the open WebSocket — the checkout page flips to "Order confirmed!" without a single poll.`,
    payload: `// Kafka record on hub.broadcasts — routed to ONE tab
{
  "customer_id": ":customerId",
  "socket_id":   ":socketId",
  "event_name":  "order-confirmed",
  "payload": {
    "orderId":  ":orderId",
    "total":    { "amount": 50800, "currency": "GCR" },
    "eta":      "3 orbital days",
    "message":  "Order confirmed — your gear is being prepped."
  }
}` },
  { phase: 2, from: 'orders', to: 'notifications', via: 'orders.created', type: 'kafka', label: 'Confirmation email', title: 'notifications: order confirmation email', parallel: true,
    plain: `In parallel with the WebSocket push, notifications consumes the same orders.created event and renders the confirmation email — line items, totals, and the estimated delivery window. Batched through the mail relay; deduped by orderId so a consumer-group rebalance never double-sends it.` },
];
