import { SERVICES_BY_ID } from '../scenarios/data';

const SHOPPING_SERVICE_IDS = [
  'api-gateway',
  'cart',
  'search',
  'catalog',
] as const;

/**
 * Soft "milky way" backdrop grouping the shopping-path services
 * (gateway, cart, search, catalog). Pure decoration, pointer-events
 * disabled, lives in the world transform group.
 */
export function ShoppingCluster({ activeNodes = null }: { activeNodes?: Set<string> | null }) {
  const nodes = SHOPPING_SERVICE_IDS.map((id) => SERVICES_BY_ID[id]).filter(Boolean);
  const isActive = activeNodes === null;
  if (nodes.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.width / 2);
    minY = Math.min(minY, n.y - n.height / 2);
    maxX = Math.max(maxX, n.x + n.width / 2);
    maxY = Math.max(maxY, n.y + n.height / 2);
  }
  const padX = 110;
  const padY = 115;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2 + padX;
  const ry = (maxY - minY) / 2 + padY;

  return (
    <g pointerEvents="none" aria-hidden="true" style={{ opacity: isActive ? 1 : 0.08, filter: isActive ? undefined : 'blur(1.6px) saturate(0.35)', transition: 'opacity 520ms cubic-bezier(0.2,0.9,0.3,1.1), filter 520ms cubic-bezier(0.2,0.9,0.3,1.1)' }}>
      <defs>
        <radialGradient id="cosmos-shopping-cluster" cx="0.5" cy="0.5" r="0.55">
          <stop offset="0%"   stopColor="#22d3ee" stopOpacity="0.14" />
          <stop offset="35%"  stopColor="#34d399" stopOpacity="0.08" />
          <stop offset="75%"  stopColor="#22d3ee" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Soft milky-way wash. */}
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill="url(#cosmos-shopping-cluster)"
      />

      {/* Hairline boundary. */}
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill="none"
        stroke="rgba(52, 211, 153, 0.16)"
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
        fontSize={Math.min(ry * 0.55, (rx * 1.7) / 'SHOPPING'.length)}
        fontWeight={600}
        fill="rgba(52, 211, 153, 0.065)"
        letterSpacing="0.22em"
      >
        SHOPPING
      </text>
    </g>
  );
}
