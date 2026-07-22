import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  DOMAINS,
  scenariosForDomain,
  stepsForScenario,
} from '../scenarios/data';

interface DomainBarProps {
  active: string;
  /** Currently selected scenario id (for the menu's "active" highlight). */
  activeScenarioId: string | null;
  onPickDomain: (domainId: string) => void;
  onPickScenario: (scenarioId: string) => void;
}

/**
 * Tabs row + scenarios dropdown as one unit.
 *
 * Clicking any domain tab swaps the active domain AND opens the
 * scenarios dropdown anchored under that tab. Clicking the active tab
 * again toggles the dropdown closed.
 */
export function DomainBar({
  active,
  activeScenarioId,
  onPickDomain,
  onPickScenario,
}: DomainBarProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [anchor, setAnchor] = useState<{ left: number; minWidth: number } | null>(null);

  // Recompute the dropdown's left position based on the active tab.
  useLayoutEffect(() => {
    if (!open) return;
    const btn = tabRefs.current[active];
    if (!btn) return;
    setAnchor({ left: btn.offsetLeft, minWidth: Math.max(280, btn.offsetWidth) });
  }, [open, active]);

  // Outside click + ESC → close
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleTabClick = (domainId: string) => {
    if (domainId === active) {
      // Same tab clicked → toggle dropdown.
      setOpen((v) => !v);
      return;
    }
    onPickDomain(domainId);
    setOpen(true);
  };

  const scenarios = scenariosForDomain(active);

  return (
    <div className="lc-domain-bar" ref={wrapRef}>
      <div className="lc-domain-tabs" role="tablist">
        {DOMAINS.map((d) => {
          const total = scenariosForDomain(d.id).length;
          const isActive = active === d.id;
          return (
            <button
              key={d.id}
              ref={(el) => { tabRefs.current[d.id] = el; }}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-haspopup="menu"
              aria-expanded={isActive && open}
              data-active={isActive ? 'true' : 'false'}
              data-empty={total === 0 ? 'true' : 'false'}
              data-open={isActive && open ? 'true' : 'false'}
              className="lc-domain-tab"
              onClick={() => handleTabClick(d.id)}
            >
              <span className="lc-domain-tab-label">{d.label}</span>
              <span className="lc-domain-tab-caret" aria-hidden="true">▾</span>
            </button>
          );
        })}
      </div>

      {open && anchor && (
        <div
          className="lc-domain-menu"
          role="menu"
          style={{ left: anchor.left, minWidth: anchor.minWidth }}
        >
          <div className="lc-picker-menu-hdr">
            {scenarios.length} scenario{scenarios.length === 1 ? '' : 's'}
          </div>
          {scenarios.length === 0 && (
            <div className="lc-picker-menu-empty">
              No flows authored yet for this domain.
            </div>
          )}
          {scenarios.map((s) => {
            const isReady = s.status === 'ready';
            const stepCount = isReady ? stepsForScenario(s).length : 0;
            const isActiveScenario = s.id === activeScenarioId;
            return (
              <button
                key={s.id}
                type="button"
                className="lc-picker-item"
                data-ready={isReady ? 'true' : 'false'}
                data-active={isActiveScenario ? 'true' : 'false'}
                disabled={!isReady}
                style={{ ['--c' as string]: s.color } as React.CSSProperties}
                onClick={() => {
                  if (!isReady) return;
                  onPickScenario(s.id);
                  setOpen(false);
                }}
              >
                <span className="lc-picker-item-swatch" />
                <span className="lc-picker-item-body">
                  <span className="lc-picker-item-label">{s.label}</span>
                  <span className="lc-picker-item-sub">
                    {isReady
                      ? `${stepCount} step${stepCount === 1 ? '' : 's'}`
                      : (s.short ?? 'Coming soon')}
                  </span>
                </span>
                {!isReady && <span className="lc-picker-item-badge">SOON</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
