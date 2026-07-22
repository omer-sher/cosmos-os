import type { Step } from '../types';

export const FULFILLMENT_STEPS: Step[] = [
  // ─── Phase 3 — Pack & ship ───────────────────────────────────
  { phase: 3, from: 'orders', to: 'shipping', via: 'orders.created', type: 'kafka', label: 'orders.created → packing queue', title: 'A confirmed order lands in the packing queue',
    plain: `shipping consumes the same orders.created event that inventory and notifications saw — it just cares about different fields. The order joins the wh-luna-1 packing queue, sorted by promised delivery window.`,
    payload: `// Kafka record on orders.created (shipping consumer group)
// key: orderId
{
  "orderId":    ":orderId",
  "customerId": ":customerId",
  "items": [
    { "skuId": "sku_magboot_gravlock_9", "qty": 1 },
    { "skuId": "sku_o2_scrubber_std",    "qty": 1 }
  ],
  "shippingAddress": {
    "name":   "R. Vega",
    "line1":  "Hab-Ring 4, Module 17B",
    "city":   "Luna Colony",
    "system": "Sol"
  },
  "shippingRegion": "luna-colony"
}` },
  { phase: 3, from: 'shipping', to: 'shipping', type: 'internal', label: 'Pick list + courier rate-shop', title: 'shipping: pick list built, couriers rate-shopped',
    plain: `shipping explodes the order into a warehouse pick list, weighs the parcel (mag boots are heavy — that's the point), and rate-shops the courier APIs. Orbital Express wins on price for Luna Colony; LunaPost keeps losing on the vacuum surcharge.` },
  { phase: 3, from: 'shipping', to: 'object-storage', type: 'http', label: 'PUT label PDF (write)', title: 'Courier label PDF uploaded to object-storage',
    plain: `The Orbital Express API returns a label PDF. shipping uploads it to the astromart-assets bucket under labels/<orderId>/<parcelId>.pdf — a pure write hop. The warehouse printer and any future support ticket both read it from here, never from the courier API again.`,
    payload: `PUT s3://astromart-assets/labels/:orderId/:parcelId.pdf
Headers:
  Content-Type: application/pdf
  Content-Length: 48211
  x-amz-meta-courier: orbital-express

// 200 OK
{ "etag": "\\"9d38b2a1\\"", "key": "labels/:orderId/:parcelId.pdf" }` },
  { phase: 3, from: 'shipping', to: 'shipping', type: 'internal', label: 'Courier scan → dispatched', title: 'Parcel scanned by the courier — status: dispatched',
    plain: `A few hours later the Orbital Express pickup drone scans the parcel at the dock. The courier webhook flips the parcel to dispatched and the tracking number goes live. This scan is the trigger for everything that follows.` },
  { phase: 3, from: 'shipping', to: 'notifications', via: 'shipping.dispatched', type: 'kafka', label: 'shipping.dispatched → tracking email', title: 'shipping.dispatched — notifications mails the tracking link',
    plain: `shipping publishes shipping.dispatched with the courier, tracking number, and the label's storage key. notifications consumes it and renders the "your gear is on the way" email with a live tracking link.`,
    payload: `// Kafka record on shipping.dispatched
// key: orderId
{
  "orderId":        ":orderId",
  "parcelId":       ":parcelId",
  "customerId":     ":customerId",
  "courier":        "orbital-express",
  "trackingNumber": "OE-449-LUNA-88121",
  "labelKey":       "labels/:orderId/:parcelId.pdf",
  "eta":            "2199-07-25T09:00:00.000Z",
  "dispatchedAt":   "2199-07-22T21:14:05.881Z"
}` },
  { phase: 3, from: 'shipping', through: 'realtime-hub', to: 'storefront', via: 'hub-broadcasts', type: 'kafka', label: 'Live tracking → open tab', title: 'hub.broadcasts: live tracking pushed to the shopper\'s tab', parallel: true,
    plain: `In parallel with the email, shipping broadcasts the dispatch on hub.broadcasts. No socket_id this time — hub-presence fans out to every open tab the customer has, and the order-status page animates from "packing" to "in transit" while they watch.`,
    payload: `// Kafka record on hub.broadcasts — fan-out to all of the customer's tabs
{
  "customer_id": ":customerId",
  "event_name":  "parcel-dispatched",
  "payload": {
    "orderId":        ":orderId",
    "trackingNumber": "OE-449-LUNA-88121",
    "courier":        "orbital-express",
    "eta":            "3 orbital days",
    "position":       "departed wh-luna-1"
  }
}` },
  { phase: 3, from: 'notifications', to: 'notifications', type: 'internal', label: 'Tracking email rendered + sent', title: 'notifications: tracking email out the door',
    plain: `notifications renders the MJML template with the tracking widget, checks the customer's channel preferences (email: yes, push: muted after 22:00 Luna time), and hands the message to the mail relay. Deduped by parcelId — one scan, one email.` },

  // ─── Phase 4 — Cancel & refund ───────────────────────────────
  { phase: 4, from: 'storefront', to: 'api-gateway', type: 'http', label: 'POST /v1/orders/:id/cancel', title: 'Shopper cancels — POST /v1/orders/:id/cancel',
    plain: `Buyer's remorse strikes before the parcel leaves the dock: the shopper hits "Cancel order" on the order-status page. The storefront calls the cancel endpoint through the gateway.`,
    payload: `POST /v1/orders/:orderId/cancel
Headers:
  Content-Type: application/json
  Authorization: Bearer eyJhbGciOi...

Body:
{
  "reason":   "changed_mind",
  "socketId": ":socketId"
}

// 202 Accepted
{ "orderId": ":orderId", "status": "cancelling" }` },
  { phase: 4, from: 'api-gateway', to: 'orders', type: 'http', label: 'Route cancel to orders', title: 'api-gateway forwards the cancellation',
    plain: `The gateway verifies the shopper actually owns this order, then forwards the cancel to the orders service. orders checks the state machine: not yet dispatched, so cancellation is still allowed — it flips the order to cancelling.` },
  { phase: 4, from: 'orders', to: 'payments', via: 'orders.cancelled', type: 'kafka', label: 'orders.cancelled → refund', title: 'orders.cancelled — payments starts the refund',
    plain: `orders publishes orders.cancelled. payments consumes it, looks up the original capture in its ledger, and queues a full refund against the processor.`,
    payload: `// Kafka record on orders.cancelled
// key: orderId — fan-out to payments and inventory
{
  "orderId":     ":orderId",
  "customerId":  ":customerId",
  "reason":      "changed_mind",
  "captureId":   ":captureId",
  "reservationId": ":reservationId",
  "cancelledAt": "2199-07-23T08:41:12.007Z"
}` },
  { phase: 4, from: 'orders', to: 'inventory', via: 'orders.cancelled', type: 'kafka', label: 'Release reserved stock', title: 'inventory releases the hold', parallel: true,
    plain: `In parallel, inventory consumes the same orders.cancelled event and releases the reservation — the GravLock boots and the O₂ scrubber flow back into sellable stock with a single DynamoDB update each. Someone else's search results just got one unit better.` },
  { phase: 4, from: 'payments', to: 'payments', type: 'internal', label: 'Refund at the processor', title: 'payments: refund issued in the PCI zone',
    plain: `payments issues the refund against the original processor reference and writes the reversing double-entry ledger rows. The money takes 2–3 business days to appear — banking regulations survived the colonization of Mars.` },
  { phase: 4, from: 'payments', to: 'orders', via: 'payments.captured', type: 'kafka', label: 'Refund receipt (negative capture)', title: 'payments.captured — the refund receipt closes the ledger',
    plain: `The refund receipt travels back on payments.captured — same topic as the original capture, with a negative amount and reason: 'refund'. orders matches it to the cancelling order and flips the final status to refunded.`,
    payload: `// Kafka record on payments.captured (refund event)
// key: orderId
{
  "captureId":    ":refundCaptureId",
  "orderId":      ":orderId",
  "amount":       -50800,
  "currency":     "GCR",
  "reason":       "refund",
  "originalCaptureId": ":captureId",
  "processorRef": "prc_8842190-R1",
  "capturedAt":   "2199-07-23T08:41:14.339Z"
}` },
  { phase: 4, from: 'orders', through: 'realtime-hub', to: 'storefront', via: 'hub-broadcasts', type: 'kafka', label: '"Refund on the way" → shopper\'s tab', title: 'hub.broadcasts: refund confirmation pushed to the tab',
    plain: `orders broadcasts the resolution on hub.broadcasts with the socket_id from the cancel request. hub-ingest → hub-presence → hub-push, and the order page flips to "Cancelled — refund on the way" in the same tab that asked. The loop closes in under two seconds.`,
    payload: `// Kafka record on hub.broadcasts — routed to ONE tab
{
  "customer_id": ":customerId",
  "socket_id":   ":socketId",
  "event_name":  "order-refunded",
  "payload": {
    "orderId": ":orderId",
    "amount":  { "amount": 50800, "currency": "GCR" },
    "message": "Order cancelled — your refund is on the way."
  }
}` },
];
