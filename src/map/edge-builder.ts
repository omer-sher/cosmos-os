import { SERVICES_BY_ID, TOPICS_BY_ID, STEPS, SCENARIOS_BY_ID, stepsForScenario } from '../scenarios/data';
import type { Protocol, Step } from '../scenarios/types';
import type { Shot } from '../scenarios/runner';

export type PosOverrides = Record<string, { x: number; y: number }>;

export interface NodeRef {
  x: number;
  y: number;
  hw: number;
  hh: number;
  isCapsule: boolean;
}

export interface EdgeRecord {
  key: string;
  d: string;
  type: Protocol;
  from: string;
  to: string;
}

export function nodeRef(id: string, ov: PosOverrides = {}): NodeRef | null {
  const svc = SERVICES_BY_ID[id];
  if (svc) {
    const pos = ov[id] ?? svc;
    return { x: pos.x, y: pos.y, hw: svc.width / 2, hh: svc.height / 2, isCapsule: true };
  }
  const topic = TOPICS_BY_ID[id];
  if (topic) {
    const pos = ov[id] ?? topic;
    return { x: pos.x, y: pos.y, hw: 11, hh: 11, isCapsule: false };
  }
  return null;
}

export function anchor(from: NodeRef, to: NodeRef): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { x: from.x, y: from.y };

  if (!from.isCapsule) {
    // Topic (circle).
    const len = Math.hypot(dx, dy);
    return {
      x: from.x + (dx / len) * (from.hw + 3),
      y: from.y + (dy / len) * (from.hh + 3),
    };
  }

  // Capsule = pill (rectangular middle + two semicircle end-caps with
  // radius = half-height). Anchor on the actual visible edge — never
  // on the bbox corners, which sit in empty space outside the pill.
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const r = from.hh + 3;                            // outset just past the border
  const halfRect = Math.max(0, from.hw - from.hh);  // half-width of the flat middle

  // Top/bottom edge first (the line exits through the rectangular middle).
  if (ay > 0) {
    const tTop = r / ay;
    const xAtTop = ax * tTop;
    if (xAtTop <= halfRect) {
      return { x: from.x + sx * xAtTop, y: from.y + sy * r };
    }
  }

  // Otherwise the exit is on an end-cap (semicircle) — ray ↔ circle:
  //   centre (sx·halfRect, 0), radius r.
  const A = ax * ax + ay * ay;
  const B = -2 * halfRect * ax;
  const C = halfRect * halfRect - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) {
    // Defensive fallback — bbox approximation.
    const t = ax * (from.hh + 4) > ay * (from.hw + 4)
      ? (from.hw + 4) / ax
      : (from.hh + 4) / ay;
    return { x: from.x + sx * ax * t, y: from.y + sy * ay * t };
  }
  const t = (-B + Math.sqrt(disc)) / (2 * A);
  return { x: from.x + sx * ax * t, y: from.y + sy * ay * t };
}

export function buildEdgePath(fromId: string, toId: string, sideIdx: number, ov: PosOverrides = {}): string | null {
  const a = nodeRef(fromId, ov);
  const b = nodeRef(toId, ov);
  if (!a || !b) return null;
  if (fromId === toId) {
    const cx = a.x;
    const cy = a.y - a.hh - 30;
    return `M ${a.x - a.hw + 8} ${a.y - a.hh + 4} Q ${cx} ${cy} ${a.x + a.hw - 8} ${a.y - a.hh + 4}`;
  }
  const start = anchor(a, b);
  const end = anchor(b, a);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  // Curve magnitude scales with edge length so SHORT edges between
  // close capsules don't get a control point inside one of the capsule
  // bodies (which would visually clip a chunk of the curve and look
  // "broken"). Capped at 38 for long edges where the curve adds clarity.
  const offsetMag = Math.min(38, Math.max(6, len * 0.18));
  const offset = sideIdx % 2 === 0 ? -offsetMag : offsetMag;
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const px = -dy / len;
  const py = dx / len;
  const cx = mx + px * offset;
  const cy = my + py * offset;
  return `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`;
}

/**
 * World-space position of a sub-service when its parent is expanded.
 * MUST mirror the orbit math in `ServiceNode.tsx > Ecosystem` — same
 * radius, same starting angle, same spacing.
 */
export function subPosition(parentId: string, subId: string, ov: PosOverrides = {}): { x: number; y: number } | null {
  const parent = SERVICES_BY_ID[parentId];
  if (!parent || !parent.subServices) return null;
  const idx = parent.subServices.findIndex((s) => s.id === subId);
  if (idx < 0) return null;
  const radius = 95; // keep in sync with Ecosystem radius
  const angle = (idx / parent.subServices.length) * Math.PI * 2 - Math.PI / 4;
  const pos = ov[parentId] ?? parent;
  return {
    x: pos.x + Math.cos(angle) * radius,
    y: pos.y + Math.sin(angle) * radius,
  };
}

/** Build a quadratic-bezier path between two world points with a small curve. */
export function buildPathBetween(
  ax: number, ay: number, bx: number, by: number, sideIdx: number,
): string {
  const offset = sideIdx % 2 === 0 ? -22 : 22;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const cx = mx + px * offset;
  const cy = my + py * offset;
  return `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
}

export function deriveEdges(ov: PosOverrides = {}): EdgeRecord[] {
  const map = new Map<string, EdgeRecord>();
  let counter = 0;
  const addEdge = (from: string, to: string, type: Protocol) => {
    const key = `${from}→${to}|${type}`;
    if (map.has(key)) return;
    const d = buildEdgePath(from, to, counter++, ov);
    if (!d) return;
    map.set(key, { key, d, type, from, to });
  };
  for (const step of STEPS) {
    if (step.via && step.through) {
      addEdge(step.from, step.via, 'kafka');
      addEdge(step.via, step.through, 'kafka');
      addEdge(step.through, step.to, 'ws');
    } else if (step.via) {
      addEdge(step.from, step.via, 'kafka');
      addEdge(step.via, step.to, 'kafka');
    } else {
      addEdge(step.from, step.to, step.type);
    }
  }
  return Array.from(map.values());
}

export function activeNodeSet(scenarioId: string | null | undefined): Set<string> | null {
  if (!scenarioId) return null;
  const scenario = SCENARIOS_BY_ID[scenarioId];
  if (!scenario || scenario.status !== 'ready') return null;
  const set = new Set<string>();
  for (const step of stepsForScenario(scenario)) {
    set.add(step.from);
    set.add(step.to);
    if (step.via) set.add(step.via);
    if (step.through) set.add(step.through);
  }
  return set;
}

export function shotNodeSet(shot: Shot | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!shot) return out;
  for (const step of shot.steps) {
    out.add(step.from);
    out.add(step.to);
    if (step.via) out.add(step.via);
    if (step.through) out.add(step.through);
  }
  return out;
}

// Re-export Step for consumers that need it alongside EdgeRecord
export type { Step };
