#!/usr/bin/env -S npx tsx
/**
 * Cosmos drift-sync agent — diff-repo mode (Phase 1)
 *
 * Given a source repo, compares its baseline sha (from drift-sync/state.json)
 * against the current origin HEAD. Runs the prefilter; if any cosmos-relevant
 * changes are present, invokes Claude with the diff + the Cosmos slice for
 * that repo. Outputs a structured verdict.
 *
 * Usage:
 *   npm run sync:diff-repo -- <repo>                          # auto from baseline → origin
 *   npm run sync:diff-repo -- <repo> --from <sha> --to <sha>  # explicit range
 *   npm run sync:diff-repo -- <repo> --json                   # JSON-only output
 *   npm run sync:diff-repo -- <repo> --verbose                # show every turn + tool call
 *
 * Env:
 *   ANTHROPIC_API_KEY (or VITE_ANTHROPIC_API_KEY) — required
 */

import * as path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { loadEnv } from './lib/agent.js';
loadEnv();

import { runAgent, extractJsonReport } from './lib/agent.js';
import {
  loadSyncState, fetchOriginBranch, getOriginHeadSha,
  getChangedFiles, getDiffStat, getCommitCount,
  getDiffUnifiedZero, getDiffFull, truncateDiff,
} from './lib/git.js';
import { prefilterDecision } from './lib/prefilter.js';
import { buildRepoSlice, formatSliceForPrompt } from './lib/cosmos-context.js';
import { loadDriftSyncConfig, topicRegistryLocalPath } from './lib/config.js';
import { fileURLToPath } from 'node:url';

const config = loadDriftSyncConfig();

// ──────────────────────────────────────────────────────────────────
//  Args
// ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const repo = args[0];
const fromIdx = args.indexOf('--from');
const toIdx = args.indexOf('--to');
const reposRootIdx = args.indexOf('--repos-root');
const modelIdx = args.indexOf('--model');
const maxIterIdx = args.indexOf('--max-iterations');
const jsonOnly = args.includes('--json');
const verbose = args.includes('--verbose');

const reposRoot = reposRootIdx >= 0
  ? args[reposRootIdx + 1]
  : config.reposRoot;
const model = modelIdx >= 0 ? args[modelIdx + 1] : 'claude-sonnet-4-6';
const maxIter = maxIterIdx >= 0 ? Number(args[maxIterIdx + 1]) : 30;
let explicitFrom = fromIdx >= 0 ? args[fromIdx + 1] : undefined;
let explicitTo = toIdx >= 0 ? args[toIdx + 1] : undefined;

if (!repo || repo.startsWith('--')) {
  console.error('Usage: npm run sync:diff-repo -- <repo> [--from <sha>] [--to <sha>] [--json] [--verbose]');
  process.exit(1);
}

const log = (msg: string) => { if (!jsonOnly) console.log(msg); };
const elog = (msg: string) => console.error(msg);

// ──────────────────────────────────────────────────────────────────
//  Resolve sha range
// ──────────────────────────────────────────────────────────────────
const here = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(here, '..', 'state.json');
const state = loadSyncState(statePath);
if (!state && (!explicitFrom || !explicitTo)) {
  elog(`No drift-sync/state.json found at ${statePath}. Run \`npm run sync:bootstrap\` first, or pass --from/--to explicitly.`);
  process.exit(1);
}

const repoPath = path.join(reposRoot, repo);
const entry = state?.repos?.[repo];
const branch = entry?.branch ?? config.defaultBranch;

if (!existsSync(repoPath)) {
  // The clone step deliberately skips repos whose remote HEAD already
  // matches the baseline — and records that in .clone-status.json. Only
  // that recorded 'unchanged' justifies a synthetic no_drift; a missing
  // dir for any other reason (clone FAILED on a dead token, never ran)
  // must surface as an error, not a silent all-clear.
  let cloneStatus: string | undefined;
  try {
    const statusFile = JSON.parse(readFileSync(path.join(reposRoot, '.clone-status.json'), 'utf8')) as Record<string, string>;
    cloneStatus = statusFile[repo];
  } catch { /* no manifest — clone step didn't run */ }

  if (cloneStatus === 'unchanged' && entry?.sha && !explicitFrom && !explicitTo) {
    log(`\n  ✓ repo not cloned (remote HEAD matched baseline at clone time) — emitting no_drift.`);
    if (jsonOnly) {
      console.log(JSON.stringify({
        verdict: 'no_drift', confidence: 'high', service: repo,
        from_sha: entry.sha, to_sha: entry.sha, changes: [],
        summary: 'No changes — remote HEAD matched baseline; clone skipped.',
      }));
    }
    process.exit(0);
  }
  elog(`Repo not found locally: ${repoPath}${cloneStatus ? ` (clone status: ${cloneStatus})` : ''}`);
  process.exit(1);
}

// --from and --to are independent: each defaults if omitted.
//   --from defaults to the state-file baseline for this repo.
//   --to defaults to current origin/<branch> HEAD (after fetch).
let fromSha: string;
let toSha: string;

if (explicitFrom) {
  fromSha = explicitFrom;
} else {
  if (!entry || !entry.sha) {
    elog(`Repo "${repo}" has no baseline sha in state file. Pass --from explicitly or re-bootstrap.`);
    process.exit(1);
  }
  fromSha = entry.sha;
}

if (explicitTo) {
  toSha = explicitTo;
} else {
  fetchOriginBranch(repoPath, branch);
  toSha = getOriginHeadSha(repoPath, branch);
}

log(`\n═══ diff-repo: ${repo} ═══`);
log(`  branch:  ${branch}`);
log(`  from:    ${fromSha.slice(0, 12)}`);
log(`  to:      ${toSha.slice(0, 12)}`);

if (fromSha === toSha) {
  log(`\n  ✓ no changes — repo is at baseline.`);
  if (jsonOnly) {
    console.log(JSON.stringify({
      verdict: 'no_drift', confidence: 'high', service: repo, from_sha: fromSha, to_sha: toSha,
      changes: [], summary: 'No changes — repo is at baseline.',
    }));
  }
  process.exit(0);
}

// ──────────────────────────────────────────────────────────────────
//  Prefilter
// ──────────────────────────────────────────────────────────────────
const changedFiles = getChangedFiles(repoPath, fromSha, toSha);
const commitCount = getCommitCount(repoPath, fromSha, toSha);
log(`  commits: ${commitCount}  files changed: ${changedFiles.length}`);

// Quick exit if nothing changed (shouldn't happen since shas differ, but safe).
if (changedFiles.length === 0) {
  log(`  ✓ no files changed (shas differ but tree identical?).`);
  if (jsonOnly) {
    console.log(JSON.stringify({
      verdict: 'no_drift', confidence: 'high', service: repo, from_sha: fromSha, to_sha: toSha,
      changes: [], summary: 'No file changes — shas differ but tree is identical.',
    }));
  }
  process.exit(0);
}

// Apply path filter then content filter.
const diffUnifiedZero = getDiffUnifiedZero(repoPath, fromSha, toSha, changedFiles.filter(f => {
  // Pre-filter at git level to reduce noise — only request diffs for files
  // that pass the path filter. (Same filter is applied inside prefilterDecision.)
  return true; // path filter happens inside prefilterDecision; we pass everything here for the diff
}));
const decision = prefilterDecision(changedFiles, diffUnifiedZero);

if (decision.skip) {
  log(`  ✓ prefilter skip: ${decision.reason}`);
  if (jsonOnly) {
    console.log(JSON.stringify({
      verdict: 'no_drift', confidence: 'high', service: repo, from_sha: fromSha, to_sha: toSha,
      changes: [],
      summary: `Prefilter skip — ${decision.reason}.`,
    }));
  }
  process.exit(0);
}

log(`  ↳ ${decision.files.length} cosmos-relevant files, ${decision.contentHits.length} content hits`);

// ──────────────────────────────────────────────────────────────────
//  Build the Cosmos slice + diff payload
// ──────────────────────────────────────────────────────────────────
const slice = buildRepoSlice(repo);
const sliceText = formatSliceForPrompt(slice);

if (slice.services.length === 0) {
  log(`  ⚠ this repo is not referenced by any Cosmos service. Skipping agent.`);
  if (jsonOnly) {
    console.log(JSON.stringify({
      verdict: 'inconclusive', confidence: 'low', service: repo, from_sha: fromSha, to_sha: toSha,
      changes: [], summary: 'Repo is not referenced by any Cosmos service.',
    }));
  }
  process.exit(0);
}

const stat = getDiffStat(repoPath, fromSha, toSha);
const fullDiff = getDiffFull(repoPath, fromSha, toSha, decision.files);
const { diff: diffForPrompt, truncated, originalLines } = truncateDiff(fullDiff, 800);

log(`  ↳ diff: ${originalLines} lines${truncated ? ' (truncated to 800)' : ''}`);

// ──────────────────────────────────────────────────────────────────
//  Prompts
// ──────────────────────────────────────────────────────────────────
const registryPath = topicRegistryLocalPath(config);
const registrySection = config.topicRegistry
  ? `
## Authoritative source of truth
The Kafka topic registry at ${registryPath} lists every topic that exists in production${config.topicRegistry.topicPrefix ? ` (prefixed with '${config.topicRegistry.topicPrefix}')` : ''}. Treat this as canonical for topic existence and naming.
`
  : '';

const systemPrompt = `You are a drift-detection agent for Cosmos — your architecture map: a visualization of the services, Kafka topics, and event flows across your organization's platform.

Source repos live at ${reposRoot}/<repo-name>/. The relevant slice of the Cosmos map (services, steps, topics for this repo) is provided below — you do not need to read the map's own repository.
${registrySection}
## Your job
A source repo has changed between two shas. You will be given the diff (filtered to cosmos-relevant files) plus the slice of Cosmos that depends on this repo. Determine whether any of the changes would invalidate or extend Cosmos.

Look specifically for:
1. **Topic identity drift**: renamed/added/removed Kafka topics
2. **Producer/consumer flow drift**: new \`@EventPattern\` / new \`kafkaService.produce\` calls / removed handlers
3. **HTTP route drift**: route handlers added/removed that match a Cosmos step's described endpoint
4. **Payload shape drift**: event payload class fields changed in ways that would invalidate Cosmos's step.payload examples
5. **Service identity drift**: service moved/renamed; tech stack changed; service no longer exists

## Investigation strategy
- Aim for ≤8 tool calls.
- Some services reference event/topic classes from shared internal npm packages that are NOT in the workspace. The literal topic strings live in node_modules — DO NOT search for them. Instead: rely on the topic registry (when available) + matching class names in producer/consumer source.
- For env-var topic names (e.g. KAFKA_*_TOPIC), read the relevant env setup scripts / \`*.env.yaml\` / helm \`values.yaml\` to resolve the actual topic name in production.
- Use \`read_file\` / \`grep\` / \`list_dir\` to dig further when the diff alone is ambiguous.

## Calibration (IMPORTANT)
Bias toward \`inconclusive\` when evidence is incomplete. Reserve \`drift\` + \`confidence: high\` for cases where you can quote a specific file:line that proves the drift. Reserve deletions of Cosmos elements for \`confidence: high\` only — when in doubt, propose an edit/add, not a delete.

## Output
Output ONE JSON object in a single markdown code block tagged 'json'. Schema:
{
  "verdict": "drift" | "no_drift" | "inconclusive",
  "confidence": "high" | "medium" | "low",
  "service": "<repo>",
  "team": "<team or 'unknown'>",
  "from_sha": "<short sha>",
  "to_sha": "<short sha>",
  "changes": [
    {
      "kind": "topic_renamed" | "topic_added" | "topic_removed"
            | "producer_added" | "producer_removed"
            | "consumer_added" | "consumer_removed"
            | "route_added" | "route_removed" | "route_renamed"
            | "payload_changed"
            | "service_removed" | "service_renamed"
            | "other",
      "description": "...",
      "evidence": ["repo/path/to/file.ts:NN — quoted line or summary"],
      "proposed_cosmos_edits": [
        {
          "file": "src/scenarios/topics.ts",
          "rationale": "...",
          "patch_hint": "rename Topic.name 'X' → 'Y'"
        }
      ]
    }
  ],
  "summary": "1-2 sentences for a human reviewer"
}

If no drift, return verdict=no_drift, changes=[], and a 1-line summary explaining what you confirmed unchanged.`;

const userPrompt = `# Repo: ${repo}
# Sha range: ${fromSha} → ${toSha}
# Commits: ${commitCount}
# Files changed (filtered to cosmos-relevant): ${decision.files.length}

${sliceText}

## git diff --stat (full)
${stat}

## Content prefilter hits (changed lines matching cosmos patterns)
${decision.contentHits.slice(0, 30).join('\n')}${decision.contentHits.length > 30 ? `\n…[${decision.contentHits.length - 30} more]` : ''}

## Diff (unified=3, cosmos-relevant files only${truncated ? ', truncated to 800 lines' : ''})

\`\`\`diff
${diffForPrompt}
\`\`\`

Investigate and produce a verdict.`;

// ──────────────────────────────────────────────────────────────────
//  Run the agent
// ──────────────────────────────────────────────────────────────────
log('');
log(`  ↳ invoking Claude (${model}, max ${maxIter} iterations)...`);
log('');

const result = await runAgent({
  systemPrompt,
  userPrompt,
  model,
  maxIter,
  reposRoot,
  verbose,
});

if (!result.finalText) {
  elog(`\nAgent did not finish (${result.stoppedReason}) after ${result.iterations} iterations.`);
  process.exit(2);
}

const report = extractJsonReport<Record<string, unknown>>(result.finalText);
if (!report) {
  elog('\nAgent returned no JSON report. Raw text:');
  elog(result.finalText);
  process.exit(3);
}

// Decorate with metadata we know for sure (don't trust the agent to echo correctly).
report.service = repo;
report.from_sha = fromSha;
report.to_sha = toSha;
if (!report.team && slice.teams.length === 1) report.team = slice.teams[0].team;

// Attach token usage so the orchestrator can aggregate cost across all
// subprocess invocations. Underscored field so it doesn't conflict with
// the Verdict schema.
report._usage = result.usage;
report._model = result.model;

if (jsonOnly) {
  console.log(JSON.stringify(report));
} else {
  console.log(`\n═══ Verdict for ${repo} ═══`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`\n(${result.iterations} iterations)`);
}
