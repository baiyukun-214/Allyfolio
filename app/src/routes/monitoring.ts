import type { FastifyInstance, FastifyRequest } from 'fastify';
import { all, get, run, now } from '../db.ts';
import { html } from '../lib/html.ts';
import { csrfField } from '../lib/csrf.ts';
import type { Ctx } from '../lib/auth.ts';
import { planOf, canPdf } from '../lib/plans.ts';
import { enqueue, hasPendingScan } from '../jobs/queue.ts';
import { IMPACTS } from '../lib/scanner.ts';
import { requireUser, render, back, ownSite } from './guard.ts';

export const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : '–';
const NOTE = html`<p class="notice"><strong>Automated checks are partial.</strong> They find roughly 57% of accessibility issues (Deque study). Manual review by people is still needed – for example for meaningful alt text, focus order and understandable content.</p>`;

export function siteDetailExtras(req: FastifyRequest, ctx: Ctx, s: any) {
  const plan = planOf(ctx.team.plan);
  const scans = all<any>('SELECT * FROM scans WHERE site_id = ? ORDER BY created_at DESC LIMIT 100', s.id);
  const pending = hasPendingScan(s.id);
  return html`
    <section class="grid g3" aria-label="Monitoring status">
      <div class="card"><p class="muted small">Schedule</p><p class="stat">${plan.frequency ? (plan.frequency === 'daily' ? 'Daily' : 'Weekly') : 'None'}</p><p class="small muted">Next: ${fmt(s.next_scan_at)}</p></div>
      <div class="card"><p class="muted small">Page limit per scan</p><p class="stat">${plan.pagesPerSite || '–'}</p><p class="small muted">${plan.name} plan</p></div>
      <div class="card"><p class="muted small">History kept</p><p class="stat">${plan.retentionMonths} months</p><p class="small muted">Timestamped, append-only</p></div>
    </section>
    <div class="row" style="margin-top:16px">
      ${plan.frequency ? html`<form method="post" action="/app/sites/${s.id}/scan">${csrfField(req)}<button class="btn btn-primary" type="submit" ${pending ? 'disabled' : ''}>${pending ? 'Scan queued…' : 'Scan now'}</button></form>` : ''}
      ${ctx.team.oneoff_credits > 0 ? html`<form method="post" action="/app/sites/${s.id}/oneoff">${csrfField(req)}<button class="btn btn-secondary" type="submit" ${pending ? 'disabled' : ''}>Run one-off report scan (${ctx.team.oneoff_credits} left)</button></form>` : ''}
      ${plan.statement ? html`<a class="btn btn-secondary" href="/app/sites/${s.id}/statement">Draft accessibility statement</a>` : ''}
    </div>
    <h2>Scan history (evidence trail)</h2>
    ${scans.length ? html`<div class="card table-wrap" style="padding:8px 16px"><table><caption class="sr-only">Scan history, newest first</caption>
      <thead><tr><th scope="col">Finished</th><th scope="col">Type</th><th scope="col">Pages</th><th scope="col">Critical / serious / moderate / minor</th><th scope="col">New / fixed</th><th scope="col">Evidence hash</th></tr></thead><tbody>
      ${scans.map((c) => html`<tr><td>${c.status === 'done' ? html`<a href="/app/scans/${c.id}">${fmt(c.finished_at)}</a>` : html`<span class="pill">${c.status}</span>`}</td><td>${c.kind}</td><td>${c.pages_scanned}</td>
        <td>${c.critical} / ${c.serious} / ${c.moderate} / ${c.minor}</td><td>${c.new_issues ?? '–'} / ${c.fixed_issues ?? '–'}</td><td><code>${(c.evidence_hash ?? '').slice(0, 12)}</code></td></tr>`)}
    </tbody></table></div>` : html`<p class="muted">No scans yet.${pending ? ' The first scan is queued.' : ''}</p>`}`;
}

export async function monitoringRoutes(app: FastifyInstance) {
  app.post('/app/sites/:id/scan', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const s = ownSite(ctx, (req.params as any).id); if (!s?.verified_at) return reply.code(404).send();
    if (!planOf(ctx.team.plan).frequency) return back(reply, `/app/sites/${s.id}`, 'err', 'Choose a plan to run scans.');
    if (!hasPendingScan(s.id)) enqueue('site_scan', { siteId: s.id, kind: 'manual' });
    return back(reply, `/app/sites/${s.id}`, 'ok', 'Scan queued. Refresh the page in a few minutes.');
  });
  app.post('/app/sites/:id/oneoff', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const s = ownSite(ctx, (req.params as any).id); if (!s?.verified_at) return reply.code(404).send();
    const ok = run('UPDATE teams SET oneoff_credits = oneoff_credits - 1 WHERE id = ? AND oneoff_credits > 0', ctx.team.id).changes;
    if (!ok) return back(reply, `/app/sites/${s.id}`, 'err', 'No one-off report credit left.');
    enqueue('site_scan', { siteId: s.id, kind: 'oneoff' });
    return back(reply, `/app/sites/${s.id}`, 'ok', 'One-off scan queued (up to 100 pages).');
  });

  app.get('/app/scans/:id', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const scan = get<any>('SELECT c.*, s.name AS site_name, s.origin, s.id AS sid FROM scans c JOIN sites s ON s.id = c.site_id WHERE c.id = ? AND s.team_id = ?', (req.params as any).id, ctx.team.id);
    if (!scan) return render(reply, ctx, { title: 'Not found', body: html`<h1>Scan not found</h1>` }, 404);
    const issues = all<any>('SELECT * FROM scan_issues WHERE scan_id = ? ORDER BY id', scan.id);
    const prev = get<any>("SELECT id FROM scans WHERE site_id = ? AND status = 'done' AND finished_at < ? ORDER BY finished_at DESC LIMIT 1", scan.site_id, scan.finished_at);
    const prevFps = new Set(prev ? all<any>('SELECT fingerprint FROM scan_issues WHERE scan_id = ?', prev.id).map((r) => r.fingerprint) : []);
    const fixed = prev ? all<any>('SELECT * FROM scan_issues WHERE scan_id = ? AND fingerprint NOT IN (SELECT fingerprint FROM scan_issues WHERE scan_id = ?)', prev.id, scan.id) : [];
    const rules = new Map<string, any>();
    for (const i of issues) { const r = rules.get(i.rule_id) ?? { ...i, nodes: [], isNew: 0 }; r.nodes.push(i); if (prev && !prevFps.has(i.fingerprint)) r.isNew++; rules.set(i.rule_id, r); }
    const plan = planOf(ctx.team.plan);
    return render(reply, ctx, { title: `Scan of ${scan.site_name}`, current: '/app', body: html`
      <p><a href="/app/sites/${scan.sid}">← ${scan.site_name}</a></p>
      <h1>Scan of ${scan.site_name}</h1>
      <p class="muted">Finished ${fmt(scan.finished_at)} · ${scan.pages_scanned} page${scan.pages_scanned === 1 ? '' : 's'} (limit ${scan.page_limit}) · evidence hash <code>${scan.evidence_hash}</code></p>
      <div class="row">${canPdf(plan, scan.kind === 'oneoff') ? html`<a class="btn btn-primary" href="/app/scans/${scan.id}/report.pdf">Download PDF report</a>` : ''}<a class="btn btn-secondary" href="/app/scans/${scan.id}/report">View printable report</a></div>
      <dl class="grid g4" style="margin-top:16px">${IMPACTS.map((k) => html`<div class="card imp-${k}" style="border:0"><dt class="small">${k[0].toUpperCase() + k.slice(1)}</dt><dd class="stat" style="margin:0">${scan[k]}</dd></div>`)}</dl>
      ${prev ? html`<p class="small" style="margin-top:12px"><strong>${scan.new_issues}</strong> new and <strong>${scan.fixed_issues}</strong> fixed compared with the previous scan.</p>` : html`<p class="small muted" style="margin-top:12px">This is the first scan, so there is nothing to compare yet.</p>`}
      ${NOTE}
      <h2>Issues by rule</h2>
      ${[...rules.values()].sort((a, b) => IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(b.impact)).map((r) => html`
        <details class="card" style="margin-bottom:8px"><summary><span class="pill imp-${r.impact}">${r.impact}</span> <strong>${r.help}</strong> – ${r.nodes.length} element${r.nodes.length === 1 ? '' : 's'}${r.isNew ? html` · <span class="pill">${r.isNew} new</span>` : ''}</summary>
          <p class="small muted" style="margin-top:8px">${r.wcag || 'Best practice'} · <a href="${r.help_url}">How to fix (Deque University)</a></p>
          <div class="table-wrap"><table><caption class="sr-only">Affected elements</caption><thead><tr><th scope="col">Page</th><th scope="col">Element</th></tr></thead><tbody>
          ${r.nodes.slice(0, 50).map((n: any) => html`<tr><td>${new URL(n.page_url).pathname}</td><td><code>${n.target}</code></td></tr>`)}</tbody></table></div>
          ${r.nodes.length > 50 ? html`<p class="small muted">And ${r.nodes.length - 50} more.</p>` : ''}
        </details>`)}
      ${!issues.length ? html`<p>No issues found by automated checks.</p>` : ''}
      ${fixed.length ? html`<h2>Fixed since the previous scan</h2><ul>${[...new Map(fixed.map((f) => [f.rule_id + f.target, f])).values()].slice(0, 100).map((f: any) => html`<li>${f.help} – <code>${f.target}</code> on ${new URL(f.page_url).pathname}</li>`)}</ul>` : ''}` });
  });
}
