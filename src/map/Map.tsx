import { useEffect, useMemo, useRef, useState } from 'react';

import {
  SCENARIOS_BY_ID,
  SERVICES,
  SERVICES_BY_ID,
  STEPS,
  TOPICS,
  TOPICS_BY_ID,
  stepsForScenario,
} from '../scenarios/data';
import type { Protocol, Service, Step, Topic } from '../scenarios/types';
import type { Shot } from '../scenarios/runner';
import { useMapView } from '../hooks/useMapView';
import type { BBox } from '../hooks/useMapView';
import { buildPathBetween, deriveEdges, activeNodeSet, shotNodeSet, subPosition } from './edge-builder';
import type { EdgeRecord, PosOverrides } from './edge-builder';

import { Edge } from './Edge';
import { edgeKey } from './edge-resolver';
import { ServiceNode } from './ServiceNode';
import { TopicNode } from './TopicNode';
import { CONNECTED_NODE_IDS, TOPIC_GROUPS, radialMemberPosition } from './topic-groups';
import type { TopicGroup } from './topic-groups';
import { ServicePanel } from './ServicePanel';
import { TopicPanel } from './TopicPanel';
import { SubServicePanel } from './SubServicePanel';
import { CometPackets } from './CometPackets';
import { AmbientPackets } from './AmbientPackets';
import { UICluster } from './UICluster';
import { ShoppingCluster } from './ShoppingCluster';
import { FulfillmentCluster } from './FulfillmentCluster';
import { EngagementCluster } from './EngagementCluster';
import { EdgeRegistryContext, createEdgeRegistry } from './edge-registry';

const WORLD_MIN_Y = -200;
const WORLD_W = 4000;
const WORLD_H = 2300;

// Bbox of every service capsule, padded to cover topic fan-out rings and
// cluster halos. Defines the home view: initial frame, reset target, and
// the wheel-zoom-out floor.
// service id → every topic it touches in any step (as producer, consumer,
// or broadcast hop). Used to fan out the relevant topic groups on selection.
const TOPICS_TOUCHING_SERVICE: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  const add = (svc: string, topic: string) => {
    const set = m.get(svc) ?? new Set<string>();
    set.add(topic);
    m.set(svc, set);
  };
  for (const s of STEPS) {
    if (!s.via) continue;
    add(s.from, s.via);
    add(s.to, s.via);
    if (s.through) add(s.through, s.via);
  }
  return m;
})();

const HOME_BBOX: BBox = (() => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of SERVICES) {
    minX = Math.min(minX, s.x - s.width / 2);
    minY = Math.min(minY, s.y - s.height / 2);
    maxX = Math.max(maxX, s.x + s.width / 2);
    maxY = Math.max(maxY, s.y + s.height / 2);
  }
  const pad = 170;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
})();

type Selection =
  | { kind: 'service'; id: string }
  | { kind: 'topic'; id: string }
  | { kind: 'sub-service'; serviceId: string; subId: string }
  | null;

interface MapProps {
  /** When set, edges/nodes outside the active scenario fade. */
  activeScenarioId?: string | null;
  /** Latest shot from the runner — drives comet animation. */
  shot?: Shot | null;
  speed?: number;
  onShotComplete?: (token: number) => void;
  /** True when the runner is actively playing — auto-isolates the map. */
  isolate?: boolean;
  /** True for the first ~2.6s after the intro CTA — drives the ignite reveal. */
  revealing?: boolean;
  /** Set by the spotlight to pan+select a node; cleared after consumption. */
  spotlightTarget?: { id: string; kind: 'service' | 'topic' } | null;
  onSpotlightConsumed?: () => void;
}


export function CosmosMap({
  activeScenarioId = null,
  shot = null,
  speed = 1,
  onShotComplete,
  isolate = false,
  revealing = false,
  spotlightTarget = null,
  onSpotlightConsumed,
}: MapProps) {
  const [selection, setSelection] = useState<Selection>(null);
  const expandedServiceId: string | null = null;

  // ── Layout edit mode ────────────────────────────────────────
  const [layoutMode, setLayoutMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [overrides, setOverrides] = useState<PosOverrides>(() => {
    try { return JSON.parse(localStorage.getItem('cosmos-layout') ?? '{}') as PosOverrides; }
    catch { return {}; }
  });
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const svgElRef = useRef<SVGSVGElement | null>(null);
  const expandedSet = useMemo(
    () => (expandedServiceId ? new Set([expandedServiceId]) : null),
    [expandedServiceId],
  );

  // For realtime-hub's expanded ecosystem: which destinations does the
  // active scenario actually broadcast to via the hub? (Currently only
  // the storefront.) Only render the corresponding outbound edges when
  // a scenario is active; show all when none is.
  const hubDestinations = useMemo<Set<string> | null>(() => {
    if (!activeScenarioId) return null;
    const scenario = SCENARIOS_BY_ID[activeScenarioId];
    if (!scenario || scenario.status !== 'ready') return null;
    const dests = new Set<string>();
    for (const step of stepsForScenario(scenario)) {
      if (step.through === 'realtime-hub') dests.add(step.to);
    }
    return dests;
  }, [activeScenarioId]);

  // Which hub sub-services participate in the active scenario's path?
  // Ingest / presence / push are always on the path when the hub is used;
  // router is consulted out-of-band so it stays dimmed during a scenario.
  const hubActiveSubs = useMemo<Set<string> | null>(() => {
    if (!activeScenarioId) return null;
    if (!hubDestinations || hubDestinations.size === 0) return new Set();
    return new Set(['hub-ingest', 'hub-presence', 'hub-push']);
  }, [activeScenarioId, hubDestinations]);

  // Stable for the lifetime of this component — paths are mounted
  // by Edge children and read by CometPackets.
  const registry = useRef(createEdgeRegistry()).current;

  const { view, bind, zoomBy, reset, fitTo, toWorld, panning } = useMapView({
    worldW: WORLD_W,
    worldH: WORLD_H,
    worldMinY: WORLD_MIN_Y,
    homeBBox: HOME_BBOX,
  });

  // When the scenario changes (and isn't cleared), reframe the map so
  // every node it touches fits inside the visible area — leaving room
  // on the right for the step explainer panel.
  useEffect(() => {
    if (activeScenarioId) setSelection(null);
  }, [activeScenarioId]);

  // Esc clears the selected service/topic inspector and resets the view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if ((e.target as HTMLElement)?.matches('input, textarea, [contenteditable="true"]')) return;
      if (!selection) return;
      setSelection(null);
      reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, reset]);

  // Spotlight: pan to + select the requested node, then signal consumed.
  // The frame includes the selected node AND all directly connected neighbours.
  useEffect(() => {
    if (!spotlightTarget) return;

    // Collect every node ID that connects to this node across all steps.
    const connectedIds = new Set<string>();
    connectedIds.add(spotlightTarget.id);
    for (const s of STEPS) {
      const ids = [s.from, s.to, s.via, s.through].filter(Boolean) as string[];
      if (ids.includes(spotlightTarget.id)) ids.forEach(id => connectedIds.add(id));
    }

    // Expand bbox across all connected nodes.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of connectedIds) {
      const svc = SERVICES_BY_ID[id];
      if (svc) {
        minX = Math.min(minX, svc.x - svc.width / 2);
        minY = Math.min(minY, svc.y - svc.height / 2);
        maxX = Math.max(maxX, svc.x + svc.width / 2);
        maxY = Math.max(maxY, svc.y + svc.height / 2);
      }
      const topic = TOPICS_BY_ID[id];
      if (topic) {
        minX = Math.min(minX, topic.x - 20);
        minY = Math.min(minY, topic.y - 20);
        maxX = Math.max(maxX, topic.x + 20);
        maxY = Math.max(maxY, topic.y + 20);
      }
    }

    if (!Number.isFinite(minX)) return;

    if (spotlightTarget.kind === 'service') setSelection({ kind: 'service', id: spotlightTarget.id });
    else setSelection({ kind: 'topic', id: spotlightTarget.id });

    // Left padding reserves room for the service/topic inspector panel (~340px at left:14).
    fitTo({ minX, minY, maxX, maxY }, { top: 100, right: 120, bottom: 100, left: 380 });
    onSpotlightConsumed?.();
  }, [spotlightTarget, fitTo, onSpotlightConsumed]);

  useEffect(() => {
    if (!activeScenarioId) {
      reset();
      return;
    }
    const ids = activeNodeSet(activeScenarioId);
    if (!ids || ids.size === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const svc = SERVICES_BY_ID[id];
      if (svc) {
        minX = Math.min(minX, svc.x - svc.width / 2);
        minY = Math.min(minY, svc.y - svc.height / 2);
        maxX = Math.max(maxX, svc.x + svc.width / 2);
        maxY = Math.max(maxY, svc.y + svc.height / 2);
        continue;
      }
      const topic = TOPICS_BY_ID[id];
      if (topic) {
        const r = 24; // include the dashed orbital ring + label
        minX = Math.min(minX, topic.x - r);
        minY = Math.min(minY, topic.y - r);
        maxX = Math.max(maxX, topic.x + r);
        maxY = Math.max(maxY, topic.y + r);
      }
    }
    if (!Number.isFinite(minX)) return;
    fitTo(
      { minX, minY, maxX, maxY },
      // Right pad reserves room for the step explainer (~360px @ right:14)
      // PLUS a margin so the fit never crowds it. Left side keeps a
      // smaller margin so scenario nodes hug the visible center-left.
      { top: 70, right: 440, bottom: 90, left: 80 },
    );
  }, [activeScenarioId, fitTo, reset]);

  // Topic side panel still summarises producers/consumers from the global
  // STEP list. (Service panel no longer shows integrations.)
  const allTouches = useMemo<Step[]>(() => STEPS, []);

  const scenarioActiveSet = useMemo(
    () => (isolate ? activeNodeSet(activeScenarioId) : null),
    [activeScenarioId, isolate],
  );
  // Topics on the active scenario's path show their labels even when not playing.
  const scenarioNodeSet = useMemo(() => activeNodeSet(activeScenarioId), [activeScenarioId]);
  const currentShotSet = useMemo(() => shotNodeSet(shot), [shot]);

  // World-space viewport containment — the world group transform is
  // translate(tx,ty) scale(s) in viewBox units, so visible world coords
  // are (viewBox - t) / scale.
  const inViewport = (x: number, y: number, pad: number): boolean => {
    const minX = (0 - view.tx) / view.scale - pad;
    const minY = (WORLD_MIN_Y - view.ty) / view.scale - pad;
    const maxX = (WORLD_W - view.tx) / view.scale + pad;
    const maxY = (WORLD_MIN_Y + WORLD_H - view.ty) / view.scale + pad;
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  };

  // Labels reveal only for topics inside the viewport once zoomed in.
  const topicLabelVisible = (x: number, y: number): boolean =>
    view.scale >= 2.2 && inViewport(x, y, 40);

  // A prefix group splits into individual topics when zoomed into its area,
  // or whenever a member participates in the active scenario / shot / selection.
  const isGroupExpanded = (g: TopicGroup): boolean => {
    if (view.scale >= 2.2 && inViewport(g.cx, g.cy, 160)) return true;
    if (scenarioNodeSet && g.members.some((m) => scenarioNodeSet.has(m.id))) return true;
    if (g.members.some((m) => currentShotSet.has(m.id))) return true;
    if (selection?.kind === 'topic' && g.memberIds.has(selection.id)) return true;
    if (selection?.kind === 'service') {
      if (g.serviceId === selection.id) return true;
      // Also fan out groups holding topics this service produces to /
      // consumes from — otherwise its edges end at a collapsed card.
      const touched = TOPICS_TOUCHING_SERVICE.get(selection.id);
      if (touched && g.members.some((m) => touched.has(m.id))) return true;
    }
    return false;
  };
  const collapsedGroups = TOPIC_GROUPS.filter((g) => !isGroupExpanded(g));
  const collapsedMemberIds = new Set(collapsedGroups.flatMap((g) => [...g.memberIds]));
  const collapsedKey = collapsedGroups.map((g) => g.id).join(',');
  // Owned topics never sit at their hand-placed coords: collapsed they
  // stack on the owner's center (edges read as service-to-service),
  // expanded they fan out on a ring around it, speed-dial style. Edge
  // keys stay per-topic either way, so packet animations keep working.
  const groupOverrides = useMemo<PosOverrides>(() => {
    const out: PosOverrides = {};
    for (const g of TOPIC_GROUPS) {
      const collapsed = collapsedMemberIds.has(g.members[0].id);
      // Follow the owner service if it's been dragged in layout mode.
      const cx = overrides[g.serviceId]?.x ?? g.cx;
      const cy = overrides[g.serviceId]?.y ?? g.cy;
      g.members.forEach((m, i) => {
        if (collapsed) {
          out[m.id] = { x: cx, y: cy };
        } else if (!overrides[m.id] && !m.pinned) {
          // Hand-dragged or pinned members keep their own position;
          // only untouched members follow the computed ring.
          const p = radialMemberPosition(g, i);
          out[m.id] = { x: p.x + (cx - g.cx), y: p.y + (cy - g.cy) };
        }
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by which groups are collapsed + dragged positions
  }, [collapsedKey, overrides]);

  // Per-member fan-out meta for expanded groups: ring index (animation
  // stagger), hemisphere (label side), and the hub offset (pop origin).
  const expandedMemberMeta = useMemo(() => {
    const meta = new Map<string, { idx: number; above: boolean; dx: number; dy: number }>();
    for (const g of TOPIC_GROUPS) {
      if (collapsedMemberIds.has(g.members[0].id)) continue;
      g.members.forEach((m, i) => {
        // Members pop out from the owner to wherever they actually land:
        // a live drag override, pinned hand-placed coords, or the ring slot.
        const o = overrides[m.id];
        const pos = o
          ? { x: o.x, y: o.y, above: o.y < g.cy }
          : m.pinned
            ? { x: m.x, y: m.y, above: m.y < g.cy }
            : radialMemberPosition(g, i);
        meta.set(m.id, { idx: i, above: pos.above, dx: g.cx - pos.x, dy: g.cy - pos.y });
      });
    }
    return meta;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by which groups are collapsed + dragged positions
  }, [collapsedKey, overrides]);

  // Collapsed topic count per owner service — shown as a card badge.
  const collapsedCountByService = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of collapsedGroups) counts.set(g.serviceId, g.members.length);
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by which groups are collapsed
  }, [collapsedKey]);

  const mergedOverrides = useMemo<PosOverrides>(
    () => ({ ...overrides, ...groupOverrides }),
    [overrides, groupOverrides],
  );
  const edges = useMemo(() => deriveEdges(mergedOverrides), [mergedOverrides]);
  const selectedTouches = useMemo<Set<string> | null>(() => {
    if (!selection) return null;
    // Sub-service selection doesn't drive map dimming — the parent
    // service's ecosystem is the focus, not the wider map.
    if (selection.kind === 'sub-service') return null;
    const sid = selection.id;
    const ids = new Set<string>([sid]);
    for (const e of edges) {
      if (e.from === sid || e.to === sid) {
        ids.add(e.from);
        ids.add(e.to);
      }
    }
    return ids;
  }, [selection, edges]);

  // Priority: scenario > selection
  const isNodeDim = (id: string) => {
    if (scenarioActiveSet) return !scenarioActiveSet.has(id);
    if (selectedTouches) return !selectedTouches.has(id);
    return false;
  };

  const isEdgeDim = (e: EdgeRecord) => {
    if (scenarioActiveSet) return !(scenarioActiveSet.has(e.from) && scenarioActiveSet.has(e.to));
    if (selectedTouches) return !(selectedTouches.has(e.from) && selectedTouches.has(e.to));
    return false;
  };

  // Merged display arrays — original data with any dragged-position overrides applied.
  const displayServices = useMemo(
    () => SERVICES.map(s => { const o = overrides[s.id]; return o ? { ...s, x: o.x, y: o.y } : s; }),
    [overrides],
  );
  const displayTopics = useMemo(
    () => TOPICS.map(t => { const o = mergedOverrides[t.id]; return o ? { ...t, x: o.x, y: o.y } : t; }),
    [mergedOverrides],
  );

  // Layout mode helpers.
  function handleDragStart(id: string, e: React.PointerEvent) {
    e.stopPropagation();
    const wp = toWorld(e.clientX, e.clientY);
    const node = (displayServices.find(s => s.id === id) ?? displayTopics.find(t => t.id === id))!;
    dragRef.current = { id, offX: node.x - wp.x, offY: node.y - wp.y };
    svgElRef.current?.setPointerCapture(e.pointerId);
  }
  function handleSvgPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const { id, offX, offY } = dragRef.current; // capture before async setState
    const wp = toWorld(e.clientX, e.clientY);
    const x = Math.round(wp.x + offX);
    const y = Math.round(wp.y + offY);
    setOverrides(prev => ({ ...prev, [id]: { x, y } }));
  }
  function handleSvgPointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    svgElRef.current?.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    localStorage.setItem('cosmos-layout', JSON.stringify(overridesRef.current));
  }
  // Press L to toggle layout edit mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).matches('input, textarea, [contenteditable="true"]')) return;
      if (e.key === 'l' || e.key === 'L') setLayoutMode(prev => !prev);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function resetLayout() {
    setOverrides({});
    localStorage.removeItem('cosmos-layout');
  }
  function copyCoordinates() {
    const lines = Object.entries(overridesRef.current)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, { x, y }]) => {
        const isTopic = !!TOPICS_BY_ID[id];
        return `'${id}': x=${x}, y=${y}${isTopic ? '  (topic — also set pinned: true so the fan-out uses these coords)' : ''}`;
      })
      .join('\n');
    navigator.clipboard.writeText(lines || '(no overrides yet)');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const resolveService = (id: string): Service | undefined =>
    displayServices.find(s => s.id === id) ?? SERVICES_BY_ID[id];
  const resolveTopic = (id: string): Topic | undefined =>
    displayTopics.find(t => t.id === id) ?? TOPICS_BY_ID[id];

  const stepsTouchingTopic = (id: string) =>
    allTouches.filter((s) => s.via === id);

  const selectedService = selection?.kind === 'service' ? resolveService(selection.id) : undefined;
  const selectedTopic = selection?.kind === 'topic' ? resolveTopic(selection.id) : undefined;
  const selectedSubService =
    selection?.kind === 'sub-service'
      ? resolveService(selection.serviceId)?.subServices?.find((sub) => sub.id === selection.subId)
      : undefined;
  const selectedSubServiceParent =
    selection?.kind === 'sub-service' ? resolveService(selection.serviceId) : undefined;

  return (
    <EdgeRegistryContext.Provider value={registry}>
      <div
        className="lc-map-stage lc-map-stage--cosmos"
        data-panning={panning ? 'true' : 'false'}
        data-revealing={revealing ? 'true' : 'false'}
      >
        <svg
          ref={(el) => { svgElRef.current = el; bind(el); }}
          className="lc-map-svg"
          viewBox={`0 ${WORLD_MIN_Y} ${WORLD_W} ${WORLD_H}`}
          preserveAspectRatio="xMidYMid meet"
          data-layout={layoutMode ? 'true' : 'false'}
          onPointerMove={layoutMode ? handleSvgPointerMove : undefined}
          onPointerUp={layoutMode ? handleSvgPointerUp : undefined}
          onClick={() => { if (!layoutMode) setSelection(null); }}
        >
          <defs>
            <filter id="cosmos-packet-glow" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {[...SERVICES, ...TOPICS].map((n) => (
              <radialGradient key={n.id} id={`cosmos-star-${n.id}`} cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity={1} />
                <stop offset="35%" stopColor={n.hex} stopOpacity={0.95} />
                <stop offset="100%" stopColor={n.hex} stopOpacity={0} />
              </radialGradient>
            ))}
          </defs>

          {/* World — single transform group for pan/zoom. */}
          <g
            className="lc-world"
            transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}
          >
            {/* Cluster backdrops — sit behind everything. */}
            <UICluster activeNodes={scenarioActiveSet} />
            <ShoppingCluster activeNodes={scenarioActiveSet} />
            <FulfillmentCluster activeNodes={scenarioActiveSet} />
            <EngagementCluster activeNodes={scenarioActiveSet} />

            {/* Edges — when realtime-hub's ecosystem is expanded, hide the
                direct edges into/out of `realtime-hub` itself; they're
                replaced by the internal sub-paths below (broadcasts →
                ingest → presence → push → client). */}
            <g>
              {edges
                .filter((e) =>
                  expandedServiceId === 'realtime-hub'
                    ? e.from !== 'realtime-hub' && e.to !== 'realtime-hub'
                    : true,
                )
                .map((e) => (
                  <Edge key={e.key} edgeKey={e.key} d={e.d} type={e.type} dim={isEdgeDim(e)} />
                ))}
            </g>

            {/* Internal hub edges — only when realtime-hub's ecosystem is
                expanded. These are the routes packets take when traversing
                the hub:
                  hub-broadcasts → hub-ingest → hub-presence → hub-push → consumer */}
            {expandedServiceId === 'realtime-hub' && (() => {
              const ingest = subPosition('realtime-hub', 'hub-ingest', overrides);
              const presence = subPosition('realtime-hub', 'hub-presence', overrides);
              const push = subPosition('realtime-hub', 'hub-push', overrides);
              const hubBroadcasts = displayTopics.find(t => t.id === 'hub-broadcasts');
              if (!ingest || !presence || !push || !hubBroadcasts) return null;
              const storefront = displayServices.find(s => s.id === 'storefront');
              const internalEdges: { key: string; d: string; type: Protocol }[] = [
                {
                  key: edgeKey('hub-broadcasts', 'hub-ingest', 'kafka'),
                  d: buildPathBetween(hubBroadcasts.x, hubBroadcasts.y, ingest.x, ingest.y, 0),
                  type: 'kafka',
                },
                {
                  key: edgeKey('hub-ingest', 'hub-presence', 'http'),
                  d: buildPathBetween(ingest.x, ingest.y, presence.x, presence.y, 1),
                  type: 'http',
                },
                {
                  key: edgeKey('hub-presence', 'hub-ingest', 'http'),
                  d: buildPathBetween(presence.x, presence.y, ingest.x, ingest.y, -1),
                  type: 'http',
                },
                {
                  key: edgeKey('hub-ingest', 'hub-push', 'http'),
                  d: buildPathBetween(ingest.x, ingest.y, push.x, push.y, 0),
                  type: 'http',
                },
              ];
              const showStorefront = !hubDestinations || hubDestinations.has('storefront');
              if (storefront && showStorefront) {
                internalEdges.push({
                  key: edgeKey('hub-push', 'storefront', 'ws'),
                  d: buildPathBetween(push.x, push.y, storefront.x, storefront.y, 1),
                  type: 'ws',
                });
              }
              return (
                <g>
                  {internalEdges.map((e) => (
                    <Edge key={e.key} edgeKey={e.key} d={e.d} type={e.type} />
                  ))}
                </g>
              );
            })()}

            {/* Services */}
            <g>
              {displayServices.map((s) => (
                <g
                  key={s.id}
                  onPointerDown={layoutMode ? (e) => handleDragStart(s.id, e) : undefined}
                  style={layoutMode ? { cursor: 'grab' } : undefined}
                >
                  <ServiceNode
                    service={s}
                    selected={(selection?.kind === 'service' && selection.id === s.id) || currentShotSet.has(s.id)}
                    dimmed={isNodeDim(s.id)}
                    expanded={expandedServiceId === s.id}
                    selectedSubId={
                      selection?.kind === 'sub-service' && selection.serviceId === s.id ? selection.subId : null
                    }
                    activeSubs={s.id === 'realtime-hub' ? hubActiveSubs : null}
                    topicCount={collapsedCountByService.get(s.id) ?? null}
                    onClick={(id) => {
                      if (layoutMode) return;
                      setSelection((prev) =>
                        prev?.kind === 'service' && prev.id === id ? null : { kind: 'service', id },
                      );
                    }}
                    onSubServiceClick={(serviceId, subId) => {
                      if (layoutMode) return;
                      setSelection((prev) =>
                        prev?.kind === 'sub-service' && prev.subId === subId
                          ? null
                          : { kind: 'sub-service', serviceId, subId },
                      );
                    }}
                  />
                </g>
              ))}
            </g>

            {/* Topics */}
            <g>
              {displayTopics
                .filter((t) => CONNECTED_NODE_IDS.has(t.id) && !collapsedMemberIds.has(t.id))
                .map((t) => {
                const meta = expandedMemberMeta.get(t.id);
                return (
                  <g
                    key={t.id}
                    className={meta ? 'lc-group-pop' : undefined}
                    style={
                      meta
                        ? ({
                            '--pop-dx': `${meta.dx}px`,
                            '--pop-dy': `${meta.dy}px`,
                            animationDelay: `${meta.idx * 35}ms`,
                          } as React.CSSProperties)
                        : layoutMode
                          ? { cursor: 'grab' }
                          : undefined
                    }
                    onPointerDown={layoutMode ? (e) => handleDragStart(t.id, e) : undefined}
                  >
                    <TopicNode
                      topic={meta ? { ...t, labelSide: t.labelSide ?? (meta.above ? 'above' : 'below') } : t}
                      selected={(selection?.kind === 'topic' && selection.id === t.id) || currentShotSet.has(t.id)}
                      dimmed={isNodeDim(t.id)}
                      showLabel={!!meta || topicLabelVisible(t.x, t.y) || (scenarioNodeSet?.has(t.id) ?? false)}
                      onClick={(id) => {
                        if (layoutMode) return;
                        setSelection((prev) =>
                          prev?.kind === 'topic' && prev.id === id ? null : { kind: 'topic', id },
                        );
                      }}
                    />
                  </g>
                );
              })}
            </g>

            {/* Comet packets — driven by the runner. */}
            <CometPackets
              shot={shot}
              speed={speed}
              onShotComplete={(token) => onShotComplete?.(token)}
              expanded={expandedSet}
            />

            {/* Idle ambient traffic — only when no scenario is active.
                Makes the cosmos feel alive in standby. */}
            <AmbientPackets active={!activeScenarioId} />
          </g>
        </svg>

        {/* Zoom controls (bottom-right) */}
        <div className="lc-map-zoom" data-no-pan="true">
          <button type="button" className="lc-map-zoom-btn" onClick={() => zoomBy(1.2)} aria-label="Zoom in">+</button>
          <button type="button" className="lc-map-zoom-btn" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
          <button type="button" className="lc-map-zoom-btn lc-map-zoom-reset" onClick={reset} aria-label="Reset view">
            {Math.round(view.scale * 100)}%
          </button>
        </div>

        {/* Layout edit mode controls */}
        {<div className="lc-layout-controls" data-no-pan="true" data-active={layoutMode ? 'true' : 'false'}>
          {layoutMode ? (
            <>
              <button type="button" className="lc-layout-btn lc-layout-btn--done" onClick={() => setLayoutMode(false)}>
                Done
              </button>
              <button type="button" className={`lc-layout-btn lc-layout-btn--copy${copied ? ' lc-layout-btn--done' : ''}`} onClick={copyCoordinates} title="Copy overridden coordinates to clipboard">
                {copied ? 'Copied!' : 'Copy coords'}
              </button>
              {Object.keys(overrides).length > 0 && (
                <button type="button" className="lc-layout-btn lc-layout-btn--danger" onClick={resetLayout}>
                  Reset
                </button>
              )}
            </>
          ) : (
            <button type="button" className="lc-layout-btn" onClick={() => setLayoutMode(true)}>
              Edit layout
            </button>
          )}
        </div>}

        {selection && (
          <div
            className={`lc-map-panel lc-map-panel--${selection.kind}`}
            data-no-pan="true"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="lc-map-panel-spine" aria-hidden="true" />
            <button
              className="lc-map-panel-close"
              onClick={() => setSelection(null)}
              aria-label="Close"
            >
              <svg width={14} height={14} viewBox="0 0 14 14">
                <path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
              </svg>
            </button>

            {selectedService && <ServicePanel service={selectedService} />}
            {selectedTopic && (
              <TopicPanel
                topic={selectedTopic}
                touches={stepsTouchingTopic(selectedTopic.id)}
                resolveService={resolveService}
              />
            )}
            {selectedSubService && selectedSubServiceParent && (
              <SubServicePanel sub={selectedSubService} parent={selectedSubServiceParent} />
            )}
          </div>
        )}

      </div>
    </EdgeRegistryContext.Provider>
  );
}
