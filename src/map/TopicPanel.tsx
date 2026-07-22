import type { Service, Step, Topic } from '../scenarios/types';

interface TopicPanelProps {
  topic: Topic;
  /** Steps where this topic appears as `via`. */
  touches: Step[];
  resolveService: (id: string) => Service | undefined;
}

export function TopicPanel({ topic, touches, resolveService }: TopicPanelProps) {
  const producers = new Set<string>();
  const consumers = new Set<string>();
  for (const step of touches) {
    if (step.via !== topic.id) continue;
    producers.add(step.from);
    consumers.add(step.through ?? step.to);
  }

  return (
    <>
      <div className="lc-map-panel-head">
        <div className="lc-map-panel-eyebrow" style={{ color: topic.color }}>
          KAFKA · TOPIC
        </div>
        <div className="lc-map-panel-title-row">
          <span className="lc-map-panel-dot" style={{ background: topic.color, color: topic.color }} />
          <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: 17, letterSpacing: '-0.01em' }}>
            {topic.name}
          </h3>
        </div>
      </div>

      <p className="lc-map-panel-desc">{topic.desc}</p>

      <div className="lc-map-panel-section">
        <div className="lc-map-panel-sec-label">Producers · {producers.size}</div>
        <ul className="lc-map-panel-edges">
          {[...producers].map((id) => {
            const s = resolveService(id);
            return (
              <li key={`p-${id}`}>
                <span className="lc-map-arrow out">→</span>
                <span className="lc-map-edge-other">{s?.name ?? id}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="lc-map-panel-section">
        <div className="lc-map-panel-sec-label">Consumers · {consumers.size}</div>
        <ul className="lc-map-panel-edges">
          {[...consumers].map((id) => {
            const s = resolveService(id);
            return (
              <li key={`c-${id}`}>
                <span className="lc-map-arrow in">←</span>
                <span className="lc-map-edge-other">{s?.name ?? id}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
