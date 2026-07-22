import { SCENARIOS_BY_ID, scenariosForDomain } from '../scenarios/data';

interface ScenarioStatusProps {
  domainId: string;
  activeScenarioId: string | null;
}

/**
 * Read-only chip that shows the currently selected scenario (or a
 * placeholder if nothing is picked / the domain has no scenarios).
 * Picking a scenario happens via the DomainBar dropdown — this is
 * just a status indicator, not a control.
 */
export function ScenarioStatus({ domainId, activeScenarioId }: ScenarioStatusProps) {
  const active = activeScenarioId ? SCENARIOS_BY_ID[activeScenarioId] ?? null : null;
  const isActiveInDomain = active?.domain === domainId;
  const scenarios = scenariosForDomain(domainId);
  const label = isActiveInDomain
    ? active!.label
    : scenarios.length === 0
      ? 'No scenarios yet'
      : 'No scenario selected';
  const swatch = isActiveInDomain ? active!.color : 'var(--text-3)';

  return (
    <div
      className="lc-scenario-status"
      data-active={isActiveInDomain ? 'true' : 'false'}
      style={{ ['--c' as string]: swatch } as React.CSSProperties}
      aria-live="polite"
    >
      <span className="lc-scenario-status-dot" />
      <span className="lc-scenario-status-label">{label}</span>
    </div>
  );
}
