import type { Service, SubService } from '../scenarios/types';
import { TechChip } from '../components/TechIcon';

interface SubServicePanelProps {
  sub: SubService;
  parent: Service;
}

/**
 * Inspector for a sub-service inside an expanded ecosystem (e.g.
 * hub-push inside the realtime-hub capsule's solar system).
 */
export function SubServicePanel({ sub, parent }: SubServicePanelProps) {
  return (
    <>
      <div className="lc-map-panel-head">
        <div className="lc-map-panel-eyebrow" style={{ color: parent.color }}>
          {parent.name.toUpperCase()} · ECOSYSTEM
        </div>
        <div className="lc-map-panel-title-row">
          <span className="lc-map-panel-dot" style={{ background: parent.color, color: parent.color }} />
          <h3>{sub.name}</h3>
        </div>
        <div className="lc-map-panel-role">{sub.role}</div>
        {sub.repo && (
          <a
            className="lc-map-panel-repo"
            href={`https://github.com/astromart/${sub.repo}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open on GitHub"
          >
            <svg width={12} height={12} viewBox="0 0 16 16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M8 .2a8 8 0 0 0-2.5 15.6c.4.07.55-.17.55-.38v-1.34c-2.22.48-2.69-1.07-2.69-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.88 2.34.67.07-.52.28-.88.51-1.08-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.01.08-2.11 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.91.08 2.11.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.55.74.55 1.49v2.21c0 .21.15.46.55.38A8 8 0 0 0 8 .2Z"
              />
            </svg>
            <span>{sub.repo}</span>
          </a>
        )}
      </div>

      <p className="lc-map-panel-desc">{sub.desc}</p>

      {sub.tech && sub.tech.length > 0 && (
        <div className="lc-map-panel-section">
          <div className="lc-map-panel-sec-label">Tech stack · {sub.tech.length}</div>
          <div className="lc-tech-row">
            {sub.tech.map((t) => (
              <TechChip key={t} tech={t} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
