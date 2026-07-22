#!/usr/bin/env node
/**
 * fresh-start — replace the AstroMart demo universe with a minimal
 * two-star starter cosmos, ready for your own services.
 *
 *   npm run fresh
 *
 * Overwrites src/scenarios/{services,topics,scenarios,owners}.ts and
 * steps/, and rewrites the data.ts barrel. Irreversible except via git.
 */
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = (p) => resolve(root, 'src/scenarios', p);

writeFileSync(dir('services.ts'), `import type { Service } from './types';

export const SERVICES: Service[] = [
  {
    id: 'web-app',
    x: 500, y: 700, width: 220, height: 66,
    color: 'var(--svc-cyan)', hex: '#22d3ee',
    name: 'web-app', sub: 'Your frontend',
    code: 'WEB-01', lang: 'TypeScript',
    role: 'The browser-facing surface',
    desc: \`Replace me: your user-facing app. Calls api over HTTP.
Use the /add-service skill (or copy this shape) to grow the map.\`,
    tech: ['typescript', 'react'],
    team: 'team-core',
  },
  {
    id: 'api',
    x: 1300, y: 700, width: 220, height: 66,
    color: 'var(--svc-blue)', hex: '#4f8ff7',
    name: 'api', sub: 'Your first backend',
    code: 'API-01', lang: 'TypeScript',
    role: 'First star of your galaxy',
    desc: \`Replace me: your first backend service. Receives HTTP from web-app.\`,
    tech: ['typescript', 'nodejs'],
    team: 'team-core',
  },
];

export const SERVICES_BY_ID = Object.fromEntries(SERVICES.map(s => [s.id, s]));
`);

writeFileSync(dir('topics.ts'), `import type { Topic } from './types';

export const TOPIC_HEX = '#fb923c';
export const TOPIC_COLOR = 'var(--svc-orange)';

export const TOPICS: Topic[] = [];

export const TOPICS_BY_ID = Object.fromEntries(TOPICS.map(t => [t.id, t]));
`);

writeFileSync(dir('scenarios.ts'), `import type { Domain, Scenario } from './types';

export const DOMAINS: Domain[] = [
  { id: 'core', label: 'Core', glyph: '·', short: 'Your first domain — rename or add more.' },
];

export const SCENARIOS: Scenario[] = [
  {
    id: 'core.hello-cosmos', domain: 'core', phaseId: 1,
    label: 'Hello, cosmos', color: 'var(--svc-cyan)', status: 'ready',
    short: 'The starter flow — one request from your web app to your API.',
  },
];

export const SCENARIOS_BY_ID = Object.fromEntries(SCENARIOS.map(s => [s.id, s]));
export const scenariosForDomain = (d: string) => SCENARIOS.filter(s => s.domain === d);
export const readyScenariosForDomain = (d: string) => scenariosForDomain(d).filter(s => s.status === 'ready');
`);

writeFileSync(dir('owners.ts'), `import type { Service } from './types';

export interface TeamOwner {
  githubTeam: string;
  reviewers: string[];
  slack?: string;
}

export type TeamId = NonNullable<Service['team']>;

export const TEAM_OWNERS: Record<TeamId, TeamOwner> = {
  'team-core': { githubTeam: 'your-org/team-core', reviewers: [], slack: '#team-core' },
};

export const SERVICE_OVERRIDES: Record<string, { reviewers: string[] }> = {};

export const FALLBACK_OWNER: TeamOwner = {
  githubTeam: 'your-org/cosmos-maintainers',
  reviewers: [],
};

export interface ResolvedOwner {
  reviewers: string[];
  githubTeam?: string;
  slack?: string;
  source: 'override' | 'team' | 'fallback';
}

export function resolveOwner(service: Service): ResolvedOwner {
  const override = SERVICE_OVERRIDES[service.id];
  if (override) return { reviewers: override.reviewers, source: 'override' };
  if (service.team) {
    const team = TEAM_OWNERS[service.team];
    return { reviewers: team.reviewers, githubTeam: team.githubTeam, slack: team.slack, source: 'team' };
  }
  return { reviewers: FALLBACK_OWNER.reviewers, githubTeam: FALLBACK_OWNER.githubTeam, source: 'fallback' };
}
`);

// The Service.team union is demo-specific — narrow it to the starter team.
{
  const typesPath = dir('types.ts');
  const { readFileSync } = await import('node:fs');
  let types = readFileSync(typesPath, 'utf8');
  types = types.replace(/team\?: '[^;]*';/, "team?: 'team-core';");
  writeFileSync(typesPath, types);
}

rmSync(dir('steps'), { recursive: true, force: true });
mkdirSync(dir('steps'));
writeFileSync(dir('steps/core.ts'), `import type { Step } from '../types';

export const CORE_STEPS: Step[] = [
  // ─── Phase 1 — Core · Hello, cosmos ────────────────────────────────
  { phase: 1, from: 'web-app', to: 'api', type: 'http',
    label: 'GET /hello', title: 'web-app → api: the first request',
    plain: \`Your first hop. Replace this scenario with a real flow — the
/add-scenario skill traces one from your source code.\`,
    payload: \`GET /api/v1/hello
Headers:
  Accept: application/json

// 200 OK
{ "message": "hello, cosmos" }\` },
  { phase: 1, from: 'api', to: 'api', type: 'internal',
    label: 'Do something real', title: 'api: your logic here',
    plain: \`An internal step — rendered as a self-loop pulse on the capsule.\` },
];
`);

writeFileSync(dir('data.ts'), `/** Barrel — re-exports every named symbol consumers import from this path. */
export { SERVICES, SERVICES_BY_ID } from './services';
export { TOPICS, TOPICS_BY_ID } from './topics';
export { DOMAINS, SCENARIOS, SCENARIOS_BY_ID, scenariosForDomain, readyScenariosForDomain } from './scenarios';

import type { Scenario, Step } from './types';
import { CORE_STEPS } from './steps/core';

export const STEPS: Step[] = [...CORE_STEPS];

export function stepsForScenario(scenario: Scenario): Step[] {
  if (scenario.phaseId == null) return [];
  return STEPS.filter(s => s.phase === scenario.phaseId);
}
`);

console.log(`✦ Fresh cosmos ready: 2 services, 1 scenario ("Hello, cosmos").
  Next:
    npm run dev            # see your minimal galaxy
    /add-service <name>    # grow it with Claude Code
    npm run build          # NOTE: default domain/UI ids may need a look if you renamed things`);
