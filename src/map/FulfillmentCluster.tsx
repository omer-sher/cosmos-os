import { SERVICES_BY_ID } from '../scenarios/data';

const FULFILLMENT_SERVICE_IDS = [
  'orders',
  'payments',
  'inventory',
  'shipping',
] as const;

/**
 * Soft "milky way" backdrop grouping the fulfillment services
 * (orders, payments, inventory, shipping). Mirror of UICluster —
 * pure decoration, pointer-events disabled, lives in the world
 * transform group.
 */
export function FulfillmentCluster({ activeNodes = null }: { activeNodes?: Set<string> | null }) {
  const nodes = FULFILLMENT_SERVICE_IDS.map((id) => SERVICES_BY_ID[id]).filter(Boolean);
  const isActive = activeNodes === null;
  if (nodes.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.width / 2);
    minY = Math.min(minY, n.y - n.height / 2);
    maxX = Math.max(maxX, n.x + n.width / 2);
    maxY = Math.max(maxY, n.y + n.height / 2);
  }
  const padX = 100;
  const padY = 120;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2 + padX;
  const ry = (maxY - minY) / 2 + padY;

  return (
    <g pointerEvents="none" aria-hidden="true" style={{ opacity: isActive ? 1 : 0.08, filter: isActive ? undefined : 'blur(1.6px) saturate(0.35)', transition: 'opacity 520ms cubic-bezier(0.2,0.9,0.3,1.1), filter 520ms cubic-bezier(0.2,0.9,0.3,1.1)' }}>
      <defs>
        <radialGradient id="cosmos-fulfillment-cluster" cx="0.5" cy="0.5" r="0.55">
          <stop offset="0%"   stopColor="#f5b731" stopOpacity="0.16" />
          <stop offset="35%"  stopColor="#fb923c" stopOpacity="0.10" />
          <stop offset="75%"  stopColor="#f5b731" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#f5b731" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Soft milky-way wash. */}
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill="url(#cosmos-fulfillment-cluster)"
      />

      {/* Hairline boundary. */}
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill="none"
        stroke="rgba(245, 183, 49, 0.18)"
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
        fontSize={Math.min(ry * 0.55, (rx * 1.7) / 'FULFILLMENT'.length)}
        fontWeight={600}
        fill="rgba(251, 180, 80, 0.07)"
        letterSpacing="0.22em"
      >
        FULFILLMENT
      </text>
    </g>
  );
}
