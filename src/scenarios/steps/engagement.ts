import type { Step } from '../types';

export const ENGAGEMENT_STEPS: Step[] = [
  // ─── Phase 5 — Back in stock ─────────────────────────────────
  { phase: 5, from: 'inventory', to: 'inventory', type: 'internal', label: 'Restock scanned — watcher fires', title: 'inventory: zero → 24 units, the watcher notices',
    plain: `A restock delivery from the GravLock factory ship is scanned into wh-luna-1: 24 pairs of the Mk IX that have been sold out for two weeks. inventory's restock watcher sees the sellable count cross zero → positive — the exact transition wishlists and banners care about.` },
  { phase: 5, from: 'inventory', to: 'notifications', via: 'inventory.back-in-stock', type: 'kafka', label: 'inventory.back-in-stock', title: 'inventory.back-in-stock — the wishlist trigger',
    plain: `The watcher publishes inventory.back-in-stock with the SKU, warehouse, and new count. notifications consumes it as the trigger for the wishlist email blast — the most-clicked email AstroMart sends.`,
    payload: `// Kafka record on inventory.back-in-stock
// key: skuId
{
  "skuId":      "sku_magboot_gravlock_9",
  "warehouse":  "wh-luna-1",
  "previousCount": 0,
  "newCount":   24,
  "restockedAt": "2199-07-24T06:12:44.203Z"
}` },
  { phase: 5, from: 'inventory', through: 'realtime-hub', to: 'storefront', via: 'hub-broadcasts', type: 'kafka', label: '"It\'s back!" → browsing sessions', title: 'hub.broadcasts: live banner for everyone on the product page', parallel: true,
    plain: `In parallel, inventory broadcasts the restock on hub.broadcasts targeting the product-page channel. hub-ingest consumes, hub-presence resolves every socket currently subscribed to that SKU's page, and hub-push delivers — every shopper staring longingly at the sold-out page gets the "It's back!" banner at the same moment.`,
    payload: `// Kafka record on hub.broadcasts — channel fan-out (no socket_id)
{
  "channel":    "product:sku_magboot_gravlock_9",
  "event_name": "back-in-stock",
  "payload": {
    "skuId":   "sku_magboot_gravlock_9",
    "name":    "GravLock Mag Boots Mk IX",
    "stock":   24,
    "message": "It's back! GravLock Mk IX just restocked."
  }
}` },
  { phase: 5, from: 'notifications', to: 'notifications', type: 'internal', label: 'Wishlist audience + batch send', title: 'notifications: 1,882 wishlist emails, batched',
    plain: `notifications resolves the wishlist audience for the SKU — 1,882 customers — applies channel preferences and the per-customer frequency cap, then batches the sends through the mail relay. First come, first served on 24 pairs; the copy says exactly that.` },
  { phase: 5, from: 'storefront', to: 'storefront', type: 'internal', label: 'Banner renders — add-to-cart re-enabled', title: 'The product page comes back to life',
    plain: `In every subscribed tab, the storefront receives the WebSocket frame, renders the "It's back!" banner, swaps the greyed-out button for a live "Add to cart", and updates the stock badge. No refresh, no polling — the page just changes.` },
  { phase: 5, from: 'storefront', to: 'api-gateway', type: 'http', label: 'PUT /v1/cart/items', title: 'The fastest shopper adds to cart',
    plain: `Eleven seconds after the banner lands, the first shopper adds the boots to their cart. The request flows through the gateway toward the cart service — and the whole shopping cycle begins again.`,
    payload: `PUT /v1/cart/items
Headers:
  Content-Type: application/json
  Authorization: Bearer eyJhbGciOi...

Body:
{
  "cartId": ":cartId",
  "skuId":  "sku_magboot_gravlock_9",
  "qty":    1
}

// 200 OK
{ "cartId": ":cartId", "items": 3, "subtotal": { "amount": 42900, "currency": "GCR" } }` },
  { phase: 5, from: 'api-gateway', to: 'cart', type: 'http', label: 'Line item → Redis', title: 'cart: line item written to Redis',
    plain: `The gateway routes the add-to-cart to the cart service, which validates the price against catalog and writes the line item to the shopper's Redis hash — TTL refreshed for another 30 days. Total time from restock scan to a claimed pair: about 14 seconds.` },
];
