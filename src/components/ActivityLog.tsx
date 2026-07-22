import { useEffect, useRef } from 'react';

import type { Step } from '../scenarios/types';

interface ActivityLogProps {
  /** Steps fired so far in the current scenario, in order. */
  history: { idx: number; step: Step }[];
  /** Hide entirely when no scenario is active or empty. */
  visible: boolean;
  onClear: () => void;
}

export function ActivityLog({ history, visible, onClear }: ActivityLogProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entry.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length]);

  if (!visible) return null;

  return (
    <aside className="lc-activity">
      <header className="lc-activity-hdr">
        <span className="lc-activity-eyebrow">LIVE · ACTIVITY</span>
        <button type="button" className="lc-activity-clear" onClick={onClear}>clear</button>
      </header>
      <div className="lc-activity-body" ref={bodyRef}>
        {history.length === 0 ? (
          <div className="lc-activity-empty">No steps fired yet.</div>
        ) : (
          history.map((row) => (
            <div key={row.idx} className="lc-activity-row">
              <span className={`lc-activity-proto p-${row.step.type}`}>{row.step.type.toUpperCase()}</span>
              <span className="lc-activity-label">{row.step.label}</span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
