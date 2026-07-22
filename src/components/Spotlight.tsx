import { useEffect, useRef, useState, useCallback } from 'react';
import { SERVICES, TOPICS, SCENARIOS } from '../scenarios/data';
import type { Service, Topic, Scenario } from '../scenarios/types';

type ResultKind = 'service' | 'topic' | 'scenario';

interface Result {
  kind: ResultKind;
  id: string;
  label: string;
  sub: string;
  color: string;
}

export interface SpotlightTarget {
  id: string;
  kind: 'service' | 'topic';
}

interface SpotlightProps {
  onSelectScenario: (id: string) => void;
  onSelectNode: (target: SpotlightTarget) => void;
}

function score(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return 3;
  if (t.startsWith(q)) return 2;
  if (t.includes(q)) return 1;
  return 0;
}

function search(query: string): Result[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();

  const svcResults: (Result & { _score: number })[] = SERVICES
    .map((s: Service) => {
      const sc = Math.max(score(s.name, q), score(s.role, q), score(s.id, q), s.team ? score(s.team, q) : 0);
      return { kind: 'service' as const, id: s.id, label: s.name, sub: s.role, color: s.color, _score: sc };
    })
    .filter(r => r._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 5);

  const topicResults: (Result & { _score: number })[] = TOPICS
    .map((t: Topic) => {
      const sc = Math.max(score(t.name, q), score(t.id, q));
      return { kind: 'topic' as const, id: t.id, label: t.name, sub: 'Kafka topic', color: t.color, _score: sc };
    })
    .filter(r => r._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 3);

  const scenarioResults: (Result & { _score: number })[] = SCENARIOS
    .filter(s => s.status === 'ready')
    .map((s: Scenario) => {
      const sc = Math.max(score(s.label, q), score(s.domain, q), s.short ? score(s.short, q) : 0);
      return { kind: 'scenario' as const, id: s.id, label: s.label, sub: s.domain, color: s.color, _score: sc };
    })
    .filter(r => r._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 4);

  return [...svcResults, ...topicResults, ...scenarioResults];
}

export function Spotlight({ onSelectScenario, onSelectNode }: SpotlightProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = search(query);

  const close = useCallback(() => { setOpen(false); setQuery(''); setCursor(0); }, []);

  const pick = useCallback((r: Result) => {
    if (r.kind === 'scenario') onSelectScenario(r.id);
    else onSelectNode({ id: r.id, kind: r.kind });
    close();
  }, [onSelectScenario, onSelectNode, close]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.matches('input, textarea, [contenteditable="true"]');

      if (e.key === '/' && !inInput) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
      if (e.key === 'Enter' && results[cursor]) { pick(results[cursor]); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, results, cursor, pick, close]);

  useEffect(() => { if (open) { inputRef.current?.focus(); setCursor(0); } }, [open]);
  useEffect(() => { setCursor(0); }, [query]);

  if (!open) return null;

  const grouped: { label: string; kind: ResultKind; items: Result[] }[] = (
    [
      { label: 'Services',  kind: 'service'  as ResultKind, items: results.filter(r => r.kind === 'service') },
      { label: 'Topics',    kind: 'topic'    as ResultKind, items: results.filter(r => r.kind === 'topic') },
      { label: 'Scenarios', kind: 'scenario' as ResultKind, items: results.filter(r => r.kind === 'scenario') },
    ] as const
  ).filter(g => g.items.length > 0);

  let globalIdx = 0;

  return (
    <div className="lc-spotlight-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="lc-spotlight">
        <div className="lc-spotlight-input-row">
          <svg className="lc-spotlight-icon" width={14} height={14} viewBox="0 0 16 16" aria-hidden>
            <circle cx={6.5} cy={6.5} r={5} stroke="currentColor" strokeWidth={1.5} fill="none"/>
            <line x1={10.5} y1={10.5} x2={14} y2={14} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            className="lc-spotlight-input"
            placeholder="Search services, topics, scenarios…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="lc-spotlight-esc" onClick={close}>esc</kbd>
        </div>

        {results.length > 0 && (
          <div className="lc-spotlight-results">
            {grouped.map(group => (
              <div key={group.kind} className="lc-spotlight-group">
                <div className="lc-spotlight-group-label">{group.label}</div>
                {group.items.map(r => {
                  const idx = globalIdx++;
                  const active = idx === cursor;
                  return (
                    <button
                      key={r.id}
                      className={`lc-spotlight-row${active ? ' lc-spotlight-row--active' : ''}`}
                      onMouseEnter={() => setCursor(idx)}
                      onMouseDown={() => pick(r)}
                    >
                      <span className="lc-spotlight-dot" style={{ background: `var(${r.color.slice(4, -1)})` }} />
                      <span className="lc-spotlight-label">{r.label}</span>
                      <span className="lc-spotlight-sub">{r.sub}</span>
                      {r.kind === 'scenario' && <span className="lc-spotlight-badge">flow</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {query.trim() && results.length === 0 && (
          <div className="lc-spotlight-empty">No results for "{query}"</div>
        )}

        {!query.trim() && (
          <div className="lc-spotlight-hint">
            Type to search · <kbd>↑↓</kbd> navigate · <kbd>↵</kbd> select · <kbd>esc</kbd> close
          </div>
        )}
      </div>
    </div>
  );
}
