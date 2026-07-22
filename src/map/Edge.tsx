import { useEffect, useRef } from 'react';
import gsap from 'gsap';

import type { Protocol } from '../scenarios/types';
import { useEdgeRegistry } from './edge-registry';

interface EdgeProps {
  /** Stable key used by the comet runner to look this path up. */
  edgeKey: string;
  /** Path d (quadratic bezier) — built once per edge in Map.tsx. */
  d: string;
  type: Protocol;
  dim?: boolean;
}

const PROTO_COLOR: Record<Protocol, string> = {
  http: 'var(--p-http)',
  ws: 'var(--p-ws)',
  kafka: 'var(--p-kafka)',
  internal: 'var(--p-internal)',
};

/**
 * A static edge — just the line itself, no animated packet.
 * Comet packets are rendered separately by CometPackets so they only
 * fire on the active shot rather than constantly.
 *
 * The rendered <path> is registered with the EdgeRegistry so the
 * GSAP MotionPathPlugin can read its geometry (getPointAtLength).
 */
export function Edge({ edgeKey, d, type, dim = false }: EdgeProps) {
  const ref = useRef<SVGPathElement>(null);
  const registry = useEdgeRegistry();

  useEffect(() => {
    registry.register(edgeKey, ref.current);
    return () => registry.register(edgeKey, null);
  }, [edgeKey, registry]);

  // The d attribute is managed imperatively so endpoint moves (topic groups
  // collapsing/fanning out) glide instead of snapping. All edges share the
  // same `M x y Q cx cy x y` shape, so gsap can interpolate the string.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!el.getAttribute('d')) {
      el.setAttribute('d', d);
      return undefined;
    }
    const tween = gsap.to(el, { attr: { d }, duration: 0.45, ease: 'power2.inOut', overwrite: 'auto' });
    return () => { tween.kill(); };
  }, [d]);

  const color = PROTO_COLOR[type];
  const dashed = type === 'kafka';
  const internal = type === 'internal';
  return (
    <path
      ref={ref}
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeDasharray={dashed ? '5 4' : internal ? '2 3' : undefined}
      data-dimmed={dim ? 'true' : 'false'}
      className="lc-edge"
    />
  );
}

export { PROTO_COLOR };
