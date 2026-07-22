import type { Topic } from './types';

// ══════════════════════════════════════════════════════════
//  TOPICS — AstroMart demo universe
//  Topic node radius in the design system is small (~11px). Positions
//  sit between each topic's producer and consumer(s); grouped topics
//  are re-positioned onto their owner's ring at render time.
// ══════════════════════════════════════════════════════════
const TOPIC_HEX = '#fb923c';
const TOPIC_COLOR = 'var(--svc-orange)';

export const TOPICS: Topic[] = [
  {
    id: 'orders.created',
    x: 1830, y: 810, labelSide: 'below',
    name: 'orders.created', color: TOPIC_COLOR, hex: TOPIC_HEX,
    desc: `Kafka topic. Published by orders the moment an order flips to confirmed (payment captured). Keyed by orderId so every event for the same order lands on the same partition. Fan-out to three consumers: inventory (places the stock reservation), shipping (queues the pick-and-pack job), and notifications (sends the confirmation email).`,
  },
  {
    id: 'orders.cancelled',
    x: 1700, y: 880, labelSide: 'below',
    name: 'orders.cancelled', color: TOPIC_COLOR, hex: TOPIC_HEX,
    desc: `Kafka topic. Published by orders when a shopper (or fraud review) cancels an order. Keyed by orderId. Consumers: payments (issues the refund against the original capture) and inventory (releases the reserved units back to sellable stock).`,
  },
  {
    id: 'payments.captured',
    x: 1480, y: 900, labelSide: 'above',
    name: 'payments.captured', color: TOPIC_COLOR, hex: TOPIC_HEX,
    desc: `Kafka topic. Published by payments after the processor confirms a capture — and again on refunds, with a negative amount and reason: 'refund'. Carries the ledger entry id, order id, amount, currency, and the tokenized payment method. Sole consumer: orders, which flips the order to confirmed (or refunded) on receipt.`,
  },
  {
    id: 'payments.failed',
    x: 1400, y: 1180, labelSide: 'below',
    name: 'payments.failed', color: TOPIC_COLOR, hex: TOPIC_HEX,
    desc: `Kafka topic. Published by payments when the processor declines a capture (insufficient funds, expired card, suspected fraud on a suspiciously large thruster order). Carries the decline code and a shopper-safe message. Consumer: orders, which parks the order in payment_failed so the storefront can offer a retry. Error-path sibling of payments.captured.`,
  },
  {
    id: 'inventory.reserved',
    x: 1830, y: 650, labelSide: 'above',
    name: 'inventory.reserved', color: TOPIC_COLOR, hex: TOPIC_HEX,
    desc: `Kafka topic. Published by inventory once every line item of an order has been reserved via DynamoDB conditional writes. Carries the reservation id, per-SKU warehouse assignments, and an expiry. Sole consumer: orders, which attaches the reservation to the order row — the last gate before the shopper sees "Order confirmed!".`,
  },
  {
    id: 'inventory.back-in-stock',
    x: 1700, y: 980, labelSide: 'above',
    name: 'inventory.back-in-stock', color: TOPIC_COLOR, hex: TOPIC_HEX,
    desc: `Kafka topic. Published by inventory's restock watcher when a SKU's sellable count crosses zero → positive (a restock delivery was scanned in). Carries skuId, warehouse, and the new count. Consumer: notifications, which emails everyone with the SKU wishlisted. inventory also broadcasts the same moment to live browsing sessions via hub.broadcasts.`,
  },
  {
    id: 'shipping.dispatched',
    x: 1620, y: 1190, labelSide: 'below',
    name: 'shipping.dispatched', color: TOPIC_COLOR, hex: TOPIC_HEX,
    desc: `Kafka topic. Published by shipping when the courier scans the parcel and the tracking number goes live. Carries orderId, parcelId, courier, trackingNumber, and the label's object-storage key. Consumer: notifications (tracking email). shipping also pushes the same event to the shopper's open tab via hub.broadcasts.`,
  },
  {
    id: 'hub-broadcasts',
    x: 1150, y: 940,
    name: 'hub.broadcasts', color: TOPIC_COLOR, hex: TOPIC_HEX,
    desc: `realtime-hub's input topic — every WebSocket push at AstroMart starts life as a record here. Producers: orders (order confirmed / refund confirmed), shipping (live parcel tracking), inventory (back-in-stock banners). hub-ingest consumes, calls hub-presence to resolve the target socket(s), then calls hub-push to deliver — fan-out by customer_id when no socket_id is set, precise per-tab when it is.`,
  },
];

export const TOPICS_BY_ID = Object.fromEntries(TOPICS.map(t => [t.id, t]));
