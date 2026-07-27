/**
 * Extract the Cosmos slice for a given source repo — the set of services,
 * steps, and topics that touch this repo. Fed into the diff-repo agent
 * prompt so Claude knows what to compare the source diff against.
 */

import { SERVICES } from '../../../src/scenarios/services.js';
import { TOPICS_BY_ID } from '../../../src/scenarios/topics.js';
import { STEPS } from '../../../src/scenarios/data.js';
import { resolveOwner } from '../../../src/scenarios/owners.js';
import type { Service, Step, SubService, Topic } from '../../../src/scenarios/types.js';

export interface CosmosRepoSlice {
  /** Services whose repo (or subService repo) equals the target. */
  services: { id: string; service: Service; subServices: SubService[] }[];
  /** Steps where any of the above services is from / to / through. */
  steps: Step[];
  /** Topics referenced by those steps. */
  topics: Topic[];
  /** Producer/consumer roles of this repo's services per topic. */
  topicRoles: { topicId: string; topicName: string; role: 'producer' | 'consumer' | 'both'; viaServiceId: string }[];
  /** Team(s) responsible. */
  teams: { team: string; githubTeam?: string; slack?: string; reviewers: string[] }[];
}

export function buildRepoSlice(repo: string): CosmosRepoSlice {
  // Services whose repo == this repo (top-level OR sub-service).
  const services: CosmosRepoSlice['services'] = [];
  for (const svc of SERVICES) {
    if (svc.repo === repo) {
      services.push({ id: svc.id, service: svc, subServices: [] });
      continue;
    }
    const matchingSubs = (svc.subServices ?? []).filter(s => s.repo === repo);
    if (matchingSubs.length > 0) {
      services.push({ id: svc.id, service: svc, subServices: matchingSubs });
    }
  }

  const serviceIds = new Set<string>();
  for (const s of services) {
    serviceIds.add(s.id);
    for (const sub of s.subServices) serviceIds.add(sub.id);
  }

  // Steps where any service is from/to/through.
  const steps: Step[] = STEPS.filter(step =>
    serviceIds.has(step.from) ||
    serviceIds.has(step.to) ||
    (step.through ? serviceIds.has(step.through) : false),
  );

  // Topics referenced via these steps.
  const topicIds = new Set<string>();
  for (const step of steps) {
    if (step.via) topicIds.add(step.via);
  }
  const topics: Topic[] = [...topicIds]
    .map(id => TOPICS_BY_ID[id] as Topic | undefined)
    .filter((t): t is Topic => Boolean(t));

  // Producer/consumer role per topic for this repo's services.
  const topicRoles: CosmosRepoSlice['topicRoles'] = [];
  for (const topic of topics) {
    let isProducer = false;
    let isConsumer = false;
    let viaServiceId = '';
    for (const step of steps) {
      if (step.via !== topic.id) continue;
      if (serviceIds.has(step.from)) {
        isProducer = true;
        viaServiceId = step.from;
      }
      const consumerSvc = step.through ?? step.to;
      if (serviceIds.has(consumerSvc)) {
        isConsumer = true;
        viaServiceId = consumerSvc;
      }
    }
    const role: 'producer' | 'consumer' | 'both' =
      isProducer && isConsumer ? 'both' : isProducer ? 'producer' : 'consumer';
    topicRoles.push({ topicId: topic.id, topicName: topic.name, role, viaServiceId });
  }

  // Teams + owner resolution.
  const teamMap = new Map<string, CosmosRepoSlice['teams'][number]>();
  for (const s of services) {
    const owner = resolveOwner(s.service);
    const team = s.service.team ?? '(unknown)';
    if (!teamMap.has(team)) {
      teamMap.set(team, {
        team,
        githubTeam: owner.githubTeam,
        slack: owner.slack,
        reviewers: owner.reviewers,
      });
    }
  }

  return { services, steps, topics, topicRoles, teams: [...teamMap.values()] };
}

/** Compact textual summary of the slice for the agent's user prompt. */
export function formatSliceForPrompt(slice: CosmosRepoSlice): string {
  const parts: string[] = [];

  parts.push('## Cosmos services backed by this repo');
  for (const s of slice.services) {
    parts.push(`  - id: ${s.id}  team: ${s.service.team ?? '(none)'}  role: ${s.service.role}`);
    parts.push(`    desc: ${s.service.desc.replace(/\s+/g, ' ').slice(0, 200)}…`);
    for (const sub of s.subServices) {
      parts.push(`      sub: ${sub.id} (repo: ${sub.repo})  role: ${sub.role}`);
    }
  }

  parts.push('');
  parts.push(`## Cosmos steps involving this repo (${slice.steps.length})`);
  for (const step of slice.steps) {
    const via = step.via ? ` via '${step.via}'` : '';
    const through = step.through ? ` through ${step.through}` : '';
    parts.push(`  - phase ${step.phase} [${step.type}]: ${step.from} →${through} ${step.to}${via}  "${step.label}"`);
  }

  parts.push('');
  parts.push(`## Topics this repo participates in (${slice.topicRoles.length})`);
  for (const tr of slice.topicRoles) {
    parts.push(`  - ${tr.topicId}  (wire name: ${tr.topicName})  role: ${tr.role}`);
  }

  parts.push('');
  parts.push('## Team(s)');
  for (const t of slice.teams) {
    parts.push(`  - ${t.team}  github: ${t.githubTeam ?? '(none)'}  slack: ${t.slack ?? '(none)'}`);
  }

  return parts.join('\n');
}
