/**
 * Prefilter — decides whether a diff is worth invoking Claude on.
 *
 * Two layers, plus one escape hatch:
 *  1. Path filter: skip tests, lockfiles, build output. Restrict to source
 *     file extensions (TS/JS/Go/Py/etc) plus a YAML whitelist for files
 *     that commonly carry topic-name env vars.
 *  2. Content regex: applied to changed lines (`git diff --unified=0`).
 *     Patterns target Kafka producers/consumers, route decorators, WS
 *     handlers, and event-identity constants.
 *  3. Payload-shape escape hatch: files that DEFINE a payload/contract
 *     (event classes, DTOs, request/response + validation schemas, payload
 *     type defs) pass on PATH alone, regardless of content hits. Their drift
 *     is a field add/remove (e.g. a new `modifications?` on a request body),
 *     which is invisible to the call-site patterns in layer 2.
 *
 * Designed to favor false positives — when in doubt, invoke Claude. False
 * negatives (real drift skipped silently) are worse than the cost of an
 * extra agent call that returns "no_drift".
 */

const PATH_EXCLUDE_PATTERNS: RegExp[] = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__\//,
  /__mocks__\//,
  /node_modules\//,
  /dist\//,
  /build\//,
  /\.next\//,
  /coverage\//,
  /\.d\.ts$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
];

/** Extensions that are source-of-truth-ish for service behavior. */
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|go|py|java|kt|cpp|h|hpp|proto)$/i;

/**
 * YAML/sh files we keep — these commonly hold topic-name env vars or
 * helm values that shape runtime behavior.
 */
const RELEVANT_YAML_OR_SH = /(values(-[\w-]+)?\.ya?ml|\.env\.ya?ml|Chart\.ya?ml|loadEnv\.sh|setup-env\.sh|topics\.ya?ml)$/i;

/** True if this file is the kind we want to inspect in a diff. */
export function isCosmosRelevantFile(filepath: string): boolean {
  if (PATH_EXCLUDE_PATTERNS.some(p => p.test(filepath))) return false;
  if (SOURCE_EXTENSIONS.test(filepath)) return true;
  if (RELEVANT_YAML_OR_SH.test(filepath)) return true;
  return false;
}

/**
 * Files whose Cosmos-relevant drift lives in their SHAPE, not in call-site
 * syntax: event payload classes, DTOs, request/response + validation schemas,
 * and payload type definitions. A field added to one of these — e.g. a new
 * `modifications?: ModificationOverride` on a request body or published event —
 * never matches the call-site CONTENT_PATTERNS below, so it would otherwise be
 * filtered out silently. Match these by path and let Claude judge the shape.
 */
const PAYLOAD_SHAPE_FILE =
  /(?:\.event|\.dto|\.schema|\.payload|[.-]types?|[.-]contract)\.[jt]sx?$|(?:^|\/)(?:events?|dtos?|payloads?|validations?|validators?|schemas?|contracts?|types)\//i;

/** True if this file defines a payload/contract shape (fields carry the drift). */
export function definesPayloadShape(filepath: string): boolean {
  if (PATH_EXCLUDE_PATTERNS.some(p => p.test(filepath))) return false;
  return PAYLOAD_SHAPE_FILE.test(filepath);
}

/**
 * Content patterns that indicate a change Cosmos might care about.
 * Applied to changed lines only (additions/deletions from --unified=0).
 */
const CONTENT_PATTERNS: RegExp[] = [
  // Kafka producers
  /kafka(Service|Client|Producer)?\.(send|produce|publish)\s*\(/,
  /\bproducer\.send\s*\(/,
  /\bV[2-9]\.Events\.\w+/,
  /\bnew\s+\w+Event\s*\(/,
  /\bnew\s+\w+Response\s*\(/,
  /\bnew\s+\w+Request\s*\(/,

  // Kafka consumers
  /@(\w*Event|Message)Pattern\b/,
  /@EventHandler\b/,
  /@SubscribeMessage\b/,
  /\bconsumer\.subscribe\s*\(/,
  /\bconsumer\.run\s*\(/,

  // Event/topic identity
  /\bEVENT_NAME\s*=/,
  /\bKAFKA_\w*_TOPIC\b/,
  /\b\w+_EVENTS?_TOPIC\b/,

  // HTTP routes
  /@(Controller|Get|Post|Put|Delete|Patch)\b/,
  /\b(app|router|server)\.(get|post|put|delete|patch)\s*\(/,
  /\.route\s*\(/,

  // WebSocket
  /\bnew\s+WebSocket\b/,
  /\bws\.on\s*\(/,
  /\bsocket\.on\s*\(/,
];

const COMBINED_CONTENT = new RegExp(CONTENT_PATTERNS.map(p => p.source).join('|'));

/**
 * Returns the changed-line matches in a unified=0 diff that look
 * cosmos-relevant. Returns [] if nothing interesting.
 */
export function contentMatchesInDiff(unifiedZeroDiff: string): string[] {
  const hits: string[] = [];
  for (const line of unifiedZeroDiff.split('\n')) {
    // Only changed content (additions / deletions), not diff metadata.
    if (line.length < 2) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (!(line.startsWith('+') || line.startsWith('-'))) continue;
    const payload = line.slice(1);
    if (COMBINED_CONTENT.test(payload)) hits.push(line);
  }
  return hits;
}

/**
 * High-level prefilter decision.
 * Returns either { skip: true, reason } or { skip: false, matches, files }.
 */
export interface PrefilterDecision {
  skip: boolean;
  reason?: string;
  /** Cosmos-relevant changed files (post path filter). */
  files: string[];
  /** Changed lines matching the content regex (post content filter). */
  contentHits: string[];
}

export function prefilterDecision(
  changedFiles: string[],
  diffUnifiedZero: string,
): PrefilterDecision {
  const relevantFiles = changedFiles.filter(isCosmosRelevantFile);
  if (relevantFiles.length === 0) {
    return { skip: true, reason: 'no source files changed', files: [], contentHits: [] };
  }
  const contentHits = contentMatchesInDiff(diffUnifiedZero);
  // Payload-shape files (event/DTO/schema/validation/types) carry drift as a
  // field add/remove, which never matches the call-site content patterns. Let
  // them through on path alone so Claude can judge the shape change.
  const payloadFiles = relevantFiles.filter(definesPayloadShape);
  if (contentHits.length === 0 && payloadFiles.length === 0) {
    return { skip: true, reason: 'no cosmos-relevant content patterns', files: relevantFiles, contentHits: [] };
  }
  return { skip: false, files: relevantFiles, contentHits };
}
