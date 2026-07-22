/**
 * Shared agent infrastructure: env loader, tool definitions + dispatcher,
 * and the multi-turn Claude loop.
 *
 * Used by both `scripts/sync.ts` (investigate-topic) and `scripts/diff-repo.ts`.
 */

import Anthropic from '@anthropic-ai/sdk';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ──────────────────────────────────────────────────────────────────
//  Env loader
// ──────────────────────────────────────────────────────────────────
export function loadEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // here is drift-sync/scripts/lib → repo root is THREE levels up
  // (two only reached drift-sync/, so .env.local was never found locally).
  const repoRoot = path.resolve(here, '..', '..', '..');
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

// ──────────────────────────────────────────────────────────────────
//  Filesystem tools given to Claude
// ──────────────────────────────────────────────────────────────────
function resolveSafe(reposRoot: string, p: string): string {
  const abs = path.isAbsolute(p) ? p : path.join(reposRoot, p);
  const resolved = path.resolve(abs);
  const root = path.resolve(reposRoot);
  if (!(resolved.startsWith(root + path.sep) || resolved === root)) {
    throw new Error(`Path outside allowed root: ${resolved}`);
  }
  return resolved;
}

function toolRead(reposRoot: string, args: { path: string; max_bytes?: number }): string {
  const p = resolveSafe(reposRoot, args.path);
  const stat = statSync(p);
  if (!stat.isFile()) return `ERROR: not a file: ${args.path}`;
  const limit = args.max_bytes ?? 64_000;
  const buf = readFileSync(p);
  return buf.length > limit
    ? buf.subarray(0, limit).toString('utf8') + `\n…[truncated ${buf.length - limit} bytes]…`
    : buf.toString('utf8');
}

function toolList(reposRoot: string, args: { path: string }): string {
  const p = resolveSafe(reposRoot, args.path);
  try {
    return execFileSync('ls', ['-1ap', p], { encoding: 'utf8' });
  } catch (err) {
    return `ERROR: ${String(err)}`;
  }
}

/**
 * Sandboxed write_file — only allowed under a specific writable root.
 * Used by the applier agent which must write to the Cosmos repo but not
 * any source repo.
 */
function toolWrite(writeRoot: string, args: { path: string; content: string }): string {
  // Documented footgun: the model sometimes prefixes the cosmos repo name
  // (e.g. "<repo-name>/src/scenarios/…"). Left as-is that resolves to a bogus
  // nested dir INSIDE writeRoot — it passes the root check below, so the write
  // "succeeds" but the REAL file is never touched. The resulting empty diff
  // makes the applier thrash to its iteration cap. Strip a leading
  // "<writeRoot-basename>/" so the edit lands on the real file.
  const rootName = path.basename(path.resolve(writeRoot));
  let reqPath = args.path;
  if (!path.isAbsolute(reqPath) && reqPath.startsWith(rootName + '/')) {
    reqPath = reqPath.slice(rootName.length + 1);
  }
  // Resolve relative to writeRoot (NOT to reposRoot).
  const abs = path.isAbsolute(reqPath) ? reqPath : path.join(writeRoot, reqPath);
  const resolved = path.resolve(abs);
  const root = path.resolve(writeRoot);
  if (!(resolved.startsWith(root + path.sep) || resolved === root)) {
    return `ERROR: write path outside write root: ${resolved}`;
  }
  try {
    mkdirSync(path.dirname(resolved), { recursive: true });
    writeFileSync(resolved, args.content);
    return `OK: wrote ${args.content.length} bytes to ${resolved}`;
  } catch (err) {
    return `ERROR: ${String(err)}`;
  }
}

function toolRunCommand(allowed: string[], cwd: string, args: { command: string }): string {
  // Only run pre-approved commands; no shell injection.
  const cmd = args.command.trim();
  if (!allowed.includes(cmd)) {
    return `ERROR: command not in allowlist (${allowed.join(', ')})`;
  }
  // Parse "npm run validate" → ['npm', ['run', 'validate']]
  const parts = cmd.split(/\s+/);
  const bin = parts[0];
  const cmdArgs = parts.slice(1);
  try {
    const out = execFileSync(bin, cmdArgs, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return out.slice(-8000); // tail truncation
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    const stdout = e.stdout?.toString() ?? '';
    const stderr = e.stderr?.toString() ?? '';
    return `EXIT ${e.status ?? '?'}:\n${stdout.slice(-4000)}\n${stderr.slice(-2000)}`;
  }
}

function toolGrep(
  reposRoot: string,
  args: { pattern: string; path: string; fixed?: boolean; max_matches?: number },
): string {
  const target = resolveSafe(reposRoot, args.path);
  const max = args.max_matches ?? 50;
  const flags: string[] = ['-rn', '-I', '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist', '--exclude-dir=build'];
  if (args.fixed) flags.push('-F');
  try {
    const out = execFileSync('grep', [...flags, args.pattern, target], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
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

export const TOOL_DEFS: Anthropic.Messages.Tool[] = [
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

export function createDispatcher(reposRoot: string, extras?: {
  writeRoot?: string;
  runCommandRoot?: string;
  runCommandAllowed?: string[];
}) {
  return function dispatchTool(name: string, input: unknown): string {
    try {
      switch (name) {
        case 'read_file': return toolRead(reposRoot, input as { path: string; max_bytes?: number });
        case 'list_dir': return toolList(reposRoot, input as { path: string });
        case 'grep': return toolGrep(reposRoot, input as { pattern: string; path: string; fixed?: boolean; max_matches?: number });
        case 'write_file':
          if (!extras?.writeRoot) return 'ERROR: write_file not enabled for this agent';
          return toolWrite(extras.writeRoot, input as { path: string; content: string });
        case 'run_command':
          if (!extras?.runCommandRoot || !extras?.runCommandAllowed) return 'ERROR: run_command not enabled';
          return toolRunCommand(extras.runCommandAllowed, extras.runCommandRoot, input as { command: string });
        default: return `ERROR: unknown tool ${name}`;
      }
    } catch (err) {
      return `ERROR: ${String(err)}`;
    }
  };
}

/** Extended tool definitions for the applier agent. */
export const APPLIER_TOOL_DEFS: Anthropic.Messages.Tool[] = [
  ...TOOL_DEFS,
  {
    name: 'write_file',
    description: 'Overwrite a file in the Cosmos repo. Use after read_file to apply edits. Path is relative to the cosmos repo root, e.g. "src/scenarios/topics.ts".',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to cosmos repo root.' },
        content: { type: 'string', description: 'Full new content of the file.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a pre-approved command in the cosmos repo. Currently allowed: "npm run validate". Use after writing edits to confirm Cosmos is still internally consistent.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Exact command string. Must be on the allowlist.' },
      },
      required: ['command'],
    },
  },
];

// ──────────────────────────────────────────────────────────────────
//  Agent loop
// ──────────────────────────────────────────────────────────────────
export interface RunAgentOptions {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxIter: number;
  reposRoot: string;
  /** Tools available to the agent. Defaults to read-only TOOL_DEFS. */
  tools?: Anthropic.Messages.Tool[];
  /** Enable write_file with this directory as the write root. */
  writeRoot?: string;
  /** Enable run_command with this directory as cwd. */
  runCommandRoot?: string;
  /** Commands the agent may run via run_command. Exact-string match. */
  runCommandAllowed?: string[];
  /** Optional per-turn logger. Receives the iteration number and any model text. */
  onTurn?: (iteration: number, text: string) => void;
  /** Optional per-tool-call logger. */
  onTool?: (name: string, input: unknown) => void;
  /** When true, print a compact trace to stdout. */
  verbose?: boolean;
  /**
   * When true, the loop nudges the model if it ends a turn without emitting
   * a markdown JSON code block. Used by agents (like the applier) that
   * tend to announce intent and stop.
   */
  requireJsonReport?: boolean;
  /** Override per-turn token budget. Default 4096; raise for agents that
   * emit full-file write_file content (e.g. applier needs ~16k+).
   */
  maxTokens?: number;
}

export interface AgentUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface AgentResult {
  finalText: string | null;
  iterations: number;
  stoppedReason: 'end_turn' | 'max_iter' | 'unexpected';
  /** Aggregate token usage across all turns in this run. */
  usage: AgentUsage;
  /** The model id used (so cost can be computed downstream). */
  model: string;
}

/** Sum AgentUsage values from many runs/sources. */
export function sumUsage(...usages: (AgentUsage | undefined | null)[]): AgentUsage {
  const total: AgentUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  for (const u of usages) {
    if (!u) continue;
    total.input_tokens += u.input_tokens ?? 0;
    total.output_tokens += u.output_tokens ?? 0;
    total.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
    total.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
  }
  return total;
}

/**
 * Model pricing in USD per 1M tokens, as of mid-2026.
 * Pulled from https://www.anthropic.com/pricing — update if rates change.
 */
const MODEL_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-sonnet-4-6':  { input: 3,    output: 15,  cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-opus-4-7':    { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-haiku-4-5':   { input: 0.80, output: 4,   cacheWrite: 1,     cacheRead: 0.08 },
};

/** Estimate USD cost from token counts. Returns 0 for unknown models. */
export function estimateCost(usage: AgentUsage, model: string): number {
  const baseModel = model.replace(/-\d{8}$/, ''); // strip date suffix if any
  const p = MODEL_PRICING[baseModel] ?? MODEL_PRICING[model];
  if (!p) return 0;
  return (
    (usage.input_tokens                  * p.input)      / 1_000_000 +
    (usage.output_tokens                 * p.output)     / 1_000_000 +
    (usage.cache_creation_input_tokens   * p.cacheWrite) / 1_000_000 +
    (usage.cache_read_input_tokens       * p.cacheRead)  / 1_000_000
  );
}

export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const client = new Anthropic();
  const dispatch = createDispatcher(opts.reposRoot, {
    writeRoot: opts.writeRoot,
    runCommandRoot: opts.runCommandRoot,
    runCommandAllowed: opts.runCommandAllowed,
  });
  const tools = opts.tools ?? TOOL_DEFS;
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: opts.userPrompt },
  ];

  let iteration = 0;
  let finalText: string | null = null;
  let stoppedReason: AgentResult['stoppedReason'] = 'max_iter';
  const usage: AgentUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

  while (iteration < opts.maxIter) {
    iteration++;
    const response = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.systemPrompt,
      tools,
      messages,
    });

    const assistantContent: Anthropic.Messages.ContentBlock[] = response.content;
    messages.push({ role: 'assistant', content: assistantContent });

    // Accumulate token usage from this turn (every response carries it).
    if (response.usage) {
      usage.input_tokens                  += response.usage.input_tokens                  ?? 0;
      usage.output_tokens                 += response.usage.output_tokens                 ?? 0;
      usage.cache_creation_input_tokens   += response.usage.cache_creation_input_tokens   ?? 0;
      usage.cache_read_input_tokens       += response.usage.cache_read_input_tokens       ?? 0;
    }

    if (opts.verbose) {
      const toolCount = assistantContent.filter(b => b.type === 'tool_use').length;
      console.log(`[turn ${iteration}] stop_reason=${response.stop_reason}  tool_uses=${toolCount}`);
    }

    for (const block of assistantContent) {
      if (block.type === 'text' && block.text.trim()) {
        if (opts.verbose) console.log(`[turn ${iteration}] ${block.text.trim()}\n`);
        opts.onTurn?.(iteration, block.text);
      }
    }

    if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
      const turnText = assistantContent
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n');

      // Premature exit detection: if a JSON report is required and the
      // model ended without emitting one, nudge it and continue.
      if (opts.requireJsonReport && !turnText.match(/```json/)) {
        const nudge = `STOP — you ended your turn without emitting any tool_use block AND without the final JSON report. This is the failure mode the prompt warned about. Continue NOW: either call write_file / read_file / run_command to make progress, OR — if every edit is applied and validate passed — emit the final JSON report inside a \`\`\`json code block. Do NOT announce; act.`;
        if (opts.verbose) console.log(`  ⚠ nudging model — no tool_use, no JSON report`);
        messages.push({ role: 'user', content: nudge });
        continue;
      }

      finalText = turnText;
      stoppedReason = 'end_turn';
      break;
    }

    if (response.stop_reason !== 'tool_use') {
      stoppedReason = 'unexpected';
      break;
    }

    const toolUses = assistantContent.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = toolUses.map(use => {
      if (opts.verbose) console.log(`  ↳ tool: ${use.name}(${JSON.stringify(use.input)})`);
      opts.onTool?.(use.name, use.input);
      const out = dispatch(use.name, use.input);
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: out.length > 32_000 ? out.slice(0, 32_000) + '\n…[truncated]' : out,
      };
    });

    messages.push({ role: 'user', content: toolResults });
  }

  return { finalText, iterations: iteration, stoppedReason, usage, model: opts.model };
}

// ──────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────
export function extractJsonReport<T = unknown>(finalText: string): T | null {
  const m = finalText.match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try { return JSON.parse(m[1]) as T; } catch { return null; }
}
