/**
 * Edge resolution — given a Step, return the ordered list of edges
 * the packet should travel along.
 *
 *   internal  → 1 edge  (from → to)
 *   ws / http → 1 edge  (from → to)
 *   kafka     → 2 edges (from → via, via → to)
 *   3-hop     → 3 edges (from → via, via → through, through → to)
 *
 * Each leg carries the wire colour (kafka legs are orange, the final
 * WS hop in a 3-hop broadcast is cyan, etc).
 */

import type { Protocol, Step } from '../scenarios/types';

export interface EdgeLeg {
  /** Same key shape used in Map.tsx so we can look up the rendered <path>. */
  key: string;
  proto: Protocol;
  from: string;
  to: string;
}

function edgeKey(from: string, to: string, proto: Protocol): string {
  return `${from}→${to}|${proto}`;
}

export function legsForStep(step: Step, expanded?: Set<string> | null): EdgeLeg[] {
  // 3-hop broadcast through realtime-hub, AND the hub's ecosystem is
  // currently expanded → reroute through ingest → presence → push so the
  // packet visibly traverses the hub's internals.
  if (step.via && step.through === 'realtime-hub' && expanded?.has('realtime-hub')) {
    return [
      { key: edgeKey(step.from, step.via, 'kafka'), proto: 'kafka', from: step.from, to: step.via },
      { key: edgeKey(step.via, 'hub-ingest', 'kafka'), proto: 'kafka', from: step.via, to: 'hub-ingest' },
      { key: edgeKey('hub-ingest', 'hub-presence', 'http'), proto: 'http', from: 'hub-ingest', to: 'hub-presence' },
      { key: edgeKey('hub-presence', 'hub-ingest', 'http'), proto: 'http', from: 'hub-presence', to: 'hub-ingest' },
      { key: edgeKey('hub-ingest', 'hub-push', 'http'), proto: 'http', from: 'hub-ingest', to: 'hub-push' },
      { key: edgeKey('hub-push', step.to, 'ws'), proto: 'ws', from: 'hub-push', to: step.to },
    ];
  }
  if (step.via && step.through) {
    return [
      { key: edgeKey(step.from, step.via, 'kafka'), proto: 'kafka', from: step.from, to: step.via },
      { key: edgeKey(step.via, step.through, 'kafka'), proto: 'kafka', from: step.via, to: step.through },
      { key: edgeKey(step.through, step.to, 'ws'), proto: 'ws', from: step.through, to: step.to },
    ];
  }
  if (step.via) {
    return [
      { key: edgeKey(step.from, step.via, 'kafka'), proto: 'kafka', from: step.from, to: step.via },
      { key: edgeKey(step.via, step.to, 'kafka'), proto: 'kafka', from: step.via, to: step.to },
    ];
  }
  return [{ key: edgeKey(step.from, step.to, step.type), proto: step.type, from: step.from, to: step.to }];
}

export { edgeKey };
