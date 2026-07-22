import { SERVICES_BY_ID } from '../scenarios/data';

const UI_SERVICE_IDS = ['storefront'] as const;

/**
 * Soft "milky way" backdrop that visually groups the UI surfaces
 * (the storefront) on the left of the cosmos. Pure decoration —
 * a faint elliptical aura bracket + a mono caps "UI" eyebrow.
 *
 * Pointer-events disabled so it never intercepts clicks. Lives in the
 * world transform group so it pans/zooms with the rest of the map.
 */
export function UICluster({ activeNodes = null }: { activeNodes?: Set<string> | null }) {
  const nodes = UI_SERVICE_IDS.map((id) => SERVICES_BY_ID[id]).filter(Boolean);
  const isActive = activeNodes === null;
  if (nodes.length === 0) return null;

  // Bbox of the UI nodes with generous padding on every side.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.width / 2);
    minY = Math.min(minY, n.y - n.height / 2);
    maxX = Math.max(maxX, n.x + n.width / 2);
    maxY = Math.max(maxY, n.y + n.height / 2);
  }
  const padX = 90;
  const padY = 110;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2 + padX;
  const ry = (maxY - minY) / 2 + padY;

  return (
    <g pointerEvents="none" aria-hidden="true" style={{ opacity: isActive ? 1 : 0.08, filter: isActive ? undefined : 'blur(1.6px) saturate(0.35)', transition: 'opacity 520ms cubic-bezier(0.2,0.9,0.3,1.1), filter 520ms cubic-bezier(0.2,0.9,0.3,1.1)' }}>
      <defs>
        <radialGradient id="cosmos-ui-cluster" cx="0.5" cy="0.5" r="0.55">
          <stop offset="0%"   stopColor="#22d3ee" stopOpacity="0.18" />
          <stop offset="40%"  stopColor="#a78bfa" stopOpacity="0.10" />
          <stop offset="80%"  stopColor="#22d3ee" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Soft milky-way wash. */}
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill="url(#cosmos-ui-cluster)"
      />

      {/* Hairline boundary so the cluster reads as a defined zone. */}
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill="none"
        stroke="rgba(140, 200, 255, 0.18)"
        strokeWidth={1}
        strokeDasharray="2 6"
      />

      {/* Big watermark name — centered in the oval, behind the nodes. */}
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Orbitron, var(--font-display)"
        fontSize={Math.min(ry * 0.55, (rx * 1.7) / 'UI'.length)}
        fontWeight={600}
        fill="rgba(180, 220, 255, 0.06)"
        letterSpacing="0.22em"
      >
        UI
      </text>
    </g>
  );
}
