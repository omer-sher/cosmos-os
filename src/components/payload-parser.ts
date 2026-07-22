/**
 * Tiny parser that splits a step payload string into structured
 * sections so the UI can put the "endpoint" line and the "Headers:" /
 * "Body:" labels OUTSIDE the code block, with only the actual JSON
 * inside <pre> blocks.
 *
 * Recognises these payload styles:
 *   1. HTTP request:
 *        POST /url          → heading
 *        Headers:           → label
 *          Content-Type:... → code (headers)
 *        Body:              → label
 *          { json }         → code (body)
 *        // 201 Created     → comment (response label)
 *        { json }           → code (response body)
 *
 *   2. Kafka record:
 *        // Kafka record on topic   → comment (context)
 *        { json }                   → code (body)
 *
 *   3. Binary / schema:
 *        // comment lines           → comment
 *        table X { ... }            → code
 */

export type PayloadSectionKind = 'heading' | 'label' | 'code' | 'comment';

export interface PayloadSection {
  kind: PayloadSectionKind;
  content: string;
}

const VERB = /^(POST|GET|PUT|DELETE|PATCH|HEAD|OPTIONS)\s/;
const HEADERS_LABEL = /^Headers:\s*$/;
const BODY_LABEL = /^Body:\s*$/;
const COMMENT = /^\s*\/\//;

export function parsePayload(raw: string): PayloadSection[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: PayloadSection[] = [];
  let i = 0;

  // Endpoint heading at top, e.g. "POST /v1/orders"
  // or "PUT s3://bucket/key" (PUT verb).
  if (lines[0] && VERB.test(lines[0])) {
    out.push({ kind: 'heading', content: lines[0].trim() });
    i = 1;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    // Subsequent verb lines (e.g. multiple GET/PUT requests in one payload).
    // Treat them as additional headings so the parser advances and never loops.
    if (VERB.test(line)) {
      out.push({ kind: 'heading', content: line.trim() });
      i++;
      continue;
    }

    // Headers: → label + code block
    if (HEADERS_LABEL.test(line)) {
      out.push({ kind: 'label', content: 'Headers' });
      i++;
      const block: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === '') { i++; break; }
        if (BODY_LABEL.test(l) || HEADERS_LABEL.test(l) || VERB.test(l) || COMMENT.test(l)) break;
        // Source uses 2-space indentation under "Headers:"; strip it.
        block.push(l.replace(/^ {2}/, ''));
        i++;
      }
      pushCode(out, block);
      continue;
    }

    // Body: → label + code block
    if (BODY_LABEL.test(line)) {
      out.push({ kind: 'label', content: 'Body' });
      i++;
      const block: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        // Stop at a recognised next-section marker.
        if (HEADERS_LABEL.test(l) || BODY_LABEL.test(l) || VERB.test(l)) break;
        // Stop at "// 200 OK" / "// 201 Created" style response markers
        // so the response is its own section.
        if (block.length > 0 && /^\s*\/\/\s*\d{3}\b/.test(l)) break;
        block.push(l);
        i++;
      }
      pushCode(out, block);
      continue;
    }

    // Run of // comment lines → comment block (outside code).
    if (COMMENT.test(line)) {
      const block: string[] = [];
      while (i < lines.length && COMMENT.test(lines[i])) {
        block.push(lines[i].replace(/^\s*\/\/\s?/, ''));
        i++;
      }
      out.push({ kind: 'comment', content: block.join('\n') });
      continue;
    }

    // Generic code run (JSON / FlatBuffer schema / other).
    const block: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (HEADERS_LABEL.test(l) || BODY_LABEL.test(l) || VERB.test(l)) break;
      // Stop at a comment ONLY if we already have content — else keep going.
      if (block.length > 0 && COMMENT.test(l)) break;
      block.push(l);
      i++;
    }
    pushCode(out, block);
  }

  return out;
}

function pushCode(out: PayloadSection[], block: string[]) {
  while (block.length && block[block.length - 1].trim() === '') block.pop();
  while (block.length && block[0].trim() === '') block.shift();
  if (block.length) out.push({ kind: 'code', content: block.join('\n') });
}
