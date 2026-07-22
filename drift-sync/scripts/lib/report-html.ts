/**
 * HTML report generator for sync-nightly dry-runs.
 *
 * Self-contained — inlines all CSS so the artifact opens in any browser
 * with no build step. Matches the cosmos dark theme (oklch service hues,
 * Space Grotesk + Instrument Serif fonts) used by docs/drift-sync.html.
 */

interface CosmosEdit { file: string; rationale: string; patch_hint?: string; }
interface Change {
  kind: string; description: string; evidence: string[];
  proposed_cosmos_edits: CosmosEdit[];
}
interface Verdict {
  verdict: 'drift' | 'no_drift' | 'inconclusive';
  confidence?: 'high' | 'medium' | 'low';
  service: string;
  team?: string;
  from_sha: string;
  to_sha: string;
  changes: Change[];
  summary: string;
}
interface RepoResult {
  repo: string;
  ok: boolean;
  verdict?: Verdict;
  error?: string;
  durationMs: number;
}
interface ApplierResult {
  team: string;
  verdicts_count: number;
  iterations: number;
  applier_report: {
    applied?: { verdict_service: string; file: string; summary: string }[];
    skipped?: { verdict_service: string; reason: string }[];
    validator_passed?: boolean;
    summary?: string;
  } | null;
  diff: string;
  diff_line_count: number;
  dry_run_reverted: boolean;
  pr_url?: string;
}

export interface ReportData {
  runAt: string;
  durationMs: number;
  concurrency: number;
  results: RepoResult[];
  byTeam: Map<string, RepoResult[]>;
  applierResults: Map<string, ApplierResult>;
  applierSkipReason: string | null;
}

const STYLES = `
@property --hue-shift { syntax: '<angle>'; initial-value: 0deg; inherits: false; }

:root {
  --font-display: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-serif:   'Instrument Serif', 'Times New Roman', Georgia, serif;
  --font-mono:    'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
  --svc-cyan:    oklch(0.80 0.13 210);
  --svc-green:   oklch(0.80 0.13 158);
  --svc-amber:   oklch(0.82 0.14  88);
  --svc-red:     oklch(0.70 0.18  22);
  --svc-violet:  oklch(0.76 0.14 295);
  --svc-blue:    oklch(0.72 0.16 258);
  --svc-pink:    oklch(0.76 0.14 350);
  --svc-magenta: oklch(0.76 0.16 320);
  --svc-orange:  oklch(0.76 0.16  56);
  --svc-teal:    oklch(0.80 0.13 188);
  --svc-yellow:  oklch(0.84 0.16  82);
  --svc-rose:    oklch(0.74 0.18  10);
  --svc-purple:  oklch(0.72 0.18 305);
  --svc-emerald: oklch(0.74 0.16 152);
  --bg:           #0B0C0E;
  --bg-deep:      #050608;
  --bg-surface:   #111316;
  --bg-surface-2: #15181C;
  --border:       #1F2328;
  --border-strong:#2E343B;
  --text:         #C9CDD3;
  --text-dim:     #7A8088;
  --text-bright:  #FAFBFC;
  --text-faint:   #4A5058;
  --ok: var(--svc-emerald); --warn: var(--svc-amber);
  --bad: var(--svc-red);    --info: var(--svc-cyan);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg-deep);
  color: var(--text);
  font-family: var(--font-display);
  font-size: 15px;
  line-height: 1.62;
  letter-spacing: -0.008em;
  min-height: 100vh;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}
.backdrop {
  position: fixed; inset: 0; z-index: -2;
  background:
    radial-gradient(ellipse at 20% 0%, oklch(0.20 0.05 280 / 0.4), transparent 50%),
    radial-gradient(ellipse at 80% 100%, oklch(0.20 0.05 210 / 0.3), transparent 50%),
    var(--bg-deep);
}
.stars { position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: 0.45; }
.stars::before {
  content: ''; position: absolute; inset: 0;
  background-image:
    radial-gradient(1px 1px at 13% 22%, #fff, transparent),
    radial-gradient(1px 1px at 47% 11%, oklch(0.85 0.1 200), transparent),
    radial-gradient(1px 1px at 83% 71%, #fff, transparent),
    radial-gradient(2px 2px at 71% 33%, oklch(0.9 0.05 290), transparent),
    radial-gradient(1px 1px at 28% 91%, #fff, transparent),
    radial-gradient(1px 1px at 9% 54%, oklch(0.85 0.1 90), transparent),
    radial-gradient(1px 1px at 92% 17%, #fff, transparent),
    radial-gradient(1px 1px at 56% 86%, oklch(0.85 0.1 350), transparent),
    radial-gradient(2px 2px at 34% 47%, #fff, transparent),
    radial-gradient(1px 1px at 64% 8%, #fff, transparent);
  background-size: 800px 800px;
}
.shell { max-width: 1100px; margin: 0 auto; padding: 64px 32px 120px; }
section { margin-bottom: 80px; }
.eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px; font-weight: 500;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 18px;
}
.eyebrow::before { content: ''; width: 24px; height: 1px; background: currentColor; }
h1 {
  font-family: var(--font-display);
  font-size: clamp(40px, 6vw, 72px);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1;
  margin: 0 0 16px;
  color: var(--text-bright);
}
h1 em {
  font-family: var(--font-serif); font-style: italic; font-weight: 400;
  background: linear-gradient(105deg, var(--svc-cyan) 0%, var(--svc-violet) 50%, var(--svc-amber) 100%);
  background-clip: text; -webkit-background-clip: text; color: transparent;
}
h2 {
  font-family: var(--font-display);
  font-size: clamp(28px, 3.5vw, 40px);
  font-weight: 600;
  letter-spacing: -0.025em;
  margin: 0 0 24px;
  color: var(--text-bright);
}
h3 {
  font-family: var(--font-display);
  font-size: 20px; font-weight: 600;
  letter-spacing: -0.015em;
  margin: 0 0 12px;
  color: var(--text-bright);
}
p { margin: 0 0 16px; max-width: 64ch; }
p.lead { font-size: 18px; line-height: 1.5; color: var(--text); }
.dim { color: var(--text-dim); }
.bright { color: var(--text-bright); }
strong { color: var(--text-bright); font-weight: 600; }
code {
  font-family: var(--font-mono); font-size: 0.88em;
  background: var(--bg-surface); border: 1px solid var(--border);
  border-radius: 3px; padding: 1px 6px; color: var(--text-bright);
}
.kpi {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px;
  background: var(--border); border: 1px solid var(--border);
  margin: 32px 0 48px;
}
.kpi > div {
  background: var(--bg); padding: 28px 20px; position: relative;
}
.kpi > div::before {
  content: ''; position: absolute; top: 0; left: 0;
  width: 32px; height: 1px; background: var(--accent, var(--svc-cyan));
}
.kpi-val {
  font-family: var(--font-display);
  font-size: 44px; font-weight: 600; letter-spacing: -0.04em;
  line-height: 1; color: var(--text-bright);
  display: block; margin-bottom: 6px;
}
.kpi-val .small { font-size: 20px; color: var(--text-dim); font-weight: 500; margin-left: 2px; }
.kpi-lbl {
  font-family: var(--font-mono);
  font-size: 10px; letter-spacing: 0.2em;
  text-transform: uppercase; color: var(--text-dim);
}
@media (max-width: 800px) { .kpi { grid-template-columns: 1fr 1fr; } }
table.bucket {
  width: 100%;
  border-collapse: collapse;
  margin: 24px 0;
  background: var(--bg-surface);
  border: 1px solid var(--border);
}
table.bucket th, table.bucket td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
table.bucket th {
  font-family: var(--font-mono);
  font-size: 10px; letter-spacing: 0.2em;
  text-transform: uppercase; color: var(--text-dim);
  font-weight: 500;
}
table.bucket td { color: var(--text); }
table.bucket .v-drift { color: var(--bad); font-weight: 600; }
table.bucket .v-no_drift { color: var(--ok); }
table.bucket .v-inconclusive { color: var(--warn); }
table.bucket .v-error { color: var(--text-faint); }
.team-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  padding: 32px;
  margin-bottom: 24px;
  position: relative;
}
.team-card::before {
  content: ''; position: absolute; top: 0; left: 0;
  width: 48px; height: 2px; background: var(--accent, var(--svc-cyan));
}
.team-header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
.team-name {
  font-family: var(--font-mono);
  font-size: 12px; letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--accent, var(--svc-cyan));
}
.team-pr {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
}
.team-pr a { color: var(--svc-cyan); text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 150ms; }
.team-pr a:hover { border-bottom-color: currentColor; }
.verdict-row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 16px; align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 12px;
}
.verdict-row:last-child { border-bottom: none; }
.verdict-row .svc { color: var(--text-bright); font-weight: 500; }
.verdict-row .v-tag { font-size: 10px; padding: 3px 8px; border-radius: 2px; letter-spacing: 0.15em; text-transform: uppercase; }
.v-tag.drift { background: oklch(from var(--bad) l c h / 0.15); color: var(--bad); border: 1px solid oklch(from var(--bad) l c h / 0.4); }
.v-tag.no_drift { background: oklch(from var(--ok) l c h / 0.1); color: var(--ok); border: 1px solid oklch(from var(--ok) l c h / 0.3); }
.v-tag.inconclusive { background: oklch(from var(--warn) l c h / 0.15); color: var(--warn); border: 1px solid oklch(from var(--warn) l c h / 0.4); }
.v-tag.error { color: var(--text-faint); border: 1px solid var(--border); }
.verdict-row .dur { color: var(--text-dim); }
details {
  margin: 24px 0;
  background: var(--bg-surface);
  border: 1px solid var(--border);
}
details summary {
  padding: 14px 20px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text);
  list-style: none;
  user-select: none;
}
details summary::-webkit-details-marker { display: none; }
details summary::before { content: '▸ '; color: var(--svc-cyan); margin-right: 4px; transition: transform 150ms; }
details[open] summary::before { content: '▾ '; }
details summary:hover { color: var(--text-bright); }
details > div, details > pre, details > table { padding: 0 20px 20px; }
pre {
  font-family: var(--font-mono); font-size: 12px; line-height: 1.55;
  color: var(--text);
  background: var(--bg-deep);
  border-left: 2px solid var(--svc-cyan);
  padding: 16px 20px;
  margin: 0;
  overflow-x: auto;
  white-space: pre;
}
pre .add { color: var(--svc-emerald); }
pre .rem { color: var(--svc-red); }
pre .meta { color: var(--text-faint); }
.banner-ok {
  background: linear-gradient(180deg, oklch(0.20 0.04 158 / 0.3), var(--bg-surface) 80%);
  border: 1px solid var(--border);
  padding: 48px 32px;
  text-align: center;
  margin: 32px 0;
}
.banner-ok .big {
  font-family: var(--font-serif); font-style: italic; font-size: 36px;
  color: var(--ok); margin-bottom: 8px;
}
.banner-ok .small {
  font-family: var(--font-mono); font-size: 11px;
  letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--text-dim);
}
footer {
  padding: 48px 0 32px;
  border-top: 1px solid var(--border);
  margin-top: 80px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
  letter-spacing: 0.15em; text-transform: uppercase;
}
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightDiff(diff: string): string {
  return diff.split('\n').map(line => {
    const esc = escapeHtml(line);
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff')) {
      return `<span class="meta">${esc}</span>`;
    }
    if (line.startsWith('+')) return `<span class="add">${esc}</span>`;
    if (line.startsWith('-')) return `<span class="rem">${esc}</span>`;
    return esc;
  }).join('\n');
}

/** Accent palette cycled per team — stable for a given team name, no team list to maintain. */
const TEAM_ACCENTS = [
  'var(--svc-cyan)', 'var(--svc-violet)', 'var(--svc-amber)',
  'var(--svc-teal)', 'var(--svc-magenta)', 'var(--svc-emerald)',
];

function teamAccent(team: string): string {
  let h = 0;
  for (let i = 0; i < team.length; i++) h = (h * 31 + team.charCodeAt(i)) >>> 0;
  return TEAM_ACCENTS[h % TEAM_ACCENTS.length];
}

export function buildHtmlReport(data: ReportData): string {
  const { runAt, durationMs, concurrency, results, byTeam, applierResults, applierSkipReason } = data;

  const drifts = results.filter(r => r.ok && r.verdict?.verdict === 'drift');
  const inconclusives = results.filter(r => r.ok && r.verdict?.verdict === 'inconclusive');
  const noDrifts = results.filter(r => r.ok && r.verdict?.verdict === 'no_drift');
  const errors = results.filter(r => !r.ok);

  const date = new Date(runAt);
  const dateFormatted = date.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

  const isZeroDrift = drifts.length === 0 && inconclusives.length === 0 && errors.length === 0;

  return `<!DOCTYPE html>
<html lang="en" data-theme="cosmos">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cosmos Sync — ${dateFormatted}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${STYLES}</style>
</head>
<body>

<div class="backdrop" aria-hidden="true"></div>
<div class="stars"    aria-hidden="true"></div>

<div class="shell">

  <section>
    <div class="eyebrow">Cosmos Sync · Nightly Report</div>
    <h1>${isZeroDrift ? 'All clear.' : `Drift caught.`}<br><em>${dateFormatted}</em></h1>
    <p class="lead">
      ${results.length} repos swept in ${(durationMs / 1000).toFixed(1)}s
      (concurrency ${concurrency}).
      ${isZeroDrift
        ? `<strong>The map matches reality.</strong>`
        : `<strong>${drifts.length} drift verdict${drifts.length === 1 ? '' : 's'}${inconclusives.length > 0 ? `, ${inconclusives.length} inconclusive` : ''}.</strong>`}
    </p>
  </section>

  <section>
    <div class="kpi">
      <div style="--accent: var(--svc-red);">
        <span class="kpi-val">${drifts.length}</span>
        <span class="kpi-lbl">🚨 drift</span>
      </div>
      <div style="--accent: var(--svc-amber);">
        <span class="kpi-val">${inconclusives.length}</span>
        <span class="kpi-lbl">❓ inconclusive</span>
      </div>
      <div style="--accent: var(--svc-emerald);">
        <span class="kpi-val">${noDrifts.length}</span>
        <span class="kpi-lbl">✅ no_drift</span>
      </div>
      <div style="--accent: var(--text-faint);">
        <span class="kpi-val">${errors.length}</span>
        <span class="kpi-lbl">❌ errors</span>
      </div>
    </div>
  </section>

  ${isZeroDrift ? `
  <section>
    <div class="banner-ok">
      <div class="big">No PRs would be opened.</div>
      <div class="small">Every tracked repo is at its baseline — Cosmos is in sync.</div>
    </div>
  </section>
  ` : ''}

  ${byTeam.size > 0 ? `
  <section>
    <div class="eyebrow">Per-team</div>
    <h2>PRs that ${data.applierSkipReason ? '<em>would be</em>' : 'were'} opened</h2>
    ${[...byTeam.entries()].map(([team, items]) => renderTeamCard(team, items, applierResults.get(team) ?? null, applierSkipReason)).join('\n')}
  </section>
  ` : ''}

  <section>
    <div class="eyebrow">Appendix · All verdicts</div>
    <details ${results.length < 30 ? 'open' : ''}>
      <summary>${results.length} verdict${results.length === 1 ? '' : 's'} (click to expand)</summary>
      <table class="bucket" style="margin: 0;">
        <thead>
          <tr><th>Repo</th><th>Verdict</th><th>Confidence</th><th>Changes</th><th style="text-align:right;">Duration</th></tr>
        </thead>
        <tbody>
          ${results.map(r => {
            if (r.ok && r.verdict) {
              const v = r.verdict;
              return `<tr>
                <td><code>${escapeHtml(r.repo)}</code></td>
                <td><span class="v-tag ${v.verdict}">${v.verdict.replace('_', ' ')}</span></td>
                <td class="v-${v.verdict}">${escapeHtml(v.confidence ?? '—')}</td>
                <td class="dim">${v.changes?.length ?? 0}</td>
                <td style="text-align:right;" class="dim">${(r.durationMs / 1000).toFixed(1)}s</td>
              </tr>`;
            }
            return `<tr>
              <td><code>${escapeHtml(r.repo)}</code></td>
              <td><span class="v-tag error">error</span></td>
              <td class="dim">—</td>
              <td class="dim">—</td>
              <td style="text-align:right;" class="dim">${(r.durationMs / 1000).toFixed(1)}s</td>
            </tr>`;
          }).join('\n')}
        </tbody>
      </table>
    </details>
  </section>

  ${errors.length > 0 ? `
  <section>
    <div class="eyebrow">Errors</div>
    ${errors.map(e => `
      <details>
        <summary>${escapeHtml(e.repo)}</summary>
        <pre style="margin-top: 0;">${escapeHtml(e.error ?? '(no message)')}</pre>
      </details>
    `).join('\n')}
  </section>
  ` : ''}

  <footer>
    Auto-generated by <code>scripts/sync-nightly.ts</code> · <code>${dateFormatted}</code> · <code>${(durationMs / 1000).toFixed(1)}s</code>
  </footer>

</div>

</body>
</html>`;
}

function renderTeamCard(team: string, items: RepoResult[], ap: ApplierResult | null, applierSkipReason: string | null): string {
  const accent = teamAccent(team);
  const driftItems = items.filter(r => r.verdict?.verdict === 'drift');
  const inconclusiveItems = items.filter(r => r.verdict?.verdict === 'inconclusive');
  const totalChanges = items.reduce((acc, r) => acc + (r.verdict?.changes?.length ?? 0), 0);

  return `
    <div class="team-card" style="--accent: ${accent};">
      <div class="team-header">
        <div>
          <div class="team-name">team · ${escapeHtml(team)}</div>
          <h3 style="margin-top: 8px;">${driftItems.length} drift${driftItems.length === 1 ? '' : 's'}${inconclusiveItems.length > 0 ? ` · ${inconclusiveItems.length} inconclusive` : ''} · ${totalChanges} finding${totalChanges === 1 ? '' : 's'}</h3>
        </div>
        ${ap?.pr_url ? `<div class="team-pr">→ <a href="${escapeHtml(ap.pr_url)}">${escapeHtml(ap.pr_url.replace(/^https:\/\/github\.com\//, ''))}</a></div>` : ''}
      </div>

      ${items.map(item => {
        const v = item.verdict!;
        return `
          <div class="verdict-row">
            <span class="svc">${escapeHtml(v.service)}</span>
            <span class="v-tag ${v.verdict}">${v.verdict.replace('_', ' ')}</span>
            <span class="dim">${escapeHtml(v.confidence ?? '—')}</span>
            <span class="dur">${(item.durationMs / 1000).toFixed(1)}s</span>
          </div>
          <div style="padding: 8px 0 0 0; color: var(--text); font-size: 14px;">${escapeHtml(v.summary)}</div>

          ${v.changes && v.changes.length > 0 ? `
            <details style="margin-top: 12px;">
              <summary>${v.changes.length} finding${v.changes.length === 1 ? '' : 's'}</summary>
              <div>
                ${v.changes.map(c => `
                  <div style="padding: 12px 0; border-bottom: 1px solid var(--border);">
                    <div style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: ${accent}; margin-bottom: 6px;">${escapeHtml(c.kind)}</div>
                    <div style="color: var(--text);">${escapeHtml(c.description)}</div>
                    ${c.evidence && c.evidence.length > 0 ? `
                      <div style="margin-top: 8px;">
                        ${c.evidence.slice(0, 4).map(e => `<div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); padding: 2px 0;">→ ${escapeHtml(e)}</div>`).join('')}
                        ${c.evidence.length > 4 ? `<div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); padding: 2px 0;">…${c.evidence.length - 4} more</div>` : ''}
                      </div>
                    ` : ''}
                  </div>
                `).join('')}
              </div>
            </details>
          ` : ''}
        `;
      }).join('\n')}

      ${ap && ap.applier_report ? `
        <details style="margin-top: 16px;">
          <summary>Applier · ${ap.applier_report.applied?.length ?? 0} edit${(ap.applier_report.applied?.length ?? 0) === 1 ? '' : 's'} · validator ${ap.applier_report.validator_passed ? '✅' : '❌'} · ${ap.diff_line_count} diff lines · ${ap.iterations} iterations</summary>
          <div>
            ${ap.applier_report.applied && ap.applier_report.applied.length > 0 ? `
              <div style="margin-bottom: 16px;">
                <div style="font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-dim); margin-bottom: 8px;">Applied edits</div>
                ${ap.applier_report.applied.map(e => `<div style="padding: 4px 0;"><code>${escapeHtml(e.file)}</code> — ${escapeHtml(e.summary)}</div>`).join('')}
              </div>
            ` : ''}
            ${ap.applier_report.skipped && ap.applier_report.skipped.length > 0 ? `
              <div style="margin-bottom: 16px;">
                <div style="font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--warn); margin-bottom: 8px;">Skipped</div>
                ${ap.applier_report.skipped.map(s => `<div style="padding: 4px 0;"><code>${escapeHtml(s.verdict_service)}</code> — ${escapeHtml(s.reason)}</div>`).join('')}
              </div>
            ` : ''}
            ${ap.diff ? `<pre style="margin-top: 12px;">${highlightDiff(ap.diff.split('\n').slice(0, 400).join('\n'))}${ap.diff_line_count > 400 ? `\n<span class="meta">…[${ap.diff_line_count - 400} more lines]</span>` : ''}</pre>` : ''}
          </div>
        </details>
      ` : (applierSkipReason ? `<div style="margin-top: 16px; font-family: var(--font-mono); font-size: 11px; color: var(--text-dim);">Applier skipped — ${escapeHtml(applierSkipReason.split('\n')[0])}</div>` : '')}
    </div>
  `;
}
