#!/usr/bin/env -S npx tsx
/**
 * Bootstrap drift-sync/state.json
 *
 * Iterates every repo referenced by Cosmos (Service.repo + SubService.repo),
 * fetches origin, fast-forwards if safe (clean + on main), and records the
 * origin/main HEAD sha as the baseline. The recorded sha is always
 * origin/<main-branch> — independent of local working state — so the
 * baseline is consistent regardless of in-progress work on disk.
 *
 * Usage:
 *   npm run sync:bootstrap
 *   npm run sync:bootstrap -- --dry-run   # don't write the state file
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICES } from '../../src/scenarios/services.js';
import { loadDriftSyncConfig } from './lib/config.js';

const config = loadDriftSyncConfig();
const REPOS_ROOT = config.reposRoot;
const dryRun = process.argv.includes('--dry-run');

const here = path.dirname(fileURLToPath(import.meta.url));
const driftSyncRoot = path.resolve(here, '..');
const statePath = path.join(driftSyncRoot, 'state.json');
const confirmedPath = path.join(driftSyncRoot, 'cosmos-confirmed.json');

// Load workspace-exemption list so we can skip repos that aren't expected
// to be on disk (e.g., platform-cloud-session-allocator).
const notInWorkspace = new Set<string>();
if (existsSync(confirmedPath)) {
  const data = JSON.parse(readFileSync(confirmedPath, 'utf8')) as {
    repos_not_in_workspace?: string[];
  };
  for (const r of data.repos_not_in_workspace ?? []) notInWorkspace.add(r);
}

// Enumerate every repo referenced by Cosmos.
const repos = new Set<string>();
for (const svc of SERVICES) {
  if (svc.repo) repos.add(svc.repo);
  for (const sub of svc.subServices ?? []) {
    if (sub.repo) repos.add(sub.repo);
  }
}

interface RepoState {
  sha: string;
  branch: string;
  bootstrap_at: string;
  pulled?: boolean;
  was_dirty?: boolean;
  off_main?: string;
  skipped?: string;
}

const state = {
  version: 1,
  bootstrap_at: new Date().toISOString(),
  repos: {} as Record<string, RepoState>,
};

function sh(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function detectMainBranch(dir: string): string {
  // Prefer the configured default branch (the branch that represents
  // production truth) over the repo's GitHub default branch — some repos
  // default to develop while production tracks main.
  for (const candidate of [...new Set([config.defaultBranch, 'main', 'master'])]) {
    try {
      execFileSync('git', ['rev-parse', '--verify', `origin/${candidate}`], { cwd: dir, stdio: 'ignore' });
      return candidate;
    } catch { /* try next */ }
  }
  try {
    const ref = sh(['symbolic-ref', 'refs/remotes/origin/HEAD'], dir);
    return ref.replace('refs/remotes/origin/', '');
  } catch {
    throw new Error(`Could not detect main branch (no origin/${config.defaultBranch}, origin/main, or origin/master)`);
  }
}

const now = new Date().toISOString();
const sorted = [...repos].sort();
const padW = Math.max(...sorted.map(r => r.length));

for (const repo of sorted) {
  process.stdout.write(`▸ ${repo.padEnd(padW)}  `);

  if (notInWorkspace.has(repo)) {
    state.repos[repo] = { sha: '', branch: '', bootstrap_at: now, skipped: 'not_in_workspace' };
    console.log('SKIP (not in workspace)');
    continue;
  }

  const dir = path.join(REPOS_ROOT, repo);
  if (!existsSync(dir)) {
    state.repos[repo] = { sha: '', branch: '', bootstrap_at: now, skipped: 'missing_directory' };
    console.log('MISS (directory not found)');
    continue;
  }

  try {
    const mainBranch = detectMainBranch(dir);
    execFileSync('git', ['fetch', 'origin', mainBranch], { cwd: dir, stdio: 'ignore' });

    const currentBranch = sh(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
    const dirty = sh(['status', '--porcelain'], dir).length > 0;

    let pulled = false;
    if (currentBranch === mainBranch && !dirty) {
      execFileSync('git', ['pull', '--ff-only', 'origin', mainBranch], { cwd: dir, stdio: 'ignore' });
      pulled = true;
    }

    const sha = sh(['rev-parse', `origin/${mainBranch}`], dir);

    const entry: RepoState = { sha, branch: mainBranch, bootstrap_at: now };
    if (pulled) entry.pulled = true;
    if (dirty) entry.was_dirty = true;
    if (currentBranch !== mainBranch) entry.off_main = currentBranch;
    state.repos[repo] = entry;

    let status = sha.slice(0, 8);
    if (pulled) status += '  (pulled)';
    else if (dirty) status += '  (dirty — recorded origin only)';
    else if (currentBranch !== mainBranch) status += `  (on ${currentBranch} — recorded origin only)`;
    console.log(status);
  } catch (err) {
    state.repos[repo] = { sha: '', branch: '', bootstrap_at: now, skipped: `error: ${String(err).slice(0, 120)}` };
    console.log(`ERROR: ${String(err).slice(0, 80)}`);
  }
}

// Summary
const total = Object.keys(state.repos).length;
const pulledCount = Object.values(state.repos).filter(r => r.pulled).length;
const dirtyCount = Object.values(state.repos).filter(r => r.was_dirty).length;
const offMainCount = Object.values(state.repos).filter(r => r.off_main).length;
const skippedCount = Object.values(state.repos).filter(r => r.skipped).length;
const okCount = Object.values(state.repos).filter(r => r.sha && !r.skipped).length;

console.log('');
console.log(`  Total repos:   ${total}`);
console.log(`  Baseline OK:   ${okCount}`);
console.log(`    pulled:      ${pulledCount}`);
console.log(`    dirty:       ${dirtyCount}`);
console.log(`    off-main:    ${offMainCount}`);
console.log(`  Skipped:       ${skippedCount}`);

if (dryRun) {
  console.log(`\n(dry-run) State file NOT written. Would write to: ${statePath}`);
} else {
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  console.log(`\n✓ State file written: ${statePath}`);
}
