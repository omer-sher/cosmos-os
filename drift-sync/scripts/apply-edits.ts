#!/usr/bin/env -S npx tsx
/**
 * Cosmos drift applier — takes a verdict bundle and produces real edits
 * to Cosmos files, with the validator running in-loop as a safety net.
 *
 * Usage:
 *   npm run sync:apply -- --input <verdicts.json> --team <team>            # apply for real
 *   npm run sync:apply -- --input <verdicts.json> --team <team> --dry-run  # apply, capture diff, revert
 *
 * Reads a verdict bundle (JSON array of Verdict objects), filters by team,
 * invokes Claude with read_file / write_file / run_command tools, applies
 * the proposed Cosmos edits, and runs `npm run validate` after each
 * substantive change.
 *
 * Pre-conditions:
 *   - The Cosmos working tree must be clean under src/scenarios/ and
 *     drift-sync/cosmos-confirmed.json (the applier-writable surface).
 *     Otherwise the applier refuses to run.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from './lib/agent.js';
loadEnv();

import { runAgent, extractJsonReport, APPLIER_TOOL_DEFS } from './lib/agent.js';

// ──────────────────────────────────────────────────────────────────
//  Args
// ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const inputIdx = args.indexOf('--input');
const teamIdx = args.indexOf('--team');
const modelIdx = args.indexOf('--model');
const maxIterIdx = args.indexOf('--max-iterations');
const outputJsonIdx = args.indexOf('--output-json');
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');

if (inputIdx < 0) {
  console.error('Usage: npm run sync:apply -- --input <verdicts.json> [--team <team>] [--dry-run] [--output-json <path>]');
  process.exit(1);
}

const inputPath = args[inputIdx + 1];
const team = teamIdx >= 0 ? args[teamIdx + 1] : null;
const model = modelIdx >= 0 ? args[modelIdx + 1] : 'claude-sonnet-4-6';
const maxIter = maxIterIdx >= 0 ? Number(args[maxIterIdx + 1]) : 50;

const here = path.dirname(fileURLToPath(import.meta.url));
// here = drift-sync/scripts → the cosmos repo root is TWO levels up. Was '..',
// which resolved to drift-sync/ — so read_file / write_file / run_command / git
// were all rooted there, the applier could never read or edit src/scenarios,
// and it skipped every edit (empty diff, no PR). reposRoot is then the
// workspace dir that holds all repos.
const cosmosRoot = path.resolve(here, '..', '..');
const reposRoot = path.resolve(cosmosRoot, '..');

// ──────────────────────────────────────────────────────────────────
//  Load verdicts
// ──────────────────────────────────────────────────────────────────
interface Verdict {
  verdict: string;
  confidence?: string;
  service: string;
  team?: string;
  from_sha: string;
  to_sha: string;
  changes: unknown[];
  summary: string;
  [k: string]: unknown;
}

const all = JSON.parse(readFileSync(inputPath, 'utf8')) as Verdict[];
const items = (team ? all.filter(v => v.team === team) : all).filter(v => v.verdict === 'drift');

if (items.length === 0) {
  console.error(`No drift verdicts to apply for team: ${team ?? '(any)'}`);
  process.exit(0);
}

// ──────────────────────────────────────────────────────────────────
//  Pre-check: cosmos repo must be clean on writable surface
// ──────────────────────────────────────────────────────────────────
const WRITABLE_PATHS = ['src/scenarios/', 'drift-sync/cosmos-confirmed.json'];

function gitStatusWritable(): string {
  try {
    return execFileSync('git', ['status', '--porcelain', '--', ...WRITABLE_PATHS], {
      cwd: cosmosRoot, encoding: 'utf8',
    }).trim();
  } catch (err) {
    return `ERR: ${String(err)}`;
  }
}

const initialStatus = gitStatusWritable();
if (initialStatus.length > 0) {
  console.error('Cosmos working tree has uncommitted changes on the applier-writable surface:');
  console.error(initialStatus);
  console.error('\nCommit or stash these before running the applier.');
  process.exit(2);
}

// ──────────────────────────────────────────────────────────────────
//  Prompts
// ──────────────────────────────────────────────────────────────────
const systemPrompt = `You are the Cosmos Applier — your job is to translate drift findings into actual Cosmos file edits.

You will receive a bundle of "drift" verdicts for one team's services. For each verdict, apply the suggested edits (proposed_cosmos_edits) to the actual Cosmos files using read_file + write_file.

## Working directory
All paths (read_file, write_file, list_dir, grep, run_command) are relative to the COSMOS REPO ROOT (the repository that holds the map). So use \`src/scenarios/topics.ts\`, NOT \`<repo-name>/src/scenarios/topics.ts\`.

## Turn structure (READ THIS)
Every turn before the final MUST include exactly one tool_use block. Text in a turn is for chain-of-thought ONLY — it does NOT count as performing the edit. To apply a change you MUST call write_file in that SAME turn. Saying "Let me apply" or "Now I'll write" without calling the tool is a bug.

Example correct sequence:
- Turn 1: text "Reading types" + tool_use:read_file
- Turn 2: text "Reading topics" + tool_use:read_file
- Turn 3: text "Now writing the new topic" + tool_use:write_file
- Turn 4: text "Verifying" + tool_use:run_command (npm run validate)
- Turn 5: final JSON report (no tool_use)

If you emit a turn with ONLY text and no tool_use BEFORE the final JSON, you have failed. NEVER do this. Keep calling tools until all edits are applied and validate passes.

## Files you MAY modify (writable surface)
- src/scenarios/services.ts
- src/scenarios/topics.ts
- src/scenarios/scenarios.ts
- src/scenarios/data.ts
- src/scenarios/owners.ts
- src/scenarios/steps/*.ts (the per-domain step files)
- drift-sync/cosmos-confirmed.json

## Files you MUST NOT modify
- Any file under scripts/ (e.g., validate.ts, sync.ts, diff-repo.ts)
- Any file under src/ other than the scenarios files listed above
- Any file outside this repository (source repos)

If you accidentally try to write outside the writable surface, write_file will reject with an error — that's expected.

## How the data is shaped
- Topics live in src/scenarios/topics.ts as a const array of Topic objects.
- Services live in src/scenarios/services.ts as a const array of Service objects.
- Steps live under src/scenarios/steps/*.ts (one file per domain) as const arrays of Step objects.
- Scenarios live in src/scenarios/scenarios.ts.
- types.ts defines the Service / Topic / Step / Scenario interfaces. READ types.ts first if you need to confirm field names.

## Process
1. Read types.ts to confirm field shapes.
2. For each verdict in the bundle:
   a. Identify the target Cosmos file(s) from proposed_cosmos_edits.
   b. read_file to see the current content.
   c. Apply the smallest possible edit that satisfies the verdict.
   d. write_file with the full new content. Preserve exact formatting (indentation, quotes, trailing commas).
3. After applying ALL edits, run \`npm run validate\` via run_command.
4. If validator fails (errors > 0): inspect the output, fix, re-run.
5. When validator passes, emit the final JSON report.

## Conservative bias
- If a proposed edit is ambiguous, SKIP it and report why. Better to skip than guess.
- If you're not sure where in the file to add a new step, prefer adding at the end of the relevant phase block.
- Do NOT delete existing entries unless explicitly directed and the verdict has confidence: high.
- Preserve the exact indentation style (2-space, no tabs).

## Output
Output a single JSON object in a markdown code block tagged 'json':
{
  "applied": [
    { "verdict_service": "orders", "file": "src/scenarios/topics.ts", "summary": "added 'orders' to producers in order-events desc" }
  ],
  "skipped": [
    { "verdict_service": "...", "reason": "..." }
  ],
  "validator_passed": true,
  "summary": "1-2 sentences"
}`;

const userPrompt = `# Verdict bundle (team: ${team ?? 'any'})

${items.length} drift verdict(s) to apply. Apply each one to Cosmos files, then run \`npm run validate\` to confirm.

\`\`\`json
${JSON.stringify(items, null, 2)}
\`\`\`

Begin. Start by reading types.ts to confirm field shapes.`;

// ──────────────────────────────────────────────────────────────────
//  Run the applier agent
// ──────────────────────────────────────────────────────────────────
console.log(`\n═══ apply-edits: ${team ?? '(all)'} ═══`);
console.log(`  verdicts:  ${items.length}`);
console.log(`  dry-run:   ${dryRun}`);
console.log(`  model:     ${model}`);
console.log(`  max iter:  ${maxIter}`);
console.log('');

const result = await runAgent({
  systemPrompt,
  userPrompt,
  model,
  maxIter,
  // All paths resolve relative to cosmosRoot for the applier — same root
  // for read_file, grep, list_dir, AND write_file. Removes path confusion.
  reposRoot: cosmosRoot,
  tools: APPLIER_TOOL_DEFS,
  writeRoot: cosmosRoot,
  runCommandRoot: cosmosRoot,
  runCommandAllowed: ['npm run validate'],
  requireJsonReport: true,
  // Applier writes full-file content via write_file — Cosmos files can be
  // 200+ lines, well above the default 4096-token budget. 16k is the
  // largest budget the SDK allows without switching to streaming mode.
  maxTokens: 16_000,
  verbose,
});

// ──────────────────────────────────────────────────────────────────
//  Capture diff
// ──────────────────────────────────────────────────────────────────
let diffOutput = '';
try {
  diffOutput = execFileSync('git', ['diff', '--', ...WRITABLE_PATHS], {
    cwd: cosmosRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  console.error(`Failed to capture diff: ${String(err)}`);
}

// ──────────────────────────────────────────────────────────────────
//  Dry-run revert
// ──────────────────────────────────────────────────────────────────
if (dryRun) {
  try {
    execFileSync('git', ['checkout', '--', ...WRITABLE_PATHS], { cwd: cosmosRoot, stdio: 'ignore' });
  } catch (err) {
    console.error(`(warn) revert failed: ${String(err)}`);
  }
}

// ──────────────────────────────────────────────────────────────────
//  Report
// ──────────────────────────────────────────────────────────────────
const report = result.finalText ? extractJsonReport<{
  applied: { verdict_service: string; file: string; summary: string }[];
  skipped: { verdict_service: string; reason: string }[];
  validator_passed: boolean;
  summary: string;
}>(result.finalText) : null;

const output = {
  team: team ?? null,
  verdicts_count: items.length,
  iterations: result.iterations,
  stopped: result.stoppedReason,
  applier_report: report,
  diff: diffOutput,
  diff_line_count: diffOutput.split('\n').length,
  dry_run_reverted: dryRun,
  usage: result.usage,
  model: result.model,
};

console.log('\n═══ Applier result ═══');
console.log(`  iterations:        ${result.iterations}`);
console.log(`  applied:           ${report?.applied?.length ?? '?'}`);
console.log(`  skipped:           ${report?.skipped?.length ?? '?'}`);
console.log(`  validator_passed:  ${report?.validator_passed ?? '?'}`);
console.log(`  diff lines:        ${output.diff_line_count}`);
console.log(`  reverted:          ${dryRun}`);

if (report?.summary) {
  console.log(`\n  Summary: ${report.summary}`);
}

console.log('\nDiff (first 60 lines):');
console.log(diffOutput.split('\n').slice(0, 60).join('\n'));
if (output.diff_line_count > 60) {
  console.log(`…[${output.diff_line_count - 60} more lines]`);
}

if (outputJsonIdx >= 0) {
  writeFileSync(args[outputJsonIdx + 1], JSON.stringify(output, null, 2));
  console.log(`\n✓ Applier result written to: ${args[outputJsonIdx + 1]}`);
}
