# Cosmos Drift Sync

> AI-driven nightly check that keeps your Cosmos map honest with reality.

Cosmos is a living map of your services, Kafka topics, and event flows. The moment reality drifts from the map — a topic renamed, a new producer added, a handler deleted — this system detects it overnight, drafts the fix, and opens a per-team draft PR. Optionally, Slack lights up. The map stays true.

It works against **your** GitHub org and repos: everything company-specific lives in `drift-sync/config.json` (plus CI secrets), and the tracked-repo list is derived from your Cosmos map itself.

---

## What lives here

```
drift-sync/
├── README.md                       you are here
├── config.example.json             copy to config.json and fill in your org
├── state.json                      per-repo baseline SHAs (the "in sync" contract)
├── state.example.json              what a populated state file looks like
├── cosmos-confirmed.json           optional: suppressions with evidence trails
├── dry-runs/                       runtime reports (.md + .html), gitignored
└── scripts/
    ├── validate.ts                 internal consistency check  → `npm run validate`
    ├── bootstrap-state.ts          snapshot baseline SHAs      → `npm run sync:bootstrap`
    ├── sync.ts                     investigate-topic <id>      → `npm run sync`
    ├── diff-repo.ts                per-repo drift verdict      → `npm run sync:diff-repo`
    ├── apply-edits.ts              applier agent (writes fixes)→ `npm run sync:apply`
    ├── sync-nightly.ts             orchestrator (the cron)     → `npm run sync:nightly`
    ├── clone-repos.ts              CI helper (smart-clone)     → `npm run sync:clone-repos`
    └── lib/
        ├── config.ts               typed config loader (config.json + env overrides)
        ├── agent.ts                Claude tool-use loop (read_file, write_file, grep, run_command)
        ├── prefilter.ts            path + content regex applied to diffs
        ├── git.ts                  git + state-file helpers
        ├── cosmos-context.ts       per-repo Cosmos slice extractor
        └── report-html.ts          generator for the dry-run HTML report
```

The workflow itself lives at [`.github/workflows/cosmos-sync.yml`](../.github/workflows/cosmos-sync.yml) (GitHub Actions requires that path).

---

## The nightly flow

```
04:17 UTC nightly
      │
      ▼
clone-repos ──── remote HEAD == baseline? ──► skip clone (synthetic no_drift)
      │
      ▼
diff-repo (per repo, concurrency-capped)
      │  1. prefilter: cheap path + content regex on the diff
      │     ~95% of diffs exit here in milliseconds, no API call
      │  2. survivors: Claude agent investigates with read_file/grep/list_dir
      ▼
verdicts: drift / no_drift / inconclusive  (+ confidence + file:line evidence)
      │
      ▼
bucket by team (Service.team from the map)
      │
      ▼
apply-edits (per team): Claude agent edits src/scenarios/*,
      runs `npm run validate` in-loop until it passes
      │
      ▼
one draft PR per team
      ├── PR body: findings, evidence, applied edits, full diff
      ├── baseline bump for the fixed repos INSIDE the same PR
      └── Slack ping (optional): single channel, team @-mentioned
      │
      ▼
state.json advances ONLY when a PR merges
(no_drift repos advance via a separate self-merging chore PR)
```

---

## Setup

### 1. Configure

```bash
cp drift-sync/config.example.json drift-sync/config.json
# edit: set githubOrg (and anything else that differs from the defaults)
```

`config.json` reference (every field optional unless noted — see `scripts/lib/config.ts`):

| Field | Env override | Default | Purpose |
|---|---|---|---|
| `githubOrg` | `GITHUB_ORG` (or `GH_ORG`) | `GITHUB_REPOSITORY_OWNER` in CI | Org the tracked source repos live under. **Required** for cloning. |
| `defaultBranch` | `DEFAULT_BRANCH` | `main` | Branch treated as production truth in source repos, and the base branch for the PRs this tool opens. |
| `reposRoot` | `REPOS_ROOT` | parent dir of this repo | Directory holding local clones of the tracked repos (all repos as siblings). Relative values resolve against this repo's root. |
| `slackWebhookEnv` | — | `SLACK_WEBHOOK_COSMOS` | *Name* of the env var that holds the Slack incoming-webhook URL. The URL itself stays in secrets/env, never in the repo. |
| `slackTeamGroups` | `SLACK_GROUP_ID_<TEAM>` (per team, env wins) | `{}` | team → Slack user-group ID (e.g. `"team-shopping": "S0123ABCDE"`) so drift messages actually ping the team via `<!subteam^…>`. Unmapped teams render as plain `@team` text. Right-click the group in Slack → Copy link; the ID is the trailing `S…` segment. |
| `topicRegistry` | — | unset | Optional authoritative Kafka topic registry: `{ "repo", "path", "topicPrefix" }` — a single file in an infra repo listing every production topic. When set, CI fetches just that file and agents treat it as canonical for topic existence/naming. When unset, agents rely on source code alone. |

Precedence everywhere: **env var > config.json > default** — so CI can inject values without touching the file.

Team ownership (who reviews each team's PRs) is part of the map itself: `src/scenarios/owners.ts`.

### 2. Bootstrap the baseline

`state.json` is the contract for "in sync": one entry per tracked repo with the SHA the map was last verified against. It ships empty. To populate it:

```bash
# Clone (or already have) your source repos as siblings of this repo,
# make sure the map (src/scenarios/) reflects reality as of today, then:
npm run sync:bootstrap            # snapshots origin/<defaultBranch> HEAD per repo
npm run sync:bootstrap -- --dry-run   # preview without writing
```

The repo list is derived from the map (`Service.repo` + `SubService.repo` in `src/scenarios/services.ts`) — there is no second list to maintain. Commit the resulting `state.json`. See `state.example.json` for the shape.

### 3. Secrets (GitHub Actions)

Add at `https://github.com/<your-org>/<this-repo>/settings/secrets/actions`:

| Secret | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Powers the diff-repo and applier agents. |
| `COSMOS_SYNC_PAT` | ✅ for CI | GitHub PAT with `repo` scope — needed to clone the source repos from the runner. Falls back to `GITHUB_TOKEN`, which only authenticates against this repo itself. **If your org uses SAML SSO**, remember to authorize the PAT for the org (token settings → Configure SSO) or every clone will 403. |
| `SLACK_WEBHOOK_COSMOS` | optional | Incoming-webhook URL for the single drift-sync channel. All notifications (per-team drift PRs, all-clear heartbeat, degraded-run alerts) post here. Without it, Slack pings are silently skipped. |

### 4. Enable the workflow

The nightly cron is **off by default** so forks don't inherit a failing scheduled job. Flip it on by creating a repository **variable** (Settings → Secrets and variables → Actions → Variables):

```
DRIFT_SYNC_ENABLED = true
```

Until that variable is `true`, scheduled and manual runs show as *skipped*.

---

## Running it

### CI

The cron runs nightly at 04:17 UTC in `live` mode. Manual triggers:

```bash
gh workflow run cosmos-sync.yml --field mode=dry-run      # findings only — no PRs, no Slack
gh workflow run cosmos-sync.yml --field mode=findings-pr  # verdicts, applier skipped
gh workflow run cosmos-sync.yml --field mode=live         # full loop: edits + PRs + Slack

# Debug a single repo:
gh workflow run cosmos-sync.yml --field mode=dry-run --field only_repo=<repo>
```

Or via the GitHub UI: Actions → "Cosmos Drift Sync" → Run workflow.

Every run writes a condensed report (bucket counts, per-team breakdown with PR links, estimated API cost) to the run's **Summary** panel, and uploads the full `.md` + `.html` reports as an artifact (`cosmos-sync-dry-run-<run-id>`, retained 10 days).

### Local

All scripts run from the repo root via npm:

```bash
npm run validate                        # map self-consistency check
npm run validate -- --source-check      # + cross-repo greps (needs local clones)

npm run sync:bootstrap                  # (re)snapshot every baseline SHA

npm run sync -- investigate-topic <topic-id>   # ad-hoc: Claude audits one topic

npm run sync:diff-repo -- <repo>                 # one repo: baseline → origin HEAD
npm run sync:diff-repo -- <repo> --from <sha>    # explicit range
npm run sync:diff-repo -- <repo> --verbose       # show every agent turn + tool call

npm run sync:nightly                    # full sweep, dry-run report only
npm run sync:nightly -- --live-pr       # full loop: edits + PRs + Slack
npm run sync:nightly -- --only <repo>   # restrict to one repo
npm run sync:nightly -- --skip-applier  # verdicts only

npm run sync:apply -- --input <verdicts.json> --team <team>   # applier in isolation

REPOS_ROOT=/tmp/source-repos npm run sync:clone-repos   # what CI runs before the sweep
```

Reports land in `drift-sync/dry-runs/<date>.{md,html}`. Environment comes from `.env` / `.env.local` at the repo root (`ANTHROPIC_API_KEY` required for the agent steps).

---

## How PRs and the baseline interact

The core invariant: **a drift finding keeps re-surfacing until a human acts on it.**

- **Drift found** → the applier edits the map, and the branch also carries the `state.json` baseline bump for exactly the repos whose edits were applied. Merging the PR therefore updates the map *and* records "caught up to `<sha>`" atomically. Ignore the PR and the next run re-detects the same drift — but **dedupes**: it comments the fresh findings onto the existing open PR (matched by the `cosmos-sync` + `team:<team>` labels) instead of opening a duplicate.
- **Wrong verdict** → close the PR with the `not-drift` label; the finding won't re-surface for that range.
- **New commits but no drift** → the baseline advances via a single separate chore PR (`[cosmos-sync] chore: advance N no-drift baselines`) that enables auto-merge on itself — no human action, and the next run skips re-analyzing those repos. Low-confidence no-drift verdicts are deliberately *not* advanced; they get re-checked the next night.
- **PR titles**: `[cosmos-sync] <team> domain · N services drifted`. PRs open as **drafts** by design — a human marks them ready after verifying the evidence.

One PR per team, driven by `Service.team` in the map; reviewers come from `src/scenarios/owners.ts`.

---

## Where to look when something goes wrong

| Symptom | Look here |
|---|---|
| Workflow shows *skipped* | `DRIFT_SYNC_ENABLED` repo variable isn't `true`. |
| Workflow fails at "Clone source repos" | `COSMOS_SYNC_PAT` is missing, lacks `repo` scope, or isn't authorized for SAML SSO. Test with `curl -H "Authorization: token ghp_xxx" https://api.github.com/repos/<org>/<repo>` — 200 = good, 403 = SSO not authorized, 404 = no access. The clone step fails loudly if *every* clone fails, so a dead PAT can't masquerade as an all-clear. |
| "No GitHub org configured" | Set `githubOrg` in `drift-sync/config.json` (or the `GITHUB_ORG` env var). |
| Workflow finishes but artifact is empty | The `path:` glob in the workflow must match where sync-nightly writes — `drift-sync/dry-runs/**`. |
| Local `npm run validate` fails | A recent map edit broke internal consistency (unknown topic id in a step, etc.). The output names the exact finding. |
| A drift PR opens but the proposed diff is wrong | Close it with the `not-drift` label, then improve the applier prompt (`apply-edits.ts`) or the prefilter (`lib/prefilter.ts`). |
| Applier emits an empty diff | Re-run with `--verbose` to see the agent trace. Common cause: the model announced an edit without calling `write_file`; the nudge in `lib/agent.ts` (`requireJsonReport`) usually catches this — raise `--max-iterations` if needed. |
| No Slack messages | The webhook env var (default `SLACK_WEBHOOK_COSMOS`) isn't set — pings are then skipped silently by design. Group @-mentions additionally need `slackTeamGroups` in config (or `SLACK_GROUP_ID_<TEAM>` env). |
