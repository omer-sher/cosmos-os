#!/usr/bin/env -S npx tsx
/**
 * Cosmos drift-sync nightly orchestrator — dry-run mode
 *
 * Loops every repo in drift-sync/state.json, runs `diff-repo --json` on
 * each (concurrency-capped), collects verdicts, buckets drifts by team,
 * and writes a markdown report showing exactly what PRs would be opened
 * and what Slack messages would be posted.
 *
 * No PRs are created and no Slack is posted. The output file is for
 * eyeball review before we flip to live mode.
 *
 * Usage:
 *   npm run sync:nightly                       # all repos, default output path
 *   npm run sync:nightly -- --concurrency 3    # cap parallel agents
 *   npm run sync:nightly -- --only <repo>      # only this repo
 *   npm run sync:nightly -- --out <path>       # custom report path
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, appendFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';

import { loadEnv } from './lib/agent.js';
loadEnv();

import { loadSyncState } from './lib/git.js';
import { TEAM_OWNERS, FALLBACK_OWNER } from '../../src/scenarios/owners.js';
import type { TeamOwner } from '../../src/scenarios/owners.js';
import { buildHtmlReport } from './lib/report-html.js';
import { sumUsage, estimateCost } from './lib/agent.js';
import { loadDriftSyncConfig, slackGroupIdForTeam } from './lib/config.js';

const config = loadDriftSyncConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(here, '..', 'state.json');

const args = process.argv.slice(2);
const concurrencyIdx = args.indexOf('--concurrency');
const CONCURRENCY = concurrencyIdx >= 0 ? Number(args[concurrencyIdx + 1]) : 5;
const onlyIdx = args.indexOf('--only');
const onlyRepo = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const skipApplier = args.includes('--skip-applier');
const livePr = args.includes('--live-pr');
const prBaseIdx = args.indexOf('--pr-base');
const prBase = prBaseIdx >= 0 ? args[prBaseIdx + 1] : config.defaultBranch;
const outIdx = args.indexOf('--out');
const dateStr = new Date().toISOString().slice(0, 10);
const defaultOutDir = path.resolve(here, '..', 'dry-runs');
const outFile = outIdx >= 0 ? args[outIdx + 1] : path.join(defaultOutDir, `${dateStr}.md`);
mkdirSync(path.dirname(outFile), { recursive: true });

const state = loadSyncState(statePath);
if (!state) {
  console.error('No drift-sync/state.json found. Run `npm run sync:bootstrap` first.');
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────────────────────────
interface CosmosEdit {
  file: string;
  rationale: string;
  patch_hint?: string;
}

interface Change {
  kind: string;
  description: string;
  evidence: string[];
  proposed_cosmos_edits: CosmosEdit[];
}

interface Verdict {
  verdict: 'drift' | 'no_drift' | 'inconclusive';
  confidence?: 'high' | 'medium' | 'low';
  service: string;
  team?: string;
  from_sha: string;
  to_sha: string;
  changes: Change[];
  summary: string;
}

interface RepoResult {
  repo: string;
  ok: boolean;
  verdict?: Verdict;
  error?: string;
  durationMs: number;
}

// ──────────────────────────────────────────────────────────────────
//  Pick repos to process
// ──────────────────────────────────────────────────────────────────
const candidates = Object.entries(state.repos)
  .filter(([repo, entry]) => {
    if (entry.skipped) return false;
    if (!entry.sha) return false;
    if (onlyRepo && repo !== onlyRepo) return false;
    return true;
  })
  .map(([repo]) => repo)
  .sort();

console.log('\n═══ cosmos-sync nightly (dry-run) ═══');
console.log(`  repos to process: ${candidates.length}`);
console.log(`  concurrency:      ${CONCURRENCY}`);
console.log(`  output:           ${outFile}`);
console.log('');

// ──────────────────────────────────────────────────────────────────
//  Spawn one diff-repo subprocess and parse its JSON
// ──────────────────────────────────────────────────────────────────
function runDiffRepo(repo: string): Promise<RepoResult> {
  const startTs = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      ['tsx', path.join(here, 'diff-repo.ts'), repo, '--json'],
      {
        cwd: path.resolve(here, '..'),
        env: process.env,
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', (code) => {
      const durationMs = Date.now() - startTs;
      if (code !== 0) {
        resolve({ repo, ok: false, error: `exit ${code}: ${(stderr || stdout).slice(-500)}`, durationMs });
        return;
      }
      // diff-repo --json emits a single JSON object on stdout.
      const jsonMatch = stdout.match(/\{[\s\S]*\}\s*$/);
      if (!jsonMatch) {
        resolve({ repo, ok: false, error: `no JSON in stdout: ${stdout.slice(0, 500)}`, durationMs });
        return;
      }
      try {
        const verdict = JSON.parse(jsonMatch[0]) as Verdict;
        resolve({ repo, ok: true, verdict, durationMs });
      } catch (err) {
        resolve({ repo, ok: false, error: `parse error: ${String(err)} :: ${jsonMatch[0].slice(0, 300)}`, durationMs });
      }
    });
  });
}

// ──────────────────────────────────────────────────────────────────
//  Concurrency-limited worker pool
// ──────────────────────────────────────────────────────────────────
async function runPool(items: string[], max: number): Promise<RepoResult[]> {
  const results: RepoResult[] = [];
  let i = 0;
  async function next(): Promise<void> {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      const r = await runDiffRepo(items[idx]);
      results.push(r);
      const status =
        r.ok && r.verdict?.verdict === 'drift' ? '🚨 drift' :
        r.ok && r.verdict?.verdict === 'inconclusive' ? '❓ inconclusive' :
        r.ok && r.verdict?.verdict === 'no_drift' ? '✅ no_drift' :
        '❌ error';
      console.log(`  [${results.length.toString().padStart(2)}/${items.length}] ${status.padEnd(16)} ${r.repo}  (${(r.durationMs / 1000).toFixed(1)}s)`);
    }
  }
  const workers = Array.from({ length: Math.min(max, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ──────────────────────────────────────────────────────────────────
//  Run all
// ──────────────────────────────────────────────────────────────────
const startTs = Date.now();
console.log('Running diff-repo agents…\n');
const results = await runPool(candidates, CONCURRENCY);
const totalMs = Date.now() - startTs;

// ──────────────────────────────────────────────────────────────────
//  Bucket
// ──────────────────────────────────────────────────────────────────
const drifts = results.filter(r => r.ok && r.verdict?.verdict === 'drift');
const inconclusives = results.filter(r => r.ok && r.verdict?.verdict === 'inconclusive');
const noDrifts = results.filter(r => r.ok && r.verdict?.verdict === 'no_drift');
const errors = results.filter(r => !r.ok);

const byTeam = new Map<string, RepoResult[]>();
for (const r of [...drifts, ...inconclusives]) {
  const team = r.verdict?.team ?? 'unknown';
  if (!byTeam.has(team)) byTeam.set(team, []);
  byTeam.get(team)!.push(r);
}

// ──────────────────────────────────────────────────────────────────
//  Run the applier per team (sequential — applier reverts between runs)
// ──────────────────────────────────────────────────────────────────
// here = drift-sync/scripts → the cosmos repo root is TWO levels up. Was '..',
// which resolved to drift-sync/ — so every git op below (and the applier
// subprocess spawned with cwd: cosmosRoot) ran against the wrong root and the
// WRITABLE_PATHS pathspecs never matched the real files.
const cosmosRoot = path.resolve(here, '..', '..');
const WRITABLE_PATHS = ['src/scenarios/', 'drift-sync/cosmos-confirmed.json'];

/**
 * Force the applier-writable surface back to a pristine state: revert tracked
 * edits AND remove untracked files. Each git call is isolated so one failing
 * can't skip the other. Returns the residual `git status --porcelain` (empty
 * string = clean) so callers can detect — and log — anything the reset could
 * not clear (e.g. dirt outside WRITABLE_PATHS).
 */
function resetWritableSurface(): string {
  try { execFileSync('git', ['checkout', '--', ...WRITABLE_PATHS], { cwd: cosmosRoot, stdio: 'ignore' }); } catch { /* ignore */ }
  try { execFileSync('git', ['clean', '-fdq', '--', ...WRITABLE_PATHS], { cwd: cosmosRoot, stdio: 'ignore' }); } catch { /* ignore */ }
  try {
    return execFileSync('git', ['status', '--porcelain', '--', ...WRITABLE_PATHS], { cwd: cosmosRoot, encoding: 'utf8' }).trim();
  } catch { return ''; }
}

const STATE_REL = 'drift-sync/state.json';

/**
 * Advance the drift-sync baseline SHAs for the repos whose drift was actually
 * applied, then ship the bump INSIDE the team's PR. Merging the PR therefore
 * both updates Cosmos and records "we're caught up to <to_sha>" atomically —
 * the next run sees baseline == HEAD for these repos, skips the clone, and
 * emits a synthetic no_drift, so handled drift never re-surfaces. Scoped to
 * repos with >=1 applied edit, so an entirely-skipped repo still re-surfaces.
 * Writes state.json in place (the caller stages it); returns the moved repos.
 */
function advanceBaselines(driftItems: RepoResult[], ap: ApplierResult): string[] {
  const applied = new Set((ap.applier_report?.applied ?? []).map(e => e.verdict_service));
  const statePath = path.join(cosmosRoot, STATE_REL);
  let state: { repos?: Record<string, { sha?: string }> };
  try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch { return []; }
  const moved: string[] = [];
  for (const r of driftItems) {
    const v = r.verdict;
    if (!v || v.verdict !== 'drift' || !v.to_sha) continue;
    if (!applied.has(v.service)) continue;
    const entry = state.repos?.[v.service];
    if (entry && entry.sha !== v.to_sha) { entry.sha = v.to_sha; moved.push(v.service); }
  }
  if (moved.length) writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  return moved;
}

/**
 * Auto-advance baselines for repos that had a real delta (HEAD != baseline)
 * but NO Cosmos drift. A no_drift verdict means HEAD is confirmed
 * Cosmos-consistent — there is nothing to review, so the next run can safely
 * skip re-cloning/re-analyzing it. Skips synthetic no_drift (no delta) and
 * low-confidence verdicts (re-checked next run rather than silently burying a
 * possible false negative). Writes state.json; returns the moved repos.
 */
function advanceNoDriftBaselines(noDriftResults: RepoResult[]): string[] {
  const statePath = path.join(cosmosRoot, STATE_REL);
  let state: { repos?: Record<string, { sha?: string }> };
  try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch { return []; }
  const moved: string[] = [];
  for (const r of noDriftResults) {
    const v = r.verdict;
    if (!v || v.verdict !== 'no_drift' || !v.to_sha || !v.from_sha) continue;
    if (v.to_sha === v.from_sha) continue;   // no delta (e.g. clone-skipped) — already at baseline
    if (v.confidence === 'low') continue;    // shaky no_drift — re-check next run, don't bury it
    const entry = state.repos?.[v.service];
    if (entry && entry.sha !== v.to_sha) { entry.sha = v.to_sha; moved.push(v.service); }
  }
  if (moved.length) writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  return moved;
}

/**
 * Advance the no-drift baselines via a single AUTO-MERGED chore PR. main is
 * ruleset-protected (required check `validate`, no bypass actors), so a direct
 * push of a fresh commit is rejected. Instead we open one PR that carries only
 * the state.json bump (no Cosmos data change → `validate` passes trivially) and
 * enable auto-merge, so it squash-merges itself once the check is green — no
 * human action. Idempotent: if anything fails, the next run re-detects the same
 * no_drift delta and retries. CI runners are ephemeral, so a half-done attempt
 * never persists.
 */
function openNoDriftAdvancePR(moved: string[]): void {
  if (!moved.length) return;
  const git = (a: string[]) => execFileSync('git', a, { cwd: cosmosRoot, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  const branch = `cosmos-sync/state-${dateStr}-${Date.now().toString(36)}`;
  const title = `[cosmos-sync] chore: advance ${moved.length} no-drift baseline${moved.length === 1 ? '' : 's'}`;
  const bodyFile = path.join(os.tmpdir(), `cosmos-state-pr-${Date.now()}.md`);
  try {
    git(['checkout', '-b', branch]);
    git(['add', STATE_REL]);
    git(['commit', '-m', `${title}\n\n${moved.join(', ')} had new commits but no Cosmos-relevant drift — baseline advanced so the next run skips them.`]);
    git(['push', '-u', 'origin', branch]);
    writeFileSync(bodyFile, [
      '🤖 Auto-generated by `scripts/sync-nightly.ts`.',
      '',
      'These repos had new commits but **no Cosmos-relevant drift**, so their drift-sync baseline is advanced — the next run sees `baseline == HEAD` and skips re-cloning/re-analyzing them.',
      '',
      ...moved.map(r => `- \`${r}\``),
      '',
      '_`state.json` baseline bump only — no Cosmos data change. Auto-merges once `validate` passes._',
    ].join('\n'));
    const ghArgs = ['pr', 'create', '--base', prBase, '--head', branch, '--title', title, '--body-file', bodyFile];
    let prUrl = '';
    try { prUrl = execFileSync('gh', [...ghArgs, '--label', 'cosmos-sync,chore'], { cwd: cosmosRoot, encoding: 'utf8' }).trim(); }
    catch { prUrl = execFileSync('gh', ghArgs, { cwd: cosmosRoot, encoding: 'utf8' }).trim(); }
    try {
      execFileSync('gh', ['pr', 'merge', prUrl, '--auto', '--squash', '--delete-branch'], { cwd: cosmosRoot, stdio: ['ignore', 'pipe', 'pipe'] });
      console.log(`  [state] no-drift advance PR (auto-merge enabled): ${prUrl} → ${moved.join(', ')}`);
    } catch (e) {
      const err = e as { stderr?: Buffer };
      console.log(`  [state] no-drift advance PR opened but auto-merge failed (merge manually): ${prUrl}  ${(err.stderr?.toString() ?? '').slice(-160)}`);
    }
  } catch (err) {
    const e = err as { stderr?: Buffer; stdout?: Buffer };
    console.log(`  [state] no-drift advance PR failed (will retry next run): ${(e.stderr?.toString() ?? e.stdout?.toString() ?? String(err)).slice(-200)}`);
  } finally {
    try { unlinkSync(bodyFile); } catch { /* ignore */ }
    // Return to base + clean working tree for the rest of the run.
    try { git(['checkout', prBase]); git(['checkout', '--', STATE_REL]); } catch { /* ignore */ }
  }
}

interface AgentUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

interface ApplierResult {
  team: string;
  verdicts_count: number;
  iterations: number;
  applier_report: {
    applied?: { verdict_service: string; file: string; summary: string }[];
    skipped?: { verdict_service: string; reason: string }[];
    validator_passed?: boolean;
    summary?: string;
  } | null;
  diff: string;
  diff_line_count: number;
  dry_run_reverted: boolean;
  pr_url?: string;
  usage?: AgentUsage;
  model?: string;
}

// Single channel for all cosmos-sync Slack notifications. The team is
// identified by an @-mention in the message body instead of by channel.
// The env var NAME is configurable (config.slackWebhookEnv); the URL itself
// always comes from the environment so it never lands in the repo.
const COSMOS_WEBHOOK_ENV = config.slackWebhookEnv;

/**
 * Render an @-mention for a team. If a Slack user-group ID (e.g. "S012345")
 * is configured — via the SLACK_GROUP_ID_<TEAM> env var or the
 * slackTeamGroups map in drift-sync/config.json — uses <!subteam^…> so the
 * group is actually pinged. Otherwise falls back to plain "@<team>" text —
 * still readable, just not a notification.
 */
function teamMention(team: string): string {
  const groupId = slackGroupIdForTeam(config, team);
  if (groupId) return `<!subteam^${groupId}>`;
  return `@${team}`;
}

/**
 * Post a Slack notification for a team's drift PR to the single cosmos
 * channel (SLACK_WEBHOOK_COSMOS). Tags the team via Slack user group
 * (or plain @text if no group ID configured). Silently skips if no
 * webhook is set.
 */
async function postSlack(team: string, items: RepoResult[], ap: ApplierResult, prUrl: string): Promise<{ posted: boolean; reason?: string }> {
  const webhook = process.env[COSMOS_WEBHOOK_ENV];
  if (!webhook) {
    return { posted: false, reason: `no webhook configured (${COSMOS_WEBHOOK_ENV} not set)` };
  }
  // Worst confidence drives the icon
  const confs = items.map(r => r.verdict?.confidence ?? 'low');
  const conf: 'high' | 'medium' | 'low' = confs.includes('low') ? 'low' : confs.includes('medium') ? 'medium' : 'high';
  const icon = conf === 'low' ? ':rotating_light:' : conf === 'medium' ? ':warning:' : ':white_check_mark:';
  const action = conf === 'low' ? 'NEEDS INVESTIGATION' : conf === 'medium' ? 'needs review' : 'ready for review';
  const repos = items.map(r => `\`${r.repo}\``).join(', ');
  const editCount = ap.applier_report?.applied?.length ?? 0;
  const text = [
    `${icon} *cosmos-sync · ${team}* · ${teamMention(team)}`,
    `${items.length} service${items.length === 1 ? '' : 's'} drifted: ${repos}`,
    `Applier wrote ${editCount} edit(s) · validator ${ap.applier_report?.validator_passed ? '✅' : '❌'}`,
    `PR (${action}): ${prUrl}`,
  ].join('\n');
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return { posted: false, reason: `webhook returned ${res.status}` };
    return { posted: true };
  } catch (err) {
    return { posted: false, reason: String(err).slice(0, 200) };
  }
}

/**
 * Post the nightly "all clear" heartbeat to the cosmos channel.
 * Called only on a fully clean live run — zero drift findings and zero
 * errors — so the channel sees positive confirmation the sync ran and
 * everything is in sync. No @-mentions — this is a quiet heartbeat.
 */
async function postAllClear(repoCount: number, inconclusiveCount: number, durationMs: number): Promise<{ posted: boolean; reason?: string }> {
  const webhook = process.env[COSMOS_WEBHOOK_ENV];
  if (!webhook) {
    return { posted: false, reason: `no webhook configured (${COSMOS_WEBHOOK_ENV} not set)` };
  }
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
  const incTail = inconclusiveCount > 0 ? ` (${inconclusiveCount} inconclusive)` : '';
  const lines = [
    `:white_check_mark: *cosmos-sync · all clear*`,
    `${repoCount} repo${repoCount === 1 ? '' : 's'} checked in ${(durationMs / 1000).toFixed(0)}s — no drift detected${incTail}.`,
  ];
  if (runUrl) lines.push(`<${runUrl}|Run log>`);
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
    });
    if (!res.ok) return { posted: false, reason: `webhook returned ${res.status}` };
    return { posted: true };
  } catch (err) {
    return { posted: false, reason: String(err).slice(0, 200) };
  }
}

interface ParsedError {
  /** One-line, human-readable failure reason for the Slack headline. */
  short: string;
  /** The underlying API/agent message, when one could be extracted. */
  detail?: string;
}

/**
 * Turn a failed subprocess's raw stderr/stdout into a clean reason. The
 * Anthropic SDK prints the whole error object into its stack trace, so we
 * pull out `type` + `message` and recognize a few common failure modes
 * (workspace spend cap, rate limit, overload, auth) so the Slack post reads
 * nicely instead of dumping a stack trace. Falls back to the last log line.
 */
function parseAgentError(raw: string): ParsedError {
  const text = (raw ?? '').trim();
  if (!text) return { short: 'unknown error (no output captured)' };

  // The SDK prints the error object in the trace: `message: '…'`, `type: '…'`.
  const message = (text.match(/message:\s*'([^']+)'/) ?? text.match(/"message"\s*:\s*"([^"]+)"/))?.[1];
  const type = (text.match(/type:\s*'([^']+)'/) ?? text.match(/"type"\s*:\s*"([^"]+)"/))?.[1];

  if (message) {
    const detail = message.slice(0, 300);
    if (/workspace API usage limit/i.test(message)) {
      return { short: 'Anthropic API workspace usage limit reached', detail };
    }
    if (type === 'rate_limit_error' || /rate limit/i.test(message)) {
      return { short: 'Anthropic API rate limit', detail };
    }
    if (type === 'overloaded_error' || /overloaded/i.test(message)) {
      return { short: 'Anthropic API overloaded', detail };
    }
    if (type === 'authentication_error' || /x-api-key|authentication/i.test(message)) {
      return { short: 'Anthropic API auth error (check ANTHROPIC_API_KEY)', detail };
    }
    return { short: type ? `Anthropic API ${type}` : 'agent error', detail };
  }

  // No structured API error — surface the last meaningful line of output.
  const lastLine = text.split('\n').map(l => l.trim()).filter(Boolean).pop() ?? text;
  return { short: lastLine.slice(0, 200) };
}

/**
 * Post a degraded-run notification to the cosmos channel. Fires whenever the
 * nightly hit applier/PR failures or diff-repo errors, so the channel is
 * never silently dark when something broke — including the case where drift
 * was detected but no PR could be opened (e.g. API usage cap). No
 * @-mentions: this is an ops signal for cosmos maintainers, not a team ping.
 */
async function postFailure(
  failures: { team: string; stage: 'applier' | 'pr'; reason: ParsedError }[],
  diffErrors: RepoResult[],
  unreportedDriftTeams: string[],
): Promise<{ posted: boolean; reason?: string }> {
  const webhook = process.env[COSMOS_WEBHOOK_ENV];
  if (!webhook) {
    return { posted: false, reason: `no webhook configured (${COSMOS_WEBHOOK_ENV} not set)` };
  }
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

  const lines: string[] = [':rotating_light: *cosmos-sync · run degraded*'];
  if (failures.length > 0) {
    lines.push(`*${failures.length} ${failures.length === 1 ? 'failure' : 'failures'}* — drift detected but no PR opened:`);
    for (const f of failures) {
      const detail = f.reason.detail ? ` — ${f.reason.detail}` : '';
      lines.push(`• \`${f.team}\` (${f.stage}): ${f.reason.short}${detail}`);
    }
  }
  if (diffErrors.length > 0) {
    lines.push(`*${diffErrors.length} repo${diffErrors.length === 1 ? '' : 's'} failed to diff:* ${diffErrors.map(r => `\`${r.repo}\``).join(', ')}`);
  }
  if (unreportedDriftTeams.length > 0) {
    lines.push(`_Unreported drift: ${unreportedDriftTeams.map(t => `\`${t}\``).join(', ')} — re-run once resolved._`);
  }
  if (runUrl) lines.push(`<${runUrl}|Run log>`);

  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
    });
    if (!res.ok) return { posted: false, reason: `webhook returned ${res.status}` };
    return { posted: true };
  } catch (err) {
    return { posted: false, reason: String(err).slice(0, 200) };
  }
}

/** Icon for a change kind to make the PR body scannable. */
function kindIcon(kind: string): string {
  if (kind.endsWith('_added')) return '🆕';
  if (kind.endsWith('_removed')) return '🗑️';
  if (kind.endsWith('_renamed') || kind === 'payload_changed') return '✏️';
  return '📝';
}

/** Pretty label for a change kind. */
function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    topic_added:       'New topic',
    topic_removed:     'Topic removed',
    topic_renamed:     'Topic renamed',
    producer_added:    'New producer',
    producer_removed: 'Producer removed',
    consumer_added:    'New consumer',
    consumer_removed: 'Consumer removed',
    route_added:       'New HTTP route',
    route_removed:     'Route removed',
    route_renamed:     'Route renamed',
    payload_changed:   'Payload schema changed',
    service_added:     'New service',
    service_removed:   'Service removed',
    service_renamed:   'Service renamed',
    other:             'Other change',
  };
  return labels[kind] ?? kind;
}

/** Build the PR body markdown for one team. */
function buildPrBody(team: string, items: RepoResult[], ap: ApplierResult): string {
  const lines: string[] = [];

  // ─── Header ───────────────────────────────────────
  lines.push(`# cosmos-sync · ${team} domain`);
  lines.push('');
  lines.push(`> 🤖 **Auto-generated by cosmos-sync.** Drift detected by AI agent in \`scripts/diff-repo.ts\`. Cosmos edits produced by \`scripts/apply-edits.ts\`. \`npm run validate\` passed in-loop.`);
  lines.push('');

  // ─── TL;DR table ──────────────────────────────────
  lines.push('## 📋 TL;DR');
  lines.push('');
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| **Services drifted** | ${items.map(r => `\`${r.repo}\``).join(', ')} |`);
  lines.push(`| **Total findings** | ${items.reduce((acc, r) => acc + (r.verdict?.changes?.length ?? 0), 0)} |`);
  lines.push(`| **Cosmos edits applied** | ${ap.applier_report?.applied?.length ?? '?'} |`);
  lines.push(`| **Validator** | ${ap.applier_report?.validator_passed ? '✅ passed' : '❌ FAILED'} |`);
  if (ap.applier_report?.skipped && ap.applier_report.skipped.length > 0) {
    lines.push(`| **Skipped (manual follow-up)** | ${ap.applier_report.skipped.length} |`);
  }
  lines.push('');

  // ─── What this PR modifies ────────────────────────
  if (ap.applier_report?.applied && ap.applier_report.applied.length > 0) {
    lines.push('## ✍️ What this PR modifies in Cosmos');
    lines.push('');
    // Group applied edits by file
    const byFile = new Map<string, { verdict_service: string; summary: string }[]>();
    for (const e of ap.applier_report.applied) {
      if (!byFile.has(e.file)) byFile.set(e.file, []);
      byFile.get(e.file)!.push({ verdict_service: e.verdict_service, summary: e.summary });
    }
    for (const [file, edits] of byFile) {
      lines.push(`### \`${file}\``);
      lines.push('');
      for (const e of edits) {
        lines.push(`- ${e.summary}  _(for \`${e.verdict_service}\`)_`);
      }
      lines.push('');
    }
  }

  // ─── Why this PR exists ───────────────────────────
  lines.push('## 🔍 Why these changes — drift findings');
  lines.push('');
  for (const item of items) {
    const v = item.verdict!;
    lines.push(`### \`${v.service}\``);
    lines.push('');
    lines.push(`**Verdict:** ${v.verdict} · **Confidence:** ${v.confidence ?? '—'} · **Sha range:** \`${v.from_sha.slice(0, 8)}\` → \`${v.to_sha.slice(0, 8)}\``);
    lines.push('');
    lines.push(`${v.summary}`);
    lines.push('');
    if (v.changes && v.changes.length > 0) {
      // Categorize by kind icon
      for (const c of v.changes) {
        lines.push(`#### ${kindIcon(c.kind)} ${kindLabel(c.kind)}`);
        lines.push('');
        lines.push(c.description);
        lines.push('');
        if (c.evidence?.length) {
          lines.push('**Evidence:**');
          for (const e of c.evidence.slice(0, 6)) lines.push(`- ${e}`);
          if (c.evidence.length > 6) lines.push(`- _…${c.evidence.length - 6} more_`);
          lines.push('');
        }
      }
    }
  }

  // ─── Skipped edits (need humans) ──────────────────
  if (ap.applier_report?.skipped && ap.applier_report.skipped.length > 0) {
    lines.push('## ⚠️ Skipped edits (manual follow-up needed)');
    lines.push('');
    lines.push('The applier intentionally skipped these — they need human judgement:');
    lines.push('');
    for (const s of ap.applier_report.skipped) {
      lines.push(`- **\`${s.verdict_service}\`** — ${s.reason}`);
    }
    lines.push('');
  }

  // ─── Full diff (collapsed) ────────────────────────
  if (ap.diff && ap.diff.trim().length > 0) {
    const diffLines = ap.diff.split('\n');
    const truncated = diffLines.length > 400 ? diffLines.slice(0, 400).join('\n') + `\n…[${diffLines.length - 400} more lines — see PR Files tab]` : ap.diff;
    lines.push('<details>');
    lines.push(`<summary><b>📄 Full diff (${diffLines.length} lines) — click to expand</b></summary>`);
    lines.push('');
    lines.push('```diff');
    lines.push(truncated);
    lines.push('```');
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  // ─── How to review ────────────────────────────────
  lines.push('## 👀 How to review');
  lines.push('');
  lines.push('1. **Verify the findings**: read the "Why these changes" section above. Each finding has file:line evidence — open the linked lines in the source repo to confirm.');
  lines.push('2. **Review the diff**: PR "Files changed" tab shows exactly what Cosmos is updating.');
  lines.push('3. **If correct**: mark Ready for review and merge.');
  lines.push('4. **If wrong**: close with the `not-drift` label so the cron advances state but doesn\'t re-surface.');
  lines.push('');

  return lines.join('\n');
}

const applierResults = new Map<string, ApplierResult>();
const failures: { team: string; stage: 'applier' | 'pr'; reason: ParsedError }[] = [];
let applierSkipReason: string | null = null;

if (!skipApplier && byTeam.size > 0) {
  // Cleanliness pre-check
  let initialStatus = '';
  try {
    initialStatus = execFileSync('git', ['status', '--porcelain', '--', ...WRITABLE_PATHS], {
      cwd: cosmosRoot, encoding: 'utf8',
    }).trim();
  } catch (err) {
    applierSkipReason = `git status failed: ${String(err).slice(0, 200)}`;
  }

  if (initialStatus.length > 0 && !applierSkipReason) {
    applierSkipReason = `Cosmos writable surface is dirty (${initialStatus.split('\n').length} files). Commit/stash these before the applier can run:\n${initialStatus}`;
  }

  if (!applierSkipReason) {
    console.log('\nRunning applier per team (dry-run mode)…');
    for (const [team, items] of byTeam) {
      const driftItems = items.filter(r => r.verdict?.verdict === 'drift');
      if (driftItems.length === 0) continue;

      // Pristine start: the applier hard-aborts on ANY dirt in its writable
      // surface, so never let a previous team's leak cascade into this one.
      const preDirty = resetWritableSurface();
      if (preDirty) console.log(`  [applier:${team}] ⚠ writable surface still dirty after pre-reset:\n${preDirty}`);

      // Write verdict bundle to a temp file
      const verdictFile = path.join(os.tmpdir(), `cosmos-applier-input-${team}-${Date.now()}.json`);
      writeFileSync(verdictFile, JSON.stringify(driftItems.map(r => r.verdict), null, 2));
      const resultFile = path.join(os.tmpdir(), `cosmos-applier-output-${team}-${Date.now()}.json`);

      const applierStart = Date.now();
      const applierArgs = [
        'tsx', path.join(here, 'apply-edits.ts'),
        '--input', verdictFile,
        '--team', team,
        '--output-json', resultFile,
        // Capture turn-by-turn so a stalled applier (no report / empty diff /
        // iteration-cap) is diagnosable from the captured output tail below.
        '--verbose',
      ];
      // In live-pr mode we do NOT pass --dry-run; the applier leaves edits
      // in place and we open a real PR. Otherwise applier reverts after
      // capturing the diff.
      if (!livePr) applierArgs.push('--dry-run');

      let applierStdout: string;
      try {
        applierStdout = execFileSync('npx', applierArgs, { cwd: cosmosRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }) || '';

        let out: ApplierResult | null = null;
        if (existsSync(resultFile)) {
          out = JSON.parse(readFileSync(resultFile, 'utf8')) as ApplierResult;
          applierResults.set(team, out);
          console.log(`  [applier:${team}] iter=${out.iterations} diff=${out.diff_line_count} lines  applied=${out.applier_report?.applied?.length ?? '?'}  passed=${out.applier_report?.validator_passed ?? '?'}  (${((Date.now() - applierStart) / 1000).toFixed(1)}s)`);
        } else {
          console.log(`  [applier:${team}] no output file produced`);
        }

        // Live PR mode: branch + commit + push + gh pr create
        if (livePr && out && out.applier_report?.validator_passed && out.diff_line_count > 1) {
          const branchName = `cosmos-sync/${team}-${dateStr}-${Date.now().toString(36)}`;
          const items = byTeam.get(team)!;
          const summary = `${items.length} service${items.length === 1 ? '' : 's'} drifted: ${items.map(r => r.repo).join(', ')}`;
          const prBody = buildPrBody(team, items, out);
          const prBodyFile = path.join(os.tmpdir(), `cosmos-sync-pr-body-${team}-${Date.now()}.md`);
          writeFileSync(prBodyFile, prBody);

          // ── DEDUPE: don't open a new PR if one is already open for this team ─
          // Check for any open PR with both labels `cosmos-sync` AND `team:<team>`.
          // If found, append a comment to that PR instead of opening a duplicate.
          let existingPrUrl: string | null = null;
          let existingPrNumber: number | null = null;
          try {
            const listOut = execFileSync('gh', [
              'pr', 'list',
              '--state', 'open',
              '--label', `cosmos-sync,team:${team}`,
              '--json', 'number,url,headRefName',
              '--limit', '5',
            ], { cwd: cosmosRoot, encoding: 'utf8' });
            const existing = JSON.parse(listOut) as { number: number; url: string; headRefName: string }[];
            if (existing.length > 0) {
              existingPrUrl = existing[0].url;
              existingPrNumber = existing[0].number;
            }
          } catch { /* ignore — fall through to creating a new PR */ }

          if (existingPrNumber != null) {
            // Append a comment to the existing PR. State sha will only advance
            // when SOMEONE acts on it (merge or close-with-not-drift), so we
            // surface the latest findings as a comment until then.
            try {
              const commentBody = [
                `### Drift still detected as of \`${dateStr}\``,
                '',
                `This nightly run re-detected drift for **${team}** team. Latest findings (${items.length} service${items.length === 1 ? '' : 's'}):`,
                '',
                ...items.map(r => `- \`${r.verdict?.service}\` — ${r.verdict?.summary ?? '(no summary)'}`),
                '',
                `Applier wrote ${out.applier_report?.applied?.length ?? 0} edit(s) · validator ${out.applier_report?.validator_passed ? '✅' : '❌'} · ${out.diff_line_count} diff lines`,
                '',
                `_Auto-posted by sync-nightly (run ${process.env.GITHUB_RUN_ID ?? 'local'}). PR sha will advance when this PR is merged or closed with the \`not-drift\` label._`,
              ].join('\n');
              const commentFile = path.join(os.tmpdir(), `cosmos-sync-comment-${team}-${Date.now()}.md`);
              writeFileSync(commentFile, commentBody);
              execFileSync('gh', ['pr', 'comment', String(existingPrNumber), '--body-file', commentFile], { cwd: cosmosRoot, stdio: 'ignore' });
              unlinkSync(commentFile);
              console.log(`  [PR:${team}] DEDUPED — commented on existing #${existingPrNumber} (${existingPrUrl})`);
              out.pr_url = existingPrUrl!;

              // Slack ping with the existing PR url
              const slack = await postSlack(team, byTeam.get(team)!, out, existingPrUrl!);
              if (slack.posted) console.log(`  [slack:${team}] posted (dedupe)`);
              else console.log(`  [slack:${team}] skipped — ${slack.reason}`);
            } catch (err) {
              const e = err as { status?: number; stderr?: Buffer };
              console.log(`  [PR:${team}] DEDUPE comment failed: ${(e.stderr?.toString() ?? '').slice(-200)}`);
            } finally {
              try { unlinkSync(prBodyFile); } catch { /* ignore */ }
              // Revert the applier's edits — we didn't open a PR so don't keep them.
              try { execFileSync('git', ['checkout', '--', ...WRITABLE_PATHS], { cwd: cosmosRoot, stdio: 'ignore' }); } catch { /* ignore */ }
            }
            continue; // skip the new-PR flow below
          }

          try {
            execFileSync('git', ['checkout', '-b', branchName], { cwd: cosmosRoot, stdio: 'ignore' });
            // Advance baselines for the applied repos and ship the bump IN this
            // PR — merging it advances state.json atomically with the Cosmos
            // edits, so the next run skips re-cloning/re-analyzing them.
            const moved = advanceBaselines(driftItems, out);
            if (moved.length) console.log(`  [state:${team}] baseline advanced → ${moved.join(', ')}`);
            execFileSync('git', ['add', ...WRITABLE_PATHS, STATE_REL], { cwd: cosmosRoot, stdio: 'ignore' });
            execFileSync('git', ['commit', '-m', `[cosmos-sync] ${team} domain · ${summary}\n\nAuto-generated by scripts/sync-nightly.ts. Validator passed.`], { cwd: cosmosRoot, stdio: 'ignore' });
            execFileSync('git', ['push', '-u', 'origin', branchName], { cwd: cosmosRoot, stdio: 'ignore' });
            // Labels: best-effort. If a label doesn't exist on the repo,
            // gh pr create fails the whole call. Try with labels; on fail,
            // retry without. (Long-term: pre-create labels in the repo.)
            const ghArgs = [
              'pr', 'create',
              '--draft',
              '--base', prBase,
              '--head', branchName,
              '--title', `[cosmos-sync] ${team} domain · ${items.length} service${items.length === 1 ? '' : 's'} drifted`,
              '--body-file', prBodyFile,
            ];
            let prOut = '';
            try {
              prOut = execFileSync('gh', [...ghArgs, '--label', `cosmos-sync,team:${team}`], { cwd: cosmosRoot, encoding: 'utf8' });
            } catch {
              // Retry without labels.
              prOut = execFileSync('gh', ghArgs, { cwd: cosmosRoot, encoding: 'utf8' });
            }
            const prUrl = prOut.trim();
            console.log(`  [PR:${team}] ${prUrl}`);
            out.pr_url = prUrl;

            // Best-effort Slack notification.
            const slack = await postSlack(team, byTeam.get(team)!, out, prUrl);
            if (slack.posted) {
              console.log(`  [slack:${team}] posted`);
            } else {
              console.log(`  [slack:${team}] skipped — ${slack.reason}`);
            }
          } catch (err) {
            const e = err as { status?: number; stderr?: Buffer; stdout?: Buffer };
            const reason = parseAgentError(e.stderr?.toString() ?? e.stdout?.toString() ?? '');
            failures.push({ team, stage: 'pr', reason });
            console.log(`  [PR:${team}] FAILED (exit ${e.status}): ${reason.short}`);
          } finally {
            try { unlinkSync(prBodyFile); } catch { /* ignore */ }
            // Return to base + clean working tree for next team
            try {
              execFileSync('git', ['checkout', prBase], { cwd: cosmosRoot, stdio: 'ignore' });
              // Also drop the state.json bump if the commit/push/PR never landed.
              execFileSync('git', ['checkout', '--', ...WRITABLE_PATHS, STATE_REL], { cwd: cosmosRoot, stdio: 'ignore' });
            } catch { /* ignore */ }
          }
        } else if (livePr && out) {
          // The applier finished cleanly but produced nothing we can open a PR
          // from — no report, validator never passed, or an empty diff (e.g.
          // it exhausted its iteration cap). Surface it as a failure instead
          // of silently producing no PR and leaving the team "unreported".
          const why = !out.applier_report
            ? 'applier produced no report (likely hit the iteration cap)'
            : !out.applier_report.validator_passed
              ? 'applier validator did not pass'
              : 'applier produced an empty diff — nothing to open a PR from';
          failures.push({ team, stage: 'applier', reason: { short: why, detail: `iter=${out.iterations}, diff=${out.diff_line_count} line(s)` } });
          console.log(`  [applier:${team}] no PR — ${why} (iter=${out.iterations}, diff=${out.diff_line_count})`);
          const tail = applierStdout.split('\n').filter(Boolean).slice(-40).join('\n');
          if (tail) console.log(`  [applier:${team}] last applier output (diagnostic, --verbose):\n${tail}`);
        }
      } catch (err) {
        const e = err as { status?: number; stderr?: Buffer; stdout?: Buffer };
        const reason = parseAgentError(e.stderr?.toString() ?? e.stdout?.toString() ?? '');
        failures.push({ team, stage: 'applier', reason });
        console.log(`  [applier:${team}] FAILED (exit ${e.status}): ${reason.short}${reason.detail ? ` — ${reason.detail}` : ''}`);
      } finally {
        try { unlinkSync(verdictFile); } catch { /* ignore */ }
        try { unlinkSync(resultFile); } catch { /* ignore */ }
        // Tidy the writable surface after each team (the per-team pre-reset is
        // the real guard; this keeps the tree clean regardless of which branch
        // the PR flow above took). Log anything the reset couldn't clear.
        const leftover = resetWritableSurface();
        if (leftover) console.log(`  [applier:${team}] ⚠ leftover after cleanup:\n${leftover}`);
      }
    }
  } else {
    console.log(`\n⚠ Applier skipped: ${applierSkipReason.split('\n')[0]}`);
  }
}

// ──────────────────────────────────────────────────────────────────
//  Auto-advance no-drift baselines via one self-merging chore PR
//  Repos that changed but produced no Cosmos drift get their baseline moved
//  through a single auto-merged PR (main is ruleset-protected, so we can't
//  push directly). Next run sees baseline == HEAD → UNCHANGED → skips the
//  clone + analysis. One self-merging PR per run, no human action — PR volume
//  stays tied to real drift, not repo activity. Live mode only; dry-runs stay
//  side-effect-free.
// ──────────────────────────────────────────────────────────────────
if (livePr) {
  const advanced = advanceNoDriftBaselines(noDrifts);
  openNoDriftAdvancePR(advanced);
}

// Pick the "worst" confidence across a team's repos for the PR label.
function worstConfidence(items: RepoResult[]): 'high' | 'medium' | 'low' {
  const confs = items.map(r => r.verdict?.confidence ?? 'low');
  if (confs.includes('low')) return 'low';
  if (confs.includes('medium')) return 'medium';
  return 'high';
}

// ──────────────────────────────────────────────────────────────────
//  Build markdown report
// ──────────────────────────────────────────────────────────────────
const md: string[] = [];

md.push('# Cosmos sync — dry-run report');
md.push('');
md.push(`**Run at:** ${new Date().toISOString()}`);
md.push(`**Duration:** ${(totalMs / 1000).toFixed(1)}s`);
md.push(`**Repos processed:** ${results.length}`);
md.push(`**Concurrency:** ${CONCURRENCY}`);
md.push('');
md.push('| Bucket | Count |');
md.push('|---|---|');
md.push(`| 🚨 drift           | ${drifts.length} |`);
md.push(`| ❓ inconclusive    | ${inconclusives.length} |`);
md.push(`| ✅ no_drift        | ${noDrifts.length} |`);
md.push(`| ❌ errors          | ${errors.length} |`);
md.push('');

md.push('---');
md.push('');
md.push('## Per-team summary');
md.push('');
if (byTeam.size === 0) {
  md.push('_No drift detected. No PRs would be opened._');
} else {
  md.push('| Team | Repos with drift | Worst confidence | Reviewers | Slack |');
  md.push('|---|---|---|---|---|');
  for (const [team, items] of byTeam) {
    const owner = (TEAM_OWNERS as Record<string, TeamOwner>)[team] ?? FALLBACK_OWNER;
    md.push(`| \`${team}\` | ${items.length} | ${worstConfidence(items)} | ${owner.githubTeam ?? '—'} | ${owner.slack ?? '—'} |`);
  }
}
md.push('');

md.push('---');
md.push('');
md.push('## PRs that would be opened');
md.push('');

if (byTeam.size === 0) {
  md.push('_None — no drift detected in this run._');
} else {
  for (const [team, items] of byTeam) {
    const owner = (TEAM_OWNERS as Record<string, TeamOwner>)[team] ?? FALLBACK_OWNER;
    const conf = worstConfidence(items);
    const draft = conf === 'low';

    md.push(`### Team: \`${team}\``);
    md.push('');
    md.push('```');
    md.push(`Title:     [cosmos-sync] ${team} domain · ${items.length} service${items.length === 1 ? '' : 's'} drifted`);
    md.push(`Status:    ${draft ? 'Draft' : 'Ready for review'}`);
    md.push(`Reviewers: ${owner.githubTeam ?? 'cosmos-maintainers'}`);
    md.push(`Labels:    cosmos-sync, team:${team}${draft ? ', needs-investigation' : ''}`);
    md.push(`Branch:    cosmos-sync/${team}-${dateStr}`);
    md.push('```');
    md.push('');

    md.push('#### PR body');
    md.push('');
    for (const item of items) {
      const v = item.verdict!;
      const icon = v.verdict === 'drift' ? '🚨' : '❓';
      md.push(`##### ${icon} \`${v.service}\` (${v.verdict}, ${v.confidence ?? '—'})`);
      md.push('');
      md.push(`**Sha range:** \`${v.from_sha.slice(0, 8)}\` → \`${v.to_sha.slice(0, 8)}\``);
      md.push('');
      md.push(`**Summary:** ${v.summary}`);
      md.push('');
      if (v.changes && v.changes.length > 0) {
        md.push('**Changes:**');
        md.push('');
        for (const c of v.changes) {
          md.push(`- **${c.kind}** — ${c.description}`);
          if (c.evidence?.length) {
            for (const e of c.evidence.slice(0, 4)) {
              md.push(`  - ${e}`);
            }
            if (c.evidence.length > 4) md.push(`  - …${c.evidence.length - 4} more`);
          }
          if (c.proposed_cosmos_edits?.length) {
            md.push('  - **Proposed edits:**');
            for (const e of c.proposed_cosmos_edits) {
              md.push(`    - \`${e.file}\` — ${e.rationale}`);
              if (e.patch_hint) {
                const hint = e.patch_hint.length > 200 ? e.patch_hint.slice(0, 200) + '…' : e.patch_hint;
                md.push(`      \`${hint}\``);
              }
            }
          }
        }
        md.push('');
      }
    }

    // Proposed Cosmos diff (from applier)
    const ap = applierResults.get(team);
    if (ap) {
      md.push('#### Proposed Cosmos diff');
      md.push('');
      md.push(`- **Applied:** ${ap.applier_report?.applied?.length ?? '?'} edit(s)`);
      md.push(`- **Skipped:** ${ap.applier_report?.skipped?.length ?? 0}`);
      md.push(`- **Validator passed:** ${ap.applier_report?.validator_passed ? '✅ yes' : '❌ no'}`);
      md.push(`- **Iterations:** ${ap.iterations}`);
      if (ap.applier_report?.summary) {
        md.push(`- **Applier summary:** ${ap.applier_report.summary}`);
      }
      md.push('');
      if (ap.applier_report?.skipped && ap.applier_report.skipped.length > 0) {
        md.push('**Skipped edits:**');
        for (const s of ap.applier_report.skipped) {
          md.push(`- \`${s.verdict_service}\`: ${s.reason}`);
        }
        md.push('');
      }
      if (ap.diff && ap.diff.trim().length > 0) {
        md.push('```diff');
        const diffLines = ap.diff.split('\n');
        if (diffLines.length > 400) {
          md.push(diffLines.slice(0, 400).join('\n'));
          md.push(`…[${diffLines.length - 400} more lines]`);
        } else {
          md.push(ap.diff);
        }
        md.push('```');
      } else {
        md.push('_(applier produced no diff)_');
      }
      md.push('');
    } else if (applierSkipReason) {
      md.push('#### Proposed Cosmos diff');
      md.push('');
      md.push(`_Applier skipped — ${applierSkipReason.split('\n')[0]}_`);
      md.push('');
    }

    // Show PR URL if live mode opened one
    const apResult = applierResults.get(team);
    if (apResult?.pr_url) {
      md.push(`#### 🔗 PR opened`);
      md.push('');
      md.push(`**URL:** ${apResult.pr_url}`);
      md.push('');
    }

    md.push('#### Slack message');
    md.push('');
    md.push('```');
    const icon = conf === 'low' ? ':rotating_light:' : conf === 'medium' ? ':warning:' : ':white_check_mark:';
    const action = conf === 'low' ? 'NEEDS INVESTIGATION' : conf === 'medium' ? 'needs review' : 'ready for review';
    md.push(`${icon} cosmos-sync · ${team}`);
    md.push(`${items.length} service${items.length === 1 ? '' : 's'} drifted: ${items.map(r => r.repo).join(', ')}`);
    md.push(`PR — ${action} (${owner.githubTeam ?? 'maintainers'})`);
    md.push(`Would post to: ${owner.slack ?? '(no channel configured)'}`);
    md.push('```');
    md.push('');
    md.push('---');
    md.push('');
  }
}

md.push('## All verdicts (appendix)');
md.push('');
md.push('| Repo | Verdict | Confidence | Changes | Duration |');
md.push('|---|---|---|---|---|');
for (const r of results) {
  if (r.ok && r.verdict) {
    const icon = r.verdict.verdict === 'drift' ? '🚨' : r.verdict.verdict === 'no_drift' ? '✅' : '❓';
    md.push(`| \`${r.repo}\` | ${icon} ${r.verdict.verdict} | ${r.verdict.confidence ?? '—'} | ${r.verdict.changes?.length ?? 0} | ${(r.durationMs / 1000).toFixed(1)}s |`);
  } else {
    md.push(`| \`${r.repo}\` | ❌ error | — | — | ${(r.durationMs / 1000).toFixed(1)}s |`);
  }
}
md.push('');

if (errors.length > 0) {
  md.push('## Errors');
  md.push('');
  for (const e of errors) {
    md.push(`### \`${e.repo}\``);
    md.push('```');
    md.push(e.error ?? '(no error message)');
    md.push('```');
    md.push('');
  }
}

writeFileSync(outFile, md.join('\n'));

// Also emit a styled HTML version of the report — cosmos-themed,
// self-contained, opens in any browser without a build step.
const htmlFile = outFile.replace(/\.md$/, '.html');
const htmlReport = buildHtmlReport({
  runAt: new Date().toISOString(),
  durationMs: totalMs,
  concurrency: CONCURRENCY,
  results,
  byTeam,
  applierResults,
  applierSkipReason,
});
writeFileSync(htmlFile, htmlReport);

// ──────────────────────────────────────────────────────────────────
//  Console summary
// ──────────────────────────────────────────────────────────────────
console.log('\n═══ Summary ═══');
console.log(`  drift:        ${drifts.length}`);
console.log(`  inconclusive: ${inconclusives.length}`);
console.log(`  no_drift:     ${noDrifts.length}`);
console.log(`  errors:       ${errors.length}`);
console.log(`  total:        ${results.length}  (${(totalMs / 1000).toFixed(1)}s)`);
if (byTeam.size > 0) {
  console.log('\n  Teams with drift:');
  for (const [team, items] of byTeam) {
    console.log(`    ${team.padEnd(12)} ${items.length} repo${items.length === 1 ? '' : 's'}`);
  }
}
console.log(`\n✓ Report written to: ${outFile}`);
console.log(`✓ HTML report:       ${htmlFile}`);

// ──────────────────────────────────────────────────────────────────
//  Nightly run-level Slack signal
//  Per-team drift PRs already posted their own Slack messages above.
//  Here we post exactly one run-level signal so the channel is never
//  silently dark:
//    • degraded  — any applier/PR failure or diff-repo error
//                  (incl. drift detected but no PR could be opened)
//    • all-clear — zero drift, zero errors, zero failures
// ──────────────────────────────────────────────────────────────────
if (livePr) {
  if (failures.length > 0 || errors.length > 0) {
    // Teams that drifted but never got a PR (no pr_url) — surface them so
    // maintainers know the drift is unreported until the run is re-run.
    const unreportedDriftTeams = [...byTeam.keys()].filter(t => !applierResults.get(t)?.pr_url);
    const fr = await postFailure(failures, errors, unreportedDriftTeams);
    if (fr.posted) console.log('  [slack:cosmos] failure summary posted');
    else console.log(`  [slack:cosmos] failure summary skipped — ${fr.reason}`);
  } else if (byTeam.size === 0) {
    const ac = await postAllClear(results.length, inconclusives.length, totalMs);
    if (ac.posted) console.log('  [slack:cosmos] all-clear posted');
    else console.log(`  [slack:cosmos] all-clear skipped — ${ac.reason}`);
  }
}

// ──────────────────────────────────────────────────────────────────
//  GitHub Actions step summary
//  Writes a condensed report into the workflow run's "Summary" panel
//  so reviewers don't have to dig through logs or download artifacts.
//  Only writes when GITHUB_STEP_SUMMARY is set (i.e., when in CI).
// ──────────────────────────────────────────────────────────────────
if (process.env.GITHUB_STEP_SUMMARY) {
  const sum: string[] = [];
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

  sum.push(`## 🌌 Cosmos Sync · ${dateStr}`);
  sum.push('');
  sum.push(`**Duration:** ${(totalMs / 1000).toFixed(1)}s · **Repos:** ${results.length} · **Concurrency:** ${CONCURRENCY}`);
  sum.push('');
  sum.push('| Bucket | Count |');
  sum.push('|---|---|');
  sum.push(`| 🚨 drift | **${drifts.length}** |`);
  sum.push(`| ❓ inconclusive | ${inconclusives.length} |`);
  sum.push(`| ✅ no_drift | ${noDrifts.length} |`);
  sum.push(`| ❌ errors | ${errors.length} |`);
  sum.push('');

  if (byTeam.size === 0) {
    sum.push('### ✅ Cosmos is in sync');
    sum.push('');
    sum.push('Every tracked repo is at its baseline. No PRs were opened.');
  } else {
    sum.push('### 🚨 Drift detected');
    sum.push('');
    sum.push('| Team | Services | PR |');
    sum.push('|---|---|---|');
    for (const [team, items] of byTeam) {
      const ap = applierResults.get(team);
      const services = items.map(r => `\`${r.repo}\``).join(', ');
      const prCell = ap?.pr_url ? `[#${ap.pr_url.split('/').pop()}](${ap.pr_url})` : '_pending_';
      sum.push(`| \`${team}\` | ${services} | ${prCell} |`);
    }
    sum.push('');
    for (const [team, items] of byTeam) {
      sum.push(`<details><summary><b>${team}</b> · ${items.length} drift${items.length === 1 ? '' : 's'}</summary>`);
      sum.push('');
      for (const item of items) {
        const v = item.verdict!;
        sum.push(`- **\`${v.service}\`** _(${v.verdict}, ${v.confidence ?? '—'})_ — ${v.summary}`);
      }
      sum.push('');
      sum.push('</details>');
      sum.push('');
    }
  }

  if (errors.length > 0) {
    sum.push('### ❌ Errors');
    sum.push('');
    for (const e of errors) {
      sum.push(`- \`${e.repo}\` — ${(e.error ?? '').slice(0, 200)}`);
    }
    sum.push('');
  }

  // ── Claude usage & estimated cost ──────────────────────────────────
  // Aggregate token counts from every diff-repo verdict + every applier
  // subprocess output. Cost is an estimate using the current published
  // Sonnet/Opus/Haiku rates (see lib/agent.ts MODEL_PRICING).
  const allUsages = [
    ...results.map(r => (r.verdict as unknown as { _usage?: AgentUsage })?._usage),
    ...[...applierResults.values()].map(a => a.usage),
  ];
  const totalUsage = sumUsage(...allUsages);
  // Pick the dominant model id (most agents share one — fall back to sonnet).
  const modelId =
    [...applierResults.values()].find(a => a.model)?.model ??
    (results.find(r => (r.verdict as unknown as { _model?: string })?._model) as { verdict?: { _model?: string } } | undefined)?.verdict?._model ??
    'claude-sonnet-4-6';
  const cost = estimateCost(totalUsage, modelId);
  const totalTokens = totalUsage.input_tokens + totalUsage.output_tokens + totalUsage.cache_creation_input_tokens + totalUsage.cache_read_input_tokens;
  if (totalTokens > 0) {
    sum.push('### 💸 API usage');
    sum.push('');
    sum.push(`**Est. cost this run:** \`$${cost.toFixed(4)}\` · **Model:** \`${modelId}\``);
    sum.push('');
    sum.push('| Direction | Tokens |');
    sum.push('|---|---:|');
    sum.push(`| Input | ${totalUsage.input_tokens.toLocaleString()} |`);
    sum.push(`| Output | ${totalUsage.output_tokens.toLocaleString()} |`);
    if (totalUsage.cache_read_input_tokens > 0) sum.push(`| Cache read | ${totalUsage.cache_read_input_tokens.toLocaleString()} |`);
    if (totalUsage.cache_creation_input_tokens > 0) sum.push(`| Cache write | ${totalUsage.cache_creation_input_tokens.toLocaleString()} |`);
    sum.push('');
  }

  sum.push('---');
  sum.push('');
  sum.push('📄 Full reports: download the **`cosmos-sync-dry-run-<run-id>`** artifact above — contains both `.md` and a cosmos-themed `.html`.');
  if (runUrl) {
    sum.push('');
    sum.push(`🔗 [Run page](${runUrl})`);
  }
  sum.push('');

  appendFileSync(process.env.GITHUB_STEP_SUMMARY, sum.join('\n') + '\n');
}
