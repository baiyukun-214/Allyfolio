import type { FastifyInstance } from 'fastify';
import { get, run } from '../db.ts';
import { html } from '../lib/html.ts';
import { planOf, canPdf } from '../lib/plans.ts';
import { brandingFor, reportHtml, reportPdf } from '../lib/report.ts';
import { draftStatement } from '../lib/statement.ts';
import { contrast } from '../lib/contrast.ts';
import { csrfField } from '../lib/csrf.ts';
import { requireUser, render, back, ownSite } from './guard.ts';

export async function reportRoutes(app: FastifyInstance) {
  const scanFor = (ctx: any, id: string) => get<any>("SELECT c.* FROM scans c JOIN sites s ON s.id = c.site_id WHERE c.id = ? AND s.team_id = ? AND c.status = 'done'", id, ctx.team.id);

  app.get('/app/scans/:id/report', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const scan = scanFor(ctx, (req.params as any).id); if (!scan) return reply.code(404).send('Not found');
    return reply.type('text/html').send(reportHtml(scan.id, await brandingFor(ctx.team)));
  });

  app.get('/app/scans/:id/report.pdf', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const scan = scanFor(ctx, (req.params as any).id); if (!scan) return reply.code(404).send('Not found');
    if (!canPdf(planOf(ctx.team.plan), scan.kind === 'oneoff')) return back(reply, `/app/scans/${scan.id}`, 'err', 'PDF export is part of the Business and Agency plans and the one-off report.');
    const pdf = await reportPdf(scan.id, await brandingFor(ctx.team));
    return reply.type('application/pdf').header('content-disposition', `attachment; filename="accessibility-report-${scan.finished_at.slice(0, 10)}.pdf"`).send(pdf);
  });

  app.get('/app/sites/:id/statement', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const s = ownSite(ctx, (req.params as any).id); if (!s) return reply.code(404).send();
    if (!planOf(ctx.team.plan).statement) return back(reply, `/app/sites/${s.id}`, 'err', 'The statement generator is part of all paid plans.');
    const md = draftStatement(s.id, ctx.team.brand_name || ctx.team.name);
    if ((req.query as any).download) return reply.type('text/markdown; charset=utf-8').header('content-disposition', 'attachment; filename="accessibility-statement-draft.md"').send(md);
    return render(reply, ctx, { title: 'Draft accessibility statement', current: '/app', body: html`
      <p><a href="/app/sites/${s.id}">← ${s.name}</a></p>
      <h1>Draft accessibility statement</h1>
      <p class="notice"><strong>This is a draft.</strong> It is based on your latest automated scan. Review every section, add your manual review results and contact details, and fill the placeholders in [brackets] before publishing. It is not legal advice.</p>
      <div class="field"><label for="statement">Statement (Markdown)</label><textarea id="statement" rows="28" style="font-family:ui-monospace,monospace;font-size:13px">${md}</textarea></div>
      <a class="btn btn-primary" href="/app/sites/${s.id}/statement?download=1">Download as Markdown</a>` });
  });

  app.post('/app/team/branding', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    if (ctx.role !== 'owner' || !planOf(ctx.team.plan).whiteLabel) return back(reply, '/app/team', 'err', 'White-label reports are part of the Agency plan.');
    const { brand_name, brand_color, brand_logo_url } = req.body as any;
    const color = String(brand_color ?? '').trim();
    if (color && (!/^#[0-9a-f]{6}$/i.test(color) || contrast(color, '#ffffff') < 4.5)) return back(reply, '/app/team', 'err', 'Brand colour must be a hex value with at least 4.5:1 contrast on white.');
    const logo = String(brand_logo_url ?? '').trim();
    if (logo && !/^https:\/\//.test(logo)) return back(reply, '/app/team', 'err', 'Logo URL must start with https://');
    run('UPDATE teams SET brand_name = ?, brand_color = ?, brand_logo_url = ? WHERE id = ?', String(brand_name ?? '').slice(0, 80) || null, color || null, logo || null, ctx.team.id);
    return back(reply, '/app/team', 'ok', 'Branding saved.');
  });
}
