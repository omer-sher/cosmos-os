/**
 * drift-sync configuration loader.
 *
 * Single source of company-specific values (GitHub org, default branch,
 * workspace root, Slack wiring, optional topic registry). Read once from
 * `drift-sync/config.json` (copy `config.example.json` to get started),
 * with environment-variable overrides so CI can inject values without
 * editing the file.
 *
 * Precedence: environment variable > drift-sync/config.json > built-in default.
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TopicRegistryConfig {
  /** Repo (inside `githubOrg`) that holds the Kafka topic registry file. */
  repo: string;
  /** Path of the registry file within that repo. */
  path: string;
  /** Optional prefix topics carry in the registry (e.g. "production."). */
  topicPrefix?: string;
}

export interface DriftSyncConfig {
  /**
   * GitHub org/owner the tracked source repos live under.
   * Env: GITHUB_ORG (or GH_ORG). In GitHub Actions, falls back to the
   * org that owns this repo (GITHUB_REPOSITORY_OWNER).
   */
  githubOrg: string;
  /**
   * Branch treated as the source of truth for tracked repos, and the base
   * branch for the PRs this tool opens. Env: DEFAULT_BRANCH.
   */
  defaultBranch: string;
  /**
   * Directory that holds the local clones of the tracked repos.
   * Env: REPOS_ROOT. Defaults to the parent directory of this repository
   * (i.e. all repos as siblings in one workspace folder).
   */
  reposRoot: string;
  /**
   * Name of the env var holding the Slack incoming-webhook URL for all
   * drift-sync notifications. The URL itself stays in CI secrets / env.
   */
  slackWebhookEnv: string;
  /**
   * team → Slack user-group ID (e.g. "S0123ABCDE") so drift messages can
   * @-mention the owning team. Env override per team: SLACK_GROUP_ID_<TEAM>.
   */
  slackTeamGroups: Record<string, string>;
  /**
   * Optional authoritative Kafka topic registry (a single file in an infra
   * repo listing every topic that exists in production). When set, the
   * clone step fetches it and agents treat it as canonical for topic
   * existence/naming. When unset, agents rely on source code alone.
   */
  topicRegistry?: TopicRegistryConfig;
}

interface ConfigFile {
  githubOrg?: string;
  defaultBranch?: string;
  reposRoot?: string;
  slackWebhookEnv?: string;
  slackTeamGroups?: Record<string, string>;
  topicRegistry?: TopicRegistryConfig;
}

/** Repo root (this repository), derived from this file's location. */
const here = path.dirname(fileURLToPath(import.meta.url));
// here = drift-sync/scripts/lib → repo root is three levels up.
export const cosmosRoot = path.resolve(here, '..', '..', '..');

const configPath = path.join(cosmosRoot, 'drift-sync', 'config.json');

/** Read an env var, treating empty/whitespace values as unset. */
function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function readConfigFile(): ConfigFile {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as ConfigFile;
  } catch (err) {
    // A malformed config is a setup error — fail loudly rather than
    // silently running with defaults that point at the wrong org.
    throw new Error(`Could not parse ${configPath}: ${String(err)}`);
  }
}

let cached: DriftSyncConfig | null = null;

export function loadDriftSyncConfig(): DriftSyncConfig {
  if (cached) return cached;
  const file = readConfigFile();

  const githubOrg =
    env('GITHUB_ORG') ??
    env('GH_ORG') ??
    file.githubOrg ??
    env('GITHUB_REPOSITORY_OWNER') ??
    '';

  const defaultBranch = env('DEFAULT_BRANCH') ?? file.defaultBranch ?? 'main';

  const reposRootRaw = env('REPOS_ROOT') ?? file.reposRoot;
  const reposRoot = reposRootRaw
    ? path.resolve(cosmosRoot, reposRootRaw) // relative values resolve against the repo root
    : path.resolve(cosmosRoot, '..');

  cached = {
    githubOrg,
    defaultBranch,
    reposRoot,
    slackWebhookEnv: file.slackWebhookEnv ?? 'SLACK_WEBHOOK_COSMOS',
    slackTeamGroups: file.slackTeamGroups ?? {},
    topicRegistry: file.topicRegistry,
  };
  return cached;
}

/**
 * Resolve the Slack user-group ID for a team: the SLACK_GROUP_ID_<TEAM>
 * env var wins (CI secrets), then the config file's slackTeamGroups map.
 */
export function slackGroupIdForTeam(config: DriftSyncConfig, team: string): string | undefined {
  const envKey = `SLACK_GROUP_ID_${team.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return env(envKey) ?? config.slackTeamGroups[team];
}

/** Absolute path of the topic registry file inside the local workspace, if configured. */
export function topicRegistryLocalPath(config: DriftSyncConfig): string | null {
  if (!config.topicRegistry) return null;
  return path.join(config.reposRoot, config.topicRegistry.repo, config.topicRegistry.path);
}
