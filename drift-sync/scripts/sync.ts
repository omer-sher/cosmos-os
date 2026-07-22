#!/usr/bin/env -S npx tsx
/**
 * Cosmos drift-sync agent — Phase 0.5
 *
 * Lets Claude investigate a specific Cosmos topic by reading source repos
 * and grepping for constants/env vars. Outputs a structured report:
 * verdict, evidence, and proposed Cosmos edits.
 *
 * Usage:
 *   npm run sync -- investigate-topic <topic-id>
 *   npm run sync -- investigate-topic cloud-pools.pool-created-event
 *   npm run sync -- investigate-topic cloud-pools.pool-created-event --model claude-opus-4-7
 *
 * Env:
 *   ANTHROPIC_API_KEY — required
 */

import Anthropic from '@anthropic-ai/sdk';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env / .env.local from the cosmos repo root (no external dep).
// Also alias VITE_ANTHROPIC_API_KEY → ANTHROPIC_API_KEY since the Vite app
// uses the VITE_ prefix and we'd rather not require the user to duplicate it.
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..');
  for (const fname of ['.env', '.env.local']) {
    const envPath = path.join(repoRoot, fname);
    if (!existsSync(envPath)) continue;
    for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  }
  if (!process.env.ANTHROPIC_API_KEY && process.env.VITE_ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = process.env.VITE_ANTHROPIC_API_KEY;
  }
}
import { SERVICES, SERVICES_BY_ID } from '../../src/scenarios/services.js';
import { TOPICS, TOPICS_BY_ID } from '../../src/scenarios/topics.js';
import { STEPS } from '../../src/scenarios/data.js';
import type { Service, Step, SubService, Topic } from '../../src/scenarios/types.js';
import { loadDriftSyncConfig, topicRegistryLocalPath } from './lib/config.js';

const config = loadDriftSyncConfig();

// ──────────────────────────────────────────────────────────────────
//  Args
// ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd = args[0];
const reposRootIdx = args.indexOf('--repos-root');
const reposRoot =
  reposRootIdx >= 0 ? args[reposRootIdx + 1] : config.reposRoot;
const modelIdx = args.indexOf('--model');
const model = modelIdx >= 0 ? args[modelIdx + 1] : 'claude-sonnet-4-6';
const maxIterIdx = args.indexOf('--max-iterations');
const MAX_ITER = maxIterIdx >= 0 ? Number(args[maxIterIdx + 1]) : 30;

function usage(): never {
  console.error('Usage: npm run sync -- investigate-topic <topic-id> [--model <id>] [--max-iterations N]');
  console.error('');
  console.error('Available topic ids:');
  for (const t of TOPICS) console.error(`  ${t.id.padEnd(50)} (name: ${t.name})`);
  process.exit(1);
}

if (cmd !== 'investigate-topic' || !args[1]) usage();
const topicId = args[1];
const topic = TOPICS_BY_ID[topicId] as Topic | undefined;
if (!topic) {
  console.error(`Unknown topic id: ${topicId}`);
  usage();
}

// ──────────────────────────────────────────────────────────────────
//  Gather context: which services Cosmos says produce/consume this topic
// ──────────────────────────────────────────────────────────────────
function reposForService(serviceId: string): string[] {
  const svc = SERVICES_BY_ID[serviceId] as Service | undefined;
  if (svc) {
    const repos: string[] = [];
    if (svc.repo) repos.push(svc.repo);
    for (const sub of svc.subServices ?? []) {
      if (sub.repo) repos.push(sub.repo);
    }
    return repos;
  }
  const sub = SERVICES.flatMap(s => s.subServices ?? []).find(s => s.id === serviceId) as
    | SubService
    | undefined;
  return sub?.repo ? [sub.repo] : [];
}

const relatedSteps: Step[] = STEPS.filter(s => s.via === topicId);
const producerIds = [...new Set(relatedSteps.map(s => s.from))];
const consumerIds = [...new Set(relatedSteps.map(s => s.to))];
const producerRepos = [...new Set(producerIds.flatMap(reposForService))];
const consumerRepos = [...new Set(consumerIds.flatMap(reposForService))];

// ──────────────────────────────────────────────────────────────────
//  Tools given to Claude
// ──────────────────────────────────────────────────────────────────
const ALLOWED_ROOTS = [reposRoot];

function resolveSafe(p: string): string {
  const abs = path.isAbsolute(p) ? p : path.join(reposRoot, p);
  const resolved = path.resolve(abs);
  if (!ALLOWED_ROOTS.some(root => resolved.startsWith(path.resolve(root) + path.sep) || resolved === path.resolve(root))) {
    throw new Error(`Path outside allowed roots: ${resolved}`);
  }
  return resolved;
}

function toolRead(args: { path: string; max_bytes?: number }): string {
  const p = resolveSafe(args.path);
  const stat = statSync(p);
  if (!stat.isFile()) return `ERROR: not a file: ${args.path}`;
  const limit = args.max_bytes ?? 64_000;
  const buf = readFileSync(p);
  const truncated = buf.length > limit;
  return (truncated ? buf.subarray(0, limit).toString('utf8') + `\n…[truncated ${buf.length - limit} bytes]…` : buf.toString('utf8'));
}

function toolList(args: { path: string }): string {
  const p = resolveSafe(args.path);
  try {
    const out = execFileSync('ls', ['-1ap', p], { encoding: 'utf8' });
    return out;
  } catch (err) {
    return `ERROR: ${String(err)}`;
  }
}

function toolGrep(args: { pattern: string; path: string; fixed?: boolean; max_matches?: number }): string {
  const target = resolveSafe(args.path);
  const max = args.max_matches ?? 50;
  const flags: string[] = ['-rn', '-I', '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist', '--exclude-dir=build'];
  if (args.fixed) flags.push('-F');
  try {
    const out = execFileSync('grep', [...flags, args.pattern, target], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const lines = out.split('\n').filter(Boolean);
    if (lines.length > max) {
      return lines.slice(0, max).join('\n') + `\n…[truncated, ${lines.length - max} more matches]`;
    }
    return lines.join('\n') || '(no matches)';
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: Buffer };
    if (e.status === 1) return '(no matches)';
    return `ERROR: ${e.stderr?.toString() ?? String(err)}`;
  }
}

const TOOL_DEFS: Anthropic.Messages.Tool[] = [
  {
    name: 'read_file',
    description: 'Read a file from any source repo under the workspace. Path can be relative to repos-root or absolute under it.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (relative to repos-root or absolute).' },
        max_bytes: { type: 'number', description: 'Optional truncation limit (default 64000).' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_dir',
    description: 'List entries in a directory.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'grep',
    description: 'Recursively grep for a pattern under a path. Uses GNU/BSD grep. Returns up to 50 matches by default.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Pattern (regex unless fixed=true).' },
        path: { type: 'string', description: 'Directory or file to search.' },
        fixed: { type: 'boolean', description: 'Treat pattern as literal string.' },
        max_matches: { type: 'number' },
      },
      required: ['pattern', 'path'],
    },
  },
];

function dispatchTool(name: string, input: unknown): string {
  try {
    switch (name) {
      case 'read_file': return toolRead(input as { path: string; max_bytes?: number });
      case 'list_dir': return toolList(input as { path: string });
      case 'grep': return toolGrep(input as { pattern: string; path: string; fixed?: boolean; max_matches?: number });
      default: return `ERROR: unknown tool ${name}`;
    }
  } catch (err) {
    return `ERROR: ${String(err)}`;
  }
}

// ──────────────────────────────────────────────────────────────────
//  Prompt
// ──────────────────────────────────────────────────────────────────
const registryPath = topicRegistryLocalPath(config);
const registrySection = config.topicRegistry
  ? `
## Authoritative source of truth
The Kafka topic registry at ${registryPath} lists every topic that exists in production${config.topicRegistry.topicPrefix ? ` (prefixed with '${config.topicRegistry.topicPrefix}')` : ''}. This file is the SOURCE OF TRUTH for topic existence and naming.
`
  : '';

const registrySteps = config.topicRegistry
  ? `1. FIRST grep the registry for the Cosmos topic name. If it appears${config.topicRegistry.topicPrefix ? ` as '${config.topicRegistry.topicPrefix}<cosmos-name>'` : ''} → topic exists, naming is correct.
2. If naming differs, grep the registry for similar names to find the real name.
3. Some services reference event/topic classes from shared internal npm packages that are NOT in the workspace. For these: registry confirmation + a matching class name in the producer source is sufficient evidence. Do NOT spend iterations searching for literal topic strings that live in node_modules.
4. Some consumer repos may not be cloned locally. If the registry confirms the topic and the consumer service is named in the topic's prefix, that's enough evidence the consumer exists.
5. Stop investigating once you can produce a verdict.`
  : `1. Grep the producer repo(s) for the topic name, then the consumer repo(s).
2. If the literal name is absent, look for env-var indirection (e.g. KAFKA_*_TOPIC) and resolve it via env/helm values files.
3. Some services reference event/topic classes from shared internal npm packages that are NOT in the workspace — a matching class name in the producer source is acceptable evidence. Do NOT spend iterations searching node_modules for literal topic strings.
4. Stop investigating once you can produce a verdict.`;

const systemPrompt = `You are a drift-detection agent for Cosmos — your architecture map: a visualization of the services, Kafka topics, and event flows across your organization's platform.

Source repos live at ${reposRoot}/<repo-name>/. The Cosmos map's claims about this topic (producers, consumers, steps) are provided in the task below.
${registrySection}
## Investigation strategy (be efficient — aim for ≤10 iterations)
${registrySteps}

## Output
When you have enough evidence (typically after 3-8 tool calls), output ONE JSON object in a single markdown code block tagged 'json'. Schema:
{
  "verdict": "drift" | "no_drift" | "inconclusive",
  "confidence": "high" | "medium" | "low",
  "actual_topic_name": "...",         // your best determination
  "actual_producers": [...],          // service ids or repo names
  "actual_consumers": [...],
  "proposed_cosmos_edits": [          // empty array if no edits needed
    { "file": "src/scenarios/topics.ts", "change": "rename Topic.name from X to Y", "rationale": "..." }
  ],
  "evidence": [                        // file:line refs that back the verdict
    "<repo>/path/to/file.ts:42 — producer.send('orders.order-created')"
  ],
  "summary": "1-2 sentences for a human reviewer"
}

Do NOT modify any files. Only investigate and report.`;

const userPrompt = `Investigate this Cosmos topic for drift:

Topic id:    ${topic.id}
Topic name:  ${topic.name}
Description: ${topic.desc}

Cosmos says the following services interact with it:
  Producers (step.from):  ${producerIds.join(', ') || '(none)'}
  Consumers (step.to):    ${consumerIds.join(', ') || '(none)'}
  Producer repos:         ${producerRepos.join(', ') || '(none)'}
  Consumer repos:         ${consumerRepos.join(', ') || '(none)'}

Steps that reference this topic (${relatedSteps.length}):
${relatedSteps.map((s, i) => `  ${i + 1}. phase ${s.phase}: ${s.from} → ${s.to}  "${s.label}"`).join('\n')}

${config.topicRegistry
  ? 'Start by checking the authoritative topic registry, then look at producer/consumer source to confirm.'
  : 'Start by grepping the producer/consumer repos for the topic name.'}`;

// ──────────────────────────────────────────────────────────────────
//  Agent loop
// ──────────────────────────────────────────────────────────────────
const client = new Anthropic();
const messages: Anthropic.Messages.MessageParam[] = [
  { role: 'user', content: userPrompt },
];

console.log(`\n═══ Investigating topic: ${topic.id} (name: ${topic.name}) ═══\n`);

let iteration = 0;
let finalText: string | null = null;

while (iteration < MAX_ITER) {
  iteration++;
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    tools: TOOL_DEFS,
    messages,
  });

  const assistantContent: Anthropic.Messages.ContentBlock[] = response.content;
  messages.push({ role: 'assistant', content: assistantContent });

  // Print any text the model emitted this turn
  for (const block of assistantContent) {
    if (block.type === 'text' && block.text.trim()) {
      console.log(`[turn ${iteration}] ${block.text.trim()}\n`);
    }
  }

  if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
    finalText = assistantContent
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n');
    break;
  }

  if (response.stop_reason !== 'tool_use') {
    console.error(`Unexpected stop_reason: ${response.stop_reason}`);
    break;
  }

  const toolUses = assistantContent.filter(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
  );
  const toolResults: Anthropic.Messages.ToolResultBlockParam[] = toolUses.map(use => {
    console.log(`  ↳ tool: ${use.name}(${JSON.stringify(use.input)})`);
    const out = dispatchTool(use.name, use.input);
    return {
      type: 'tool_result',
      tool_use_id: use.id,
      content: out.length > 32_000 ? out.slice(0, 32_000) + '\n…[truncated]' : out,
    };
  });

  messages.push({ role: 'user', content: toolResults });
}

if (!finalText) {
  console.error(`\nAgent did not finish within ${MAX_ITER} iterations.`);
  process.exit(2);
}

// ──────────────────────────────────────────────────────────────────
//  Extract and pretty-print the JSON report
// ──────────────────────────────────────────────────────────────────
const jsonMatch = finalText.match(/```json\s*([\s\S]*?)```/);
if (jsonMatch) {
  try {
    const report = JSON.parse(jsonMatch[1]);
    console.log('\n═══ Final report ═══');
    console.log(JSON.stringify(report, null, 2));
  } catch {
    console.log('\n═══ Final text (could not parse JSON) ═══');
    console.log(finalText);
  }
} else {
  console.log('\n═══ Final text ═══');
  console.log(finalText);
}

console.log(`\n(${iteration} iterations)`);
