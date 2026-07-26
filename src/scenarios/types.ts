export type Protocol = 'http' | 'ws' | 'kafka' | 'internal';

export type ScenarioStatus = 'ready' | 'soon';

/** Known tech tags rendered as icons in the Service detail panel. */
export type Tech =
  | 'typescript' | 'javascript' | 'nodejs' | 'cplusplus' | 'react'
  | 'nestjs' | 'koa' | 'moleculer'
  | 'postgres' | 'aerospike' | 'redis' | 'elastic' | 'dynamodb'
  | 'kafka' | 's3' | 'webrtc' | 'gstreamer'
  | 'lua' | 'go' | 'mqtt' | 'docker' | 'githubactions';

export interface Service {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** CSS variable reference, e.g. 'var(--svc-cyan)' */
  color: string;
  /** Concrete hex of the same hue — for SVG defs that can't take CSS vars (gradients). */
  hex: string;
  name: string;
  /** Short stack/tech line shown under the name. */
  sub: string;
  /** Display code shown in the side panel header (e.g. "BRW-01"). */
  code: string;
  /** Primary implementation language. */
  lang: string;
  /** One-line role label (panel subtitle). */
  role: string;
  /** Long description used in the side panel. */
  desc: string;
  /** Structured tech-stack tags — icons rendered in the side panel. */
  tech: Tech[];
  /** GitHub repo name (under the org). Omit for non-repo services like object storage. */
  repo?: string;
  /** Owning team. Omit for external infra (object storage, etc.). */
  team?: 'team-shopping' | 'team-fulfillment' | 'team-engagement';
  /**
   * Optional sub-services that make up this service's "ecosystem".
   * When set, the capsule renders an expand button — clicking it
   * fans the children out as a small solar system around the parent.
   */
  subServices?: SubService[];
}

export interface SubService {
  id: string;
  name: string;
  /** Short stack/role line shown under the name on the sub-capsule. */
  sub: string;
  /** One-line role for the inspector header. */
  role: string;
  /** Long description shown when the sub-capsule is clicked. */
  desc: string;
  /** GitHub repo name under the org. */
  repo?: string;
  /** Tech chips for the inspector. */
  tech?: Tech[];
}

export interface Topic {
  id: string;
  x: number;
  y: number;
  /** When set, forces the label above or below the node. */
  labelSide?: 'above' | 'below';
  /**
   * When the owner group fans out, place this topic at its hand-placed
   * x/y instead of the computed ring slot. It still collapses into the
   * owner's badge when zoomed out. Use when the auto ring collides with
   * neighbors.
   */
  pinned?: boolean;
  /** Topic's wire name (mono caps). */
  name: string;
  /** CSS variable reference for the topic's color (defaults to --svc-orange). */
  color: string;
  hex: string;
  desc: string;
}

export interface Step {
  /** Global phase id. Matches `Scenario.phaseId`. */
  phase: number;
  /** Service id OR topic id. */
  from: string;
  to: string;
  /** Topic id when this is a Kafka step (renders producer → topic → consumer). */
  via?: string;
  /** Intermediate service id when this is a 3-hop broadcast (e.g. realtime-hub). */
  through?: string;
  type: Protocol;
  /** Short label rendered on the timeline. */
  label: string;
  /** Step title in the side panel. */
  title: string;
  /** Long narrative for the side panel. */
  plain: string;
  /** Optional payload sample (HTTP/WS/Kafka body). */
  payload?: string;
  /** When true, this step fires in parallel with the previous one. */
  parallel?: boolean;
}

export interface Scenario {
  id: string;
  domain: string;
  /** Global phase id (matches Step.phase). Set ONLY for ready scenarios. */
  phaseId?: number;
  label: string;
  /** CSS variable color for chips/highlights. */
  color: string;
  status: ScenarioStatus;
  /** One-line summary used in chips and "Coming soon" placeholders. */
  short?: string;
}

export interface Domain {
  id: string;
  label: string;
  /** Display icon (single character — kept minimal, no emoji in the cosmos UI). */
  glyph: string;
  short: string;
}
