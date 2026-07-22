import type { Domain, Scenario } from './types';

// ══════════════════════════════════════════════════════════
//  DOMAINS — AstroMart demo universe
// ══════════════════════════════════════════════════════════
export const DOMAINS: Domain[] = [
  { id: 'shopping',    label: 'Shopping',    glyph: '·', short: 'Browse & buy' },
  { id: 'fulfillment', label: 'Fulfillment', glyph: '·', short: 'After the checkout' },
  { id: 'engagement',  label: 'Engagement',  glyph: '·', short: 'Live updates & notifications' },
];

// ══════════════════════════════════════════════════════════
//  SCENARIOS
//  `phaseId` is the GLOBAL phase id (matches every Step.phase). It must
//  be unique across all domains — never positional.
// ══════════════════════════════════════════════════════════
export const SCENARIOS: Scenario[] = [
  // ── Shopping ───────────────────────────────────────────────
  { id: 'shopping.search', domain: 'shopping', phaseId: 1, label: 'Search for a product', color: 'var(--svc-amber)', status: 'ready',
    short: 'A shopper types "mag boots" — the query fans through search, gets hydrated by catalog, and comes back with signed image URLs from object-storage.' },
  { id: 'shopping.place-order', domain: 'shopping', phaseId: 2, label: 'Place an order', color: 'var(--svc-purple)', status: 'ready',
    short: 'The hero flow: checkout POST → order drafted → payment captured → stock reserved → "Order confirmed!" pushed to the shopper\'s tab via realtime-hub, with the confirmation email in parallel.' },

  // ── Fulfillment ────────────────────────────────────────────
  { id: 'fulfillment.pack-and-ship', domain: 'fulfillment', phaseId: 3, label: 'Pack & ship', color: 'var(--svc-orange)', status: 'ready',
    short: 'A confirmed order lands in the packing queue — shipping rate-shops couriers, uploads the label PDF to object-storage, and shipping.dispatched fans out to email + live tracking.' },
  { id: 'fulfillment.cancel-refund', domain: 'fulfillment', phaseId: 4, label: 'Cancel & refund', color: 'var(--svc-pink)', status: 'ready',
    short: 'The shopper cancels — orders.cancelled fans out to payments (refund at the processor) and inventory (stock released), and the refund receipt closes the loop back to the shopper\'s tab.' },

  // ── Engagement ─────────────────────────────────────────────
  { id: 'engagement.back-in-stock', domain: 'engagement', phaseId: 5, label: 'Back in stock', color: 'var(--svc-teal)', status: 'ready',
    short: 'A restock delivery is scanned in — inventory.back-in-stock triggers wishlist emails via notifications and a live "It\'s back!" banner to browsing sessions through realtime-hub.' },
];

export const SCENARIOS_BY_ID = Object.fromEntries(SCENARIOS.map(s => [s.id, s]));

export function scenariosForDomain(domainId: string): Scenario[] {
  return SCENARIOS.filter(s => s.domain === domainId);
}
export function readyScenariosForDomain(domainId: string): Scenario[] {
  return scenariosForDomain(domainId).filter(s => s.status === 'ready');
}
