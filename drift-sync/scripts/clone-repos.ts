#!/usr/bin/env -S npx tsx
/**
 * Clone every Cosmos-referenced repo into the configured workspace root
 * if it isn't already present. Used by the GitHub Actions runner before
 * sync:nightly, since the runner doesn't have the workspace pre-populated.
 *
 * Reads the list of repos from drift-sync/state.json (so we don't have
 * to maintain a second list). Skips repos marked `skipped` (e.g.
 * repos flagged not_in_workspace).
 *
 * Usage:
 *   npm run sync:clone-repos                            # clone to configured root
 *   REPOS_ROOT=/tmp/source-repos npm run sync:clone-repos
 *
 * Config (drift-sync/config.json or env — see lib/config.ts):
 *   githubOrg / GITHUB_ORG — org the source repos live under (required)
 *   reposRoot / REPOS_ROOT — where to clone them
 *   topicRegistry          — optional single-file Kafka topic registry to fetch
 *
 * Auth:
 *   Uses GH_TOKEN if set (workflow environment) for private repos.
 *   Otherwise relies on existing git credentials.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDriftSyncConfig } from './lib/config.js';

const config = loadDriftSyncConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
const reposRoot = config.reposRoot;
const ghOrg = config.githubOrg;
const ghToken = process.env.GH_TOKEN ?? '';

if (!ghOrg) {
  console.error('No GitHub org configured. Set "githubOrg" in drift-sync/config.json or the GITHUB_ORG env var.');
  process.exit(1);
}

interface SyncStateEntry {
  sha?: string; branch?: string; skipped?: string;
}
interface SyncState {
  repos: Record<string, SyncStateEntry>;
}

const statePath = path.resolve(here, '..', 'state.json');
if (!existsSync(statePath)) {
  console.error('No drift-sync/state.json found.');
  process.exit(1);
}
const state = JSON.parse(readFileSync(statePath, 'utf8')) as SyncState;

console.log(`Cloning Cosmos-referenced repos into ${reposRoot}`);
console.log(`  GH org: ${ghOrg}`);
console.log(`  Token:  ${ghToken ? '(set)' : '(not set — using existing git credentials)'}`);
console.log('');

let cloned = 0;
let skipped = 0;
let unchanged = 0;
let already = 0;
let failed = 0;

// Per-repo clone outcome, written to <reposRoot>/.clone-status.json.
// diff-repo reads this so a FAILED clone surfaces as an error instead of
// being mistaken for "unchanged, clone skipped" (which once turned a dead
// PAT into a week of silent no_drift all-clears).
const cloneStatus: Record<string, 'cloned' | 'unchanged' | 'already' | 'failed' | 'skipped'> = {};

/**
 * Query the current HEAD SHA of a remote branch via `gh api`.
 *
 * We deliberately avoid `git ls-remote` here because on GitHub-hosted
 * runners, actions/checkout configures a credential helper that strips
 * URL-embedded credentials — ls-remote then returns "Repository not
 * found" even though the PAT is valid. `gh api` reads GH_TOKEN directly
 * and is reliable in both CI and local environments.
 */
function getRemoteHead(repo: string, branch: string): string | null {
  try {
    const out = execFileSync(
      'gh',
      ['api', `repos/${ghOrg}/${repo}/commits/${branch}`, '--jq', '.sha'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const sha = out.trim();
    return sha || null;
  } catch (err) {
    if (process.env.DEBUG_CLONE) {
      const e = err as { stderr?: Buffer; message?: string };
      console.log(`    (debug ${repo}: gh api threw: ${e.stderr?.toString().slice(0, 200) ?? e.message})`);
    }
    return null;
  }
}

for (const [repo, entry] of Object.entries(state.repos)) {
  if (entry.skipped) {
    console.log(`  SKIP      ${repo}  (${entry.skipped})`);
    skipped++;
    cloneStatus[repo] = 'skipped';
    continue;
  }
  const dir = path.join(reposRoot, repo);
  if (existsSync(dir)) {
    console.log(`  ALREADY   ${repo}`);
    already++;
    cloneStatus[repo] = 'already';
    continue;
  }

  // OPTIMIZATION: ask the remote what its HEAD is BEFORE cloning. If the
  // baseline matches, the repo has not drifted since the last bootstrap —
  // there is no diff to investigate and no need to spend ~2-5s cloning it.
  // diff-repo.ts handles the "repo not present + baseline still valid"
  // case by treating it as a synthetic no_drift.
  if (entry.sha && entry.branch) {
    const remoteSha = getRemoteHead(repo, entry.branch);
    if (remoteSha && remoteSha === entry.sha) {
      console.log(`  UNCHANGED ${repo}  (${remoteSha.slice(0, 8)})`);
      unchanged++;
      cloneStatus[repo] = 'unchanged';
      continue;
    }
  }

  const url = ghToken
    ? `https://x-access-token:${ghToken}@github.com/${ghOrg}/${repo}.git`
    : `https://github.com/${ghOrg}/${repo}.git`;
  try {
    // Shallow clone of the TRACKED branch — not necessarily the repo default.
    // --branch ensures `origin/<branch>` exists for diff-repo even when we
    // track a non-default branch (e.g. `main` on a develop-default repo);
    // depth=200 is enough for typical baselines.
    execFileSync('git', ['clone', '--depth=200', '--no-tags', '--branch', entry.branch ?? config.defaultBranch, url, dir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`  CLONE     ${repo}`);
    cloned++;
    cloneStatus[repo] = 'cloned';
  } catch (err) {
    const e = err as { stderr?: Buffer };
    console.log(`  FAIL      ${repo}  ${(e.stderr?.toString() ?? String(err)).slice(0, 200)}`);
    failed++;
    cloneStatus[repo] = 'failed';
  }
}

// Optionally fetch the Kafka topic registry (config.topicRegistry) — a single
// authoritative file listing every topic that exists in production. Infra
// repos tend to be huge and change constantly (pure infra, not drift-watched),
// and we only ever read this ONE file — so fetch just the file rather than
// cloning the whole repo. Keeps the agent's authoritative topic-name check
// without an every-run clone.
if (config.topicRegistry) {
  const { repo: infraRepo, path: registryRelPath } = config.topicRegistry;
  const registryDest = path.join(reposRoot, infraRepo, registryRelPath);
  if (!existsSync(registryDest)) {
    try {
      const raw = execFileSync('gh', [
        'api', `repos/${ghOrg}/${infraRepo}/contents/${registryRelPath}`,
        '-H', 'Accept: application/vnd.github.raw',
      ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      mkdirSync(path.dirname(registryDest), { recursive: true });
      writeFileSync(registryDest, raw);
      console.log(`  FETCH  ${infraRepo} topic registry (single file — no clone)`);
    } catch (err) {
      const e = err as { stderr?: Buffer };
      console.log(`  FAIL   ${infraRepo} registry fetch — agents will skip registry checks  ${(e.stderr?.toString() ?? String(err)).slice(-120)}`);
      failed++;
    }
  }
}

mkdirSync(reposRoot, { recursive: true });
writeFileSync(path.join(reposRoot, '.clone-status.json'), JSON.stringify(cloneStatus, null, 2));

console.log('');
console.log(`  cloned:    ${cloned}`);
console.log(`  unchanged: ${unchanged}  (HEAD == baseline; no clone needed)`);
console.log(`  already:   ${already}`);
console.log(`  skipped:   ${skipped}`);
console.log(`  failed:    ${failed}`);

// Every repo failed and nothing was confirmed unchanged → auth is dead
// (expired PAT, revoked token). Fail LOUDLY so the workflow goes red
// instead of the diff agents emitting synthetic no_drift for everything.
if (failed > 0 && cloned === 0 && unchanged === 0 && already === 0) {
  console.error('\n✗ All clones failed and no repo could be verified — check GH_TOKEN / COSMOS_SYNC_PAT.');
  process.exit(1);
}
