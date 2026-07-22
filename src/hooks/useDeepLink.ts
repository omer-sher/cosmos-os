import { useEffect, useRef } from 'react';

interface DeepLinkState {
  domain: string | null;
  scenario: string | null;
  step: number | null;
}

/**
 * Mirrors UI state into URL search params (`?domain=&scenario=&step=`)
 * via history.replaceState — no full reload, no spam in browser history.
 */
export function useDeepLink(state: DeepLinkState) {
  const last = useRef<string>('');
  useEffect(() => {
    const url = new URL(window.location.href);
    const params = url.searchParams;

    if (state.domain && state.domain !== 'shopping') params.set('domain', state.domain);
    else params.delete('domain');

    if (state.scenario) params.set('scenario', state.scenario);
    else params.delete('scenario');

    if (state.step != null && state.step >= 0) params.set('step', String(state.step + 1));
    else params.delete('step');

    const next = url.pathname + (params.toString() ? `?${params.toString()}` : '') + url.hash;
    if (next === last.current) return;
    last.current = next;
    window.history.replaceState(null, '', next);
  }, [state.domain, state.scenario, state.step]);
}

export interface InitialDeepLink {
  domain: string | null;
  scenario: string | null;
  step: number | null;
}

export function readInitialDeepLink(): InitialDeepLink {
  if (typeof window === 'undefined') return { domain: null, scenario: null, step: null };
  const params = new URL(window.location.href).searchParams;
  const stepRaw = params.get('step');
  const stepNum = stepRaw ? parseInt(stepRaw, 10) - 1 : NaN;
  return {
    domain: params.get('domain'),
    scenario: params.get('scenario'),
    step: Number.isFinite(stepNum) && stepNum >= 0 ? stepNum : null,
  };
}
