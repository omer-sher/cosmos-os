import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';

import { STEPS } from '../scenarios/data';
import type { Protocol } from '../scenarios/types';
import { PROTO_COLOR } from './Edge';
import { useEdgeRegistry } from './edge-registry';
import { legsForStep } from './edge-resolver';

gsap.registerPlugin(MotionPathPlugin);

interface AmbientPacketsProps {
  /** When true, the layer continuously fires dim packets along random edges. */
  active: boolean;
}

interface Flight {
  group: SVGGElement;
  tl: gsap.core.Timeline;
}

const PROTO_DURATION: Record<Protocol, number> = {
  internal: 1.6,
  ws: 2.0,
  http: 2.2,
  kafka: 2.4,
};

/**
 * Idle/ambient traffic layer. While no scenario is active, this picks
 * random edges (sampled from the global STEPS list) and flies a small
 * 2-layer comet along them — head dot + soft halo trail. Multiple
 * packets can be in flight concurrently. The whole system is alive
 * even when nobody's playing anything.
 */
export function AmbientPackets({ active }: AmbientPacketsProps) {
  const registry = useEdgeRegistry();
  const layerRef = useRef<SVGGElement>(null);
  const flightsRef = useRef<Flight[]>([]);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const layer = layerRef.current;
    if (!active || !layer) return undefined;

    const cleanupFlight = (f: Flight) => {
      f.tl.kill();
      if (f.group.parentNode) f.group.remove();
      flightsRef.current = flightsRef.current.filter((x) => x !== f);
    };

    const fire = () => {
      if (cancelledRef.current || !layer) return;
      // Cap concurrent flights so the canvas doesn't get busy.
      if (flightsRef.current.length >= 6) return;

      // Pick a random non-internal step (internal hops have weird self-loops).
      const candidates = STEPS.filter((s) => s.type !== 'internal');
      if (candidates.length === 0) return;
      const step = candidates[Math.floor(Math.random() * candidates.length)];
      const legs = legsForStep(step);
      if (legs.length === 0) return;
      // Just one leg per ambient packet — keeps it cheap.
      const leg = legs[Math.floor(Math.random() * legs.length)];
      const path = registry.get(leg.key);
      if (!path) return;

      const ns = 'http://www.w3.org/2000/svg';
      const color = PROTO_COLOR[leg.proto];
      const group = document.createElementNS(ns, 'g');
      group.setAttribute('pointer-events', 'none');
      group.setAttribute('opacity', '0');

      const halo = document.createElementNS(ns, 'circle');
      halo.setAttribute('r', '4');
      halo.setAttribute('fill', color);
      halo.setAttribute('fill-opacity', '0.25');
      halo.setAttribute('filter', 'url(#cosmos-packet-glow)');
      group.appendChild(halo);

      const head = document.createElementNS(ns, 'circle');
      head.setAttribute('r', '1.6');
      head.setAttribute('fill', '#FFFFFF');
      head.setAttribute('fill-opacity', '0.9');
      group.appendChild(head);

      layer.appendChild(group);

      const dur = PROTO_DURATION[leg.proto] * (0.8 + Math.random() * 0.5);
      const tl = gsap.timeline({
        onComplete: () => cleanupFlight(flight),
      });
      const flight: Flight = { group, tl };
      flightsRef.current.push(flight);

      // Fade in, fly, fade out.
      tl.to(group, { opacity: 0.7, duration: 0.25, ease: 'sine.out' }, 0);
      tl.fromTo(
        head,
        { motionPath: { path, start: 0, end: 0 } },
        { motionPath: { path, start: 0, end: 1, autoRotate: false }, duration: dur, ease: 'none' },
        0,
      );
      tl.fromTo(
        halo,
        { motionPath: { path, start: 0, end: 0 } },
        { motionPath: { path, start: 0, end: 1, autoRotate: false }, duration: dur, ease: 'none' },
        0.05,
      );
      tl.to(group, { opacity: 0, duration: 0.4, ease: 'sine.in' }, dur - 0.4);
    };

    // Spawn loop — randomised gap so it doesn't feel like a metronome.
    let timer = 0;
    const schedule = () => {
      const delay = 280 + Math.random() * 620; // 280–900ms
      timer = window.setTimeout(() => {
        fire();
        schedule();
      }, delay);
    };
    schedule();

    return () => {
      cancelledRef.current = true;
      window.clearTimeout(timer);
      flightsRef.current.forEach(cleanupFlight);
      flightsRef.current = [];
    };
  }, [active, registry]);

  return <g ref={layerRef} className="lc-ambient-packets" />;
}
