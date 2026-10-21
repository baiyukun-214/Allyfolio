import type { FastifyInstance } from 'fastify';
import { get, run } from '../db.ts';
import { html } from '../lib/html.ts';
import { planOf, canPdf } from '../lib/plans.ts';
import { brandingFor, reportHtml, reportPdf } from '../lib/report.ts';
import { draftStatement } from '../lib/statement.ts';
import { contrast } from '../lib/contrast.ts';
import { csrfField } from '../lib/csrf.ts';
import { requireUser, render, back, ownSite, loc, T } from './guard.ts';

export async function reportRoutes(app: FastifyInstance) {
  const scanFor = (ctx: any, id: string) => get<any>("SELECT c.* FROM scans c JOIN sites s ON s.id = c.site_id WHERE c.id = ? AND s.team_id = ? AND c.status = 'done'", id, ctx.team.id);

  app.get('/app/scans/:id/report', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const scan = scanFor(ctx, (req.params as any).id); if (!scan) return reply.code(404).send('Not found');
    return reply.type('text/html').send(reportHtml(scan.id, await brandingFor(ctx.team), loc(req, ctx)));
  });

  app.get('/app/scans/:id/report.pdf', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const scan = scanFor(ctx, (req.params as any).id); if (!scan) return reply.code(404).send('Not found');
    if (!canPdf(planOf(ctx.team.plan), scan.kind === 'oneoff')) return back(reply, `/app/scans/${scan.id}`, 'err', T(req, ctx).rep.pdfGate);
    const pdf = await reportPdf(scan.id, await brandingFor(ctx.team), loc(req, ctx));
    return reply.type('application/pdf').header('content-disposition', `attachment; filename="accessibility-report-${scan.finished_at.slice(0, 10)}.pdf"`).send(pdf);
  });

  app.get('/app/sites/:id/statement', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const s = ownSite(ctx, (req.params as any).id); if (!s) return reply.code(404).send();
    const l = loc(req, ctx), R = T(req, ctx).rep;
    if (!planOf(ctx.team.plan).statement) return back(reply, `/app/sites/${s.id}`, 'err', R.statementGate);
    const md = draftStatement(s.id, ctx.team.brand_name || ctx.team.name, l);
    if ((req.query as any).download) return reply.type('text/markdown; charset=utf-8').header('content-disposition', 'attachment; filename="accessibility-statement-draft.md"').send(md);
    return render(reply, ctx, { title: R.stTitle, current: '/app', body: html`
      <p><a href="/app/sites/${s.id}">← ${s.name}</a></p>
      <h1>${R.stTitle}</h1>
      <p class="notice"><strong>${R.stNoteH}</strong> ${R.stNote}</p>
      <div class="field"><label for="statement">${R.stLabel}</label><textarea id="statement" rows="28" style="font-family:ui-monospace,monospace;font-size:13px">${md}</textarea></div>
      <a class="btn btn-primary" href="/app/sites/${s.id}/statement?download=1">${R.stDownload}</a>` });
  });

  app.post('/app/team/branding', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const R = T(req, ctx).rep;
    if (ctx.role !== 'owner' || !planOf(ctx.team.plan).whiteLabel) return back(reply, '/app/team', 'err', R.brandGate);
    const { brand_name, brand_color, brand_logo_url } = req.body as any;
    const color = String(brand_color ?? '').trim();
    if (color && (!/^#[0-9a-f]{6}$/i.test(color) || contrast(color, '#ffffff') < 4.5)) return back(reply, '/app/team', 'err', R.brandColor);
    const logo = String(brand_logo_url ?? '').trim();
    if (logo && !/^https:\/\//.test(logo)) return back(reply, '/app/team', 'err', R.brandLogo);
    run('UPDATE teams SET brand_name = ?, brand_color = ?, brand_logo_url = ? WHERE id = ?', String(brand_name ?? '').slice(0, 80) || null, color || null, logo || null, ctx.team.id);
    return back(reply, '/app/team', 'ok', R.brandSaved);
  });
}
