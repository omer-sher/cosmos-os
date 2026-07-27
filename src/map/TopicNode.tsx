import type { Topic } from '../scenarios/types';

interface TopicNodeProps {
  topic: Topic;
  selected?: boolean;
  dimmed?: boolean;
  /** True when the map is zoomed in enough to show labels without clutter. */
  showLabel?: boolean;
  onClick: (id: string) => void;
}

/**
 * Topic node — small dashed orbital ring with a tiny core.
 * Slowly rotates always (kept lightweight). Visual values lifted
 */
export function TopicNode({ topic: t, selected = false, dimmed = false, showLabel = false, onClick }: TopicNodeProps) {
  // Topics below the main spine pile labels downward — flip above so they stay readable.
  const labelAbove =
    t.labelSide === 'above' ? true
    : t.labelSide === 'below' ? false
    : t.y >= 510;
  const labelY1 = labelAbove ? -18 : 26;

  return (
    <g
      transform={`translate(${t.x},${t.y})`}
      data-no-pan="true"
      data-dimmed={dimmed ? 'true' : 'false'}
      className="lc-topic-node"
      onClick={(e) => { e.stopPropagation(); onClick(t.id); }}
    >
      {/* outer aura */}
      <circle r={22} fill={`url(#cosmos-star-${t.id})`} opacity={0.5} />

      {/* dashed orbital ring */}
      <circle r={11} fill="none" stroke={t.color} strokeOpacity={0.85} strokeWidth={1} strokeDasharray="3 2.5">
        <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="14s" repeatCount="indefinite" />
      </circle>

      {/* core */}
      <circle r={2.5} fill={t.color} />

      {selected && (
        <circle r={14} fill="none" stroke={t.color} strokeWidth={1} strokeOpacity={0.9} />
      )}

      {/* label — fades in while selected (click or active shot), on the active
          scenario path, or when zoomed into this topic's viewport region. */}
      <g
        style={{
          opacity: selected || showLabel ? 1 : 0,
          transition: 'opacity 320ms ease',
          pointerEvents: 'none',
        }}
      >
          <text
            y={labelY1}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize={8}
            fontWeight={500}
            fill={t.color}
            fillOpacity={0.95}
            letterSpacing="0.16em"
          >
            {t.name.toUpperCase()}
          </text>
      </g>
    </g>
  );
}
