import type { Step } from '../types';

export const CORE_STEPS: Step[] = [
  // ─── Phase 1 — Core · Hello, cosmos ────────────────────────────────
  { phase: 1, from: 'web-app', to: 'api', type: 'http',
    label: 'GET /hello', title: 'web-app → api: the first request',
    plain: `Your first hop. Replace this scenario with a real flow — the
/add-scenario skill traces one from your source code.`,
    payload: `GET /api/v1/hello
Headers:
  Accept: application/json

// 200 OK
{ "message": "hello, cosmos" }` },
  { phase: 1, from: 'api', to: 'api', type: 'internal',
    label: 'Do something real', title: 'api: your logic here',
    plain: `An internal step — rendered as a self-loop pulse on the capsule.` },
];
