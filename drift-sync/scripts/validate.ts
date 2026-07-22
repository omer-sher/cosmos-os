#!/usr/bin/env -S npx tsx
/**
 * Cosmos drift validator — Phase 0 deterministic checks.
 *
 * Internal checks (no source-repo access):
 *  - Every step.from / step.to / step.through resolves to a known service or topic id
 *  - Every step.via (kafka) resolves to a known topic id
 *  - Every step.phase matches a Scenario.phaseId
 *  - Every service has a resolvable owner
 *
 * External checks (greps source repos):
 *  - Every service.repo exists locally
 *  - Every topic.name appears as a literal string somewhere in source repos
 *  - For each kafka step: the from-service's repo contains topic.name (producer)
 *    and the to-service's repo contains topic.name (consumer)
 *
 * Usage:
 *   npm run validate                      # human-readable
 *   npm run validate -- --json            # machine-readable
 *   npm run validate -- --repos-root /path/to/repos
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { SERVICES, SERVICES_BY_ID } from '../../src/scenarios/services.js';
import { TOPICS, TOPICS_BY_ID } from '../../src/scenarios/topics.js';
import { SCENARIOS } from '../../src/scenarios/scenarios.js';
import { STEPS } from '../../src/scenarios/data.js';
import { resolveOwner } from '../../src/scenarios/owners.js';
import type { Service, Step, SubService, Topic } from '../../src/scenarios/types.js';
import { loadDriftSyncConfig } from './lib/config.js';

// ──────────────────────────────────────────────────────────────────
//  Args
// ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const reposRootIdx = args.indexOf('--repos-root');
const reposRoot =
  reposRootIdx >= 0 ? args[reposRootIdx + 1] : loadDriftSyncConfig().reposRoot;
// Cross-repo checks (greps every Cosmos topic.name across the source
// workspace) only make sense when those repos are cloned locally. CI
// validators don't have them — so default to internal-only and let
// users opt-in to the deeper sweep via --source-check.
const sourceCheck = args.includes('--source-check');

// ──────────────────────────────────────────────────────────────────
//  Confirmed suppressions
// ──────────────────────────────────────────────────────────────────
interface ConfirmedEntry {
  topic_id: string;
  suppress: string[];
  confidence?: string;
  confirmed_at?: string;
  confirmed_by?: string;
  reason?: string;
}
const confirmedPath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'cosmos-confirmed.json',
);
const confirmedSet = new Set<string>(); // "topic_id|warning_code"
const reposNotInWorkspace = new Set<string>();
if (existsSync(confirmedPath)) {
  try {
    const data = JSON.parse(readFileSync(confirmedPath, 'utf8')) as {
      entries?: ConfirmedEntry[];
      repos_not_in_workspace?: string[];
    };
    for (const e of data.entries ?? []) {
      for (const code of e.suppress) {
        confirmedSet.add(`${e.topic_id}|${code}`);
      }
    }
    for (const r of data.repos_not_in_workspace ?? []) {
      reposNotInWorkspace.add(r);
    }
  } catch (err) {
    console.warn(`(warn) could not load cosmos-confirmed.json: ${String(err)}`);
  }
}

// ──────────────────────────────────────────────────────────────────
//  Findings model
// ──────────────────────────────────────────────────────────────────
type Severity = 'error' | 'warn' | 'info';
interface Finding {
  severity: Severity;
  code: string;
  message: string;
  context?: Record<string, unknown>;
}
const findings: Finding[] = [];
let suppressedCount = 0;
const add = (f: Finding) => {
  const topicId = (f.context?.topicId as string | undefined) ?? (f.context?.topic as string | undefined);
  if (topicId && confirmedSet.has(`${topicId}|${f.code}`)) {
    suppressedCount++;
    return;
  }
  if ((f.code === 'missing-repo' || f.code === 'missing-sub-repo') && reposNotInWorkspace.has(f.context?.repo as string)) {
    suppressedCount++;
    return;
  }
  findings.push(f);
};

// ──────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────
const allServiceIds = new Set<string>(SERVICES.map(s => s.id));
const allSubServices: SubService[] = SERVICES.flatMap(s => s.subServices ?? []);
allSubServices.forEach(ss => allServiceIds.add(ss.id));
const allTopicIds = new Set<string>(TOPICS.map(t => t.id));
const allScenarioPhaseIds = new Set<number>(
  SCENARIOS.map(s => s.phaseId).filter((p): p is number => p != null),
);

function serviceRepoPath(repo: string): string {
  return path.join(reposRoot, repo);
}

function repoExists(repo: string): boolean {
  const p = serviceRepoPath(repo);
  return existsSync(p) && statSync(p).isDirectory();
}

const grepCache = new Map<string, Set<string>>(); // needle → set of repos where it appears

/**
 * Return the set of repo names (under reposRoot) whose tree contains
 * the literal needle. Excludes node_modules, .git, dist, build.
 */
function reposContaining(needle: string): Set<string> {
  const cached = grepCache.get(needle);
  if (cached) return cached;

  const result = new Set<string>();
  try {
    const out = execFileSync(
      'grep',
      [
        '-r',
        '-l',
        '-F',
        '--include=*.ts',
        '--include=*.tsx',
        '--include=*.js',
        '--include=*.jsx',
        '--include=*.mjs',
        '--include=*.cjs',
        '--include=*.go',
        '--include=*.py',
        '--include=*.java',
        '--include=*.kt',
        '--include=*.cpp',
        '--include=*.h',
        '--include=*.hpp',
        '--include=*.yaml',
        '--include=*.yml',
        '--include=*.json',
        '--include=*.proto',
        '--exclude-dir=node_modules',
        '--exclude-dir=.git',
        '--exclude-dir=dist',
        '--exclude-dir=build',
        '--exclude-dir=.next',
        '--exclude-dir=coverage',
        '--exclude=package-lock.json',
        '--exclude=yarn.lock',
        '--exclude=pnpm-lock.yaml',
        needle,
        reposRoot,
      ],
      { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    for (const line of out.split('\n')) {
      if (!line) continue;
      const rel = path.relative(reposRoot, line);
      const repo = rel.split(path.sep)[0];
      if (repo && !repo.startsWith('..')) result.add(repo);
    }
  } catch (err: unknown) {
    // grep exits 1 when no matches — that's fine.
    const e = err as { status?: number };
    if (e.status !== 1) {
      add({
        severity: 'warn',
        code: 'grep-error',
        message: `grep failed for needle "${needle}"`,
        context: { error: String(err) },
      });
    }
  }

  grepCache.set(needle, result);
  return result;
}

/**
 * For a service id, return the set of repos that should be considered
 * "this service". For most services that's a single repo; for `echo`
 * it includes echo + its subServices' repos.
 */
function reposForService(serviceId: string): string[] {
  const svc = SERVICES_BY_ID[serviceId] as Service | undefined;
  if (!svc) {
    const sub = allSubServices.find(s => s.id === serviceId);
    return sub?.repo ? [sub.repo] : [];
  }
  const repos: string[] = [];
  if (svc.repo) repos.push(svc.repo);
  for (const s of svc.subServices ?? []) {
    if (s.repo) repos.push(s.repo);
  }
  return repos;
}

// ──────────────────────────────────────────────────────────────────
//  Internal checks
// ──────────────────────────────────────────────────────────────────
function checkStepReferences(): void {
  for (let i = 0; i < STEPS.length; i++) {
    const step: Step = STEPS[i];
    const ctx = { stepIndex: i, phase: step.phase, label: step.label };

    if (!allScenarioPhaseIds.has(step.phase)) {
      add({
        severity: 'error',
        code: 'unknown-phase',
        message: `step.phase ${step.phase} has no matching Scenario.phaseId`,
        context: ctx,
      });
    }

    const fromKnown = allServiceIds.has(step.from) || allTopicIds.has(step.from);
    if (!fromKnown) {
      add({
        severity: 'error',
        code: 'unknown-step-from',
        message: `step.from "${step.from}" is not a known service or topic`,
        context: ctx,
      });
    }

    const toKnown = allServiceIds.has(step.to) || allTopicIds.has(step.to);
    if (!toKnown) {
      add({
        severity: 'error',
        code: 'unknown-step-to',
        message: `step.to "${step.to}" is not a known service or topic`,
        context: ctx,
      });
    }

    if (step.through && !allServiceIds.has(step.through)) {
      add({
        severity: 'error',
        code: 'unknown-step-through',
        message: `step.through "${step.through}" is not a known service`,
        context: ctx,
      });
    }

    if (step.type === 'kafka') {
      if (!step.via) {
        add({
          severity: 'error',
          code: 'kafka-step-missing-via',
          message: `Kafka step has no "via" topic id`,
          context: ctx,
        });
      } else if (!allTopicIds.has(step.via)) {
        add({
          severity: 'error',
          code: 'unknown-step-via',
          message: `step.via "${step.via}" is not a known topic id`,
          context: ctx,
        });
      }
    }
  }
}

function checkServiceOwners(): void {
  for (const svc of SERVICES) {
    const owner = resolveOwner(svc);
    if (owner.source === 'fallback' && svc.repo) {
      // Has a repo but no team → drift-sync PRs would fall through.
      add({
        severity: 'warn',
        code: 'service-no-owner',
        message: `Service "${svc.id}" (repo: ${svc.repo}) has no team — drift PRs will hit the fallback owner`,
        context: { service: svc.id, team: svc.team ?? null },
      });
    }
  }
}

// ──────────────────────────────────────────────────────────────────
//  External checks (require source repo access)
// ──────────────────────────────────────────────────────────────────
function checkServiceRepos(): void {
  for (const svc of SERVICES) {
    if (!svc.repo) continue;
    if (!repoExists(svc.repo)) {
      add({
        severity: 'error',
        code: 'missing-repo',
        message: `Service "${svc.id}" references repo "${svc.repo}" which does not exist under ${reposRoot}`,
        context: { service: svc.id, repo: svc.repo },
      });
    }
  }
  for (const sub of allSubServices) {
    if (!sub.repo) continue;
    if (!repoExists(sub.repo)) {
      add({
        severity: 'error',
        code: 'missing-sub-repo',
        message: `SubService "${sub.id}" references repo "${sub.repo}" which does not exist under ${reposRoot}`,
        context: { subService: sub.id, repo: sub.repo },
      });
    }
  }
}

function checkTopicPresence(): void {
  for (const topic of TOPICS) {
    const repos = reposContaining(topic.name);
    if (repos.size === 0) {
      add({
        severity: 'error',
        code: 'topic-name-not-found',
        message: `Topic.name "${topic.name}" (id: ${topic.id}) does not appear as a literal string in any source repo`,
        context: { topicId: topic.id, topicName: topic.name },
      });
    } else if (repos.size === 1) {
      add({
        severity: 'warn',
        code: 'topic-name-single-repo',
        message: `Topic "${topic.name}" only appears in one repo (${[...repos][0]}) — expected at least a producer + consumer`,
        context: { topicId: topic.id, topicName: topic.name, foundIn: [...repos] },
      });
    }
  }
}

function checkKafkaStepProducerConsumer(): void {
  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    if (step.type !== 'kafka' || !step.via) continue;
    const topic: Topic | undefined = TOPICS_BY_ID[step.via];
    if (!topic) continue; // already flagged by internal check
    const needle = topic.name;
    const reposWithTopic = reposContaining(needle);

    const fromRepos = reposForService(step.from);
    // For 3-hop kafka broadcasts (step.through is set), the actual Kafka
    // consumer is the through-service (e.g. echo), not the final destination
    // (e.g. browser, which gets the message over a downstream WebSocket).
    const consumerServiceId = step.through ?? step.to;
    const toRepos = reposForService(consumerServiceId);

    // Producer side
    const checkableFromRepos = fromRepos.filter(r => !reposNotInWorkspace.has(r));
    if (checkableFromRepos.length > 0) {
      const producerHit = checkableFromRepos.some(r => reposWithTopic.has(r));
      if (!producerHit) {
        add({
          severity: 'warn',
          code: 'producer-missing-topic-name',
          message: `Kafka step ${step.from} → ${step.to} via "${needle}": producer repo(s) ${JSON.stringify(checkableFromRepos)} do not contain the topic name`,
          context: {
            stepIndex: i, phase: step.phase, label: step.label,
            topic: needle, topicId: topic.id, expectedIn: fromRepos, foundIn: [...reposWithTopic],
          },
        });
      }
    }

    // Consumer side
    const checkableToRepos = toRepos.filter(r => !reposNotInWorkspace.has(r));
    if (checkableToRepos.length > 0) {
      const consumerHit = checkableToRepos.some(r => reposWithTopic.has(r));
      if (!consumerHit) {
        add({
          severity: 'warn',
          code: 'consumer-missing-topic-name',
          message: `Kafka step ${step.from} → ${consumerServiceId} via "${needle}": consumer repo(s) ${JSON.stringify(checkableToRepos)} do not contain the topic name`,
          context: {
            stepIndex: i, phase: step.phase, label: step.label,
            topic: needle, topicId: topic.id, expectedIn: toRepos, foundIn: [...reposWithTopic],
          },
        });
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────
//  Run
// ──────────────────────────────────────────────────────────────────
function run(): void {
  // Internal checks — always run, fast, no source-repo dependency.
  checkStepReferences();
  checkServiceOwners();
  // Cross-repo checks — require the tracked source repos cloned at reposRoot.
  // Skipped by default; opt in with --source-check for the deeper sweep.
  if (sourceCheck) {
    checkServiceRepos();
    checkTopicPresence();
    checkKafkaStepProducerConsumer();
  }
}

run();

// ──────────────────────────────────────────────────────────────────
//  Output
// ──────────────────────────────────────────────────────────────────
const counts = findings.reduce(
  (acc, f) => ((acc[f.severity] = (acc[f.severity] ?? 0) + 1), acc),
  {} as Record<Severity, number>,
);

if (jsonOut) {
  console.log(JSON.stringify({ counts, findings }, null, 2));
} else {
  const groupBy = <T>(arr: T[], k: (v: T) => string) =>
    arr.reduce((m, v) => { (m[k(v)] ??= []).push(v); return m; }, {} as Record<string, T[]>);

  const byCode = groupBy(findings, f => f.code);

  console.log('═'.repeat(78));
  console.log(' Cosmos drift validator');
  console.log('═'.repeat(78));
  console.log(` mode:       ${sourceCheck ? 'internal + source-check (cross-repo grep)' : 'internal-only (use --source-check for deeper sweep)'}`);
  if (sourceCheck) console.log(` repos-root: ${reposRoot}`);
  console.log(` services:   ${SERVICES.length}  topics: ${TOPICS.length}  steps: ${STEPS.length}  scenarios: ${SCENARIOS.length}`);
  console.log('');
  console.log(` errors: ${counts.error ?? 0}   warnings: ${counts.warn ?? 0}   info: ${counts.info ?? 0}   suppressed: ${suppressedCount}`);
  console.log('');

  if (findings.length === 0) {
    console.log(' ✓ No drift detected.');
  } else {
    for (const code of Object.keys(byCode).sort()) {
      const group = byCode[code];
      const sev = group[0].severity.toUpperCase();
      console.log(`── [${sev}] ${code} (${group.length})`);
      for (const f of group) {
        console.log(`   • ${f.message}`);
        if (f.context) {
          for (const [k, v] of Object.entries(f.context)) {
            console.log(`       ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
          }
        }
      }
      console.log('');
    }
  }
}

process.exit(counts.error > 0 ? 1 : 0);
