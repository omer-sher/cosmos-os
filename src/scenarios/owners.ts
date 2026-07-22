import type { Service } from './types';

/**
 * Team → reviewer mapping used by the drift-sync agent when it opens
 * Cosmos PRs. The team comes from `Service.team`; the reviewers come
 * from this file. Update the GitHub team slugs + handles to match the
 * org. Slack channels are optional but used by the future Slack hook.
 */
export interface TeamOwner {
  /** GitHub team slug (without the @org/ prefix). */
  githubTeam: string;
  /** Individual GitHub handles, used as fallback if team mention fails. */
  reviewers: string[];
  /** Slack channel for notifications (optional). */
  slack?: string;
}

export type TeamId = NonNullable<Service['team']>;

export const TEAM_OWNERS: Record<TeamId, TeamOwner> = {
  'team-shopping': {
    githubTeam: 'astromart/team-shopping',
    reviewers: [],
    slack: '#team-shopping',
  },
  'team-fulfillment': {
    githubTeam: 'astromart/team-fulfillment',
    reviewers: [],
    slack: '#team-fulfillment',
  },
  'team-engagement': {
    githubTeam: 'astromart/team-engagement',
    reviewers: [],
    slack: '#team-engagement',
  },
};

/**
 * Per-service overrides. When a service has a dedicated owner that
 * differs from its team's default, list them here.
 */
export const SERVICE_OVERRIDES: Record<string, { reviewers: string[] }> = {
  // payments: { reviewers: ['pci-review-bot'] },
};

/**
 * Fallback owner when neither override nor team mapping resolves —
 * e.g., for services without a team (platform infra like object-storage)
 * or for services added before owners.ts is updated. Drift-sync PRs land
 * here so they never go to /dev/null.
 */
export const FALLBACK_OWNER: TeamOwner = {
  githubTeam: 'astromart/cosmos-maintainers',
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
  if (override) {
    return { reviewers: override.reviewers, source: 'override' };
  }
  if (service.team) {
    const team = TEAM_OWNERS[service.team];
    return {
      reviewers: team.reviewers,
      githubTeam: team.githubTeam,
      slack: team.slack,
      source: 'team',
    };
  }
  return {
    reviewers: FALLBACK_OWNER.reviewers,
    githubTeam: FALLBACK_OWNER.githubTeam,
    source: 'fallback',
  };
}
