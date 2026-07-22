/**
 * Git + state-file helpers shared by the diff-based sync tooling.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export interface SyncStateEntry {
  sha: string;
  branch: string;
  bootstrap_at: string;
  pulled?: boolean;
  was_dirty?: boolean;
  off_main?: string;
  skipped?: string;
}

export interface SyncState {
  version: number;
  bootstrap_at?: string;
  repos: Record<string, SyncStateEntry>;
}

export function loadSyncState(statePath: string): SyncState | null {
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, 'utf8')) as SyncState;
}

export function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }).trim();
}

export function fetchOriginBranch(repoPath: string, branch: string): void {
  // Fetch into the remote-tracking ref EXPLICITLY so `origin/<branch>` resolves
  // even when <branch> is not the repo's default branch. A bare `git fetch
  // origin <branch>` only updates FETCH_HEAD; combined with CI's shallow
  // single-branch clone (which creates a ref only for the default branch),
  // `git rev-parse origin/<branch>` would otherwise fail for any non-default
  // tracked branch (e.g. tracking `main` on a repo whose default is `develop`).
  execFileSync('git', ['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`], {
    cwd: repoPath, stdio: 'ignore',
  });
}

export function getOriginHeadSha(repoPath: string, branch: string): string {
  return git(['rev-parse', `origin/${branch}`], repoPath);
}

export function getChangedFiles(repoPath: string, fromSha: string, toSha: string): string[] {
  const out = git(['diff', '--name-only', `${fromSha}..${toSha}`], repoPath);
  return out.split('\n').filter(Boolean);
}

export function getDiffStat(repoPath: string, fromSha: string, toSha: string): string {
  return git(['diff', '--stat', `${fromSha}..${toSha}`], repoPath);
}

export function getCommitCount(repoPath: string, fromSha: string, toSha: string): number {
  const out = git(['rev-list', '--count', `${fromSha}..${toSha}`], repoPath);
  return Number(out) || 0;
}

/** Unified=0 diff of given files — used by the content prefilter. */
export function getDiffUnifiedZero(repoPath: string, fromSha: string, toSha: string, files: string[]): string {
  if (files.length === 0) return '';
  return execFileSync(
    'git',
    ['diff', '--unified=0', `${fromSha}..${toSha}`, '--', ...files],
    { cwd: repoPath, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  );
}

/** Full unified=3 diff of given files — fed to Claude. */
export function getDiffFull(repoPath: string, fromSha: string, toSha: string, files: string[]): string {
  if (files.length === 0) return '';
  return execFileSync(
    'git',
    ['diff', '--unified=3', `${fromSha}..${toSha}`, '--', ...files],
    { cwd: repoPath, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  );
}

/** Truncate a diff to at most `maxLines`, appending a marker if cut. */
export function truncateDiff(diff: string, maxLines: number): { diff: string; truncated: boolean; originalLines: number } {
  const lines = diff.split('\n');
  if (lines.length <= maxLines) {
    return { diff, truncated: false, originalLines: lines.length };
  }
  return {
    diff: lines.slice(0, maxLines).join('\n') + `\n…[diff truncated — ${lines.length - maxLines} more lines]`,
    truncated: true,
    originalLines: lines.length,
  };
}
