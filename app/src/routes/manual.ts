import type { FastifyInstance } from 'fastify';
import { all } from '../db.ts';
import { html } from '../lib/html.ts';
import { csrfField } from '../lib/csrf.ts';
import { requireUser, render, back, ownSite, loc, T, localTime } from './guard.ts';
import { checklist, saveChecklist, fieldKey, STATUSES, NOTES_MAX } from '../lib/manualReview.ts';

export async function manualRoutes(app: FastifyInstance) {
  app.get('/app/sites/:id/manual', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const l = loc(req, ctx), Tx = T(req, ctx), X = Tx.manual;
    const s = ownSite(ctx, (req.params as any).id); if (!s) return reply.code(404).send('Not found');
    if (!s.verified_at) return back(reply, `/app/sites/${s.id}`, 'err', X.notVerified);
    const members = all<any>('SELECT u.id, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.created_at', ctx.team.id);
    const rows = checklist(s.id);
    return render(reply, ctx, { title: `${X.h} – ${s.name}`, current: '/app', body: html`
      <p><a href="/app/sites/${s.id}">${X.back}</a></p>
      <h1>${X.h}</h1><p class="muted">${s.name} · ${s.origin}</p>
      <p>${X.lead}</p>
      <p class="notice">${X.disclaimer}</p>
      <form method="post" action="/app/sites/${s.id}/manual">${csrfField(req)}
      <div class="card table-wrap" style="padding:8px 16px"><table><caption class="sr-only">${X.caption}</caption>
        <thead><tr><th scope="col">${X.colCriterion}</th><th scope="col">${X.colLevel}</th><th scope="col">${X.colStatus}</th><th scope="col">${X.colAssignee}</th><th scope="col">${X.colNotes}</th><th scope="col">${X.colLast}</th></tr></thead><tbody>
        ${rows.map((r) => { const k = fieldKey(r.criterion); const title = `${r.criterion} ${l === 'zh-CN' ? r.zh : r.en}`; return html`<tr>
          <th scope="row" id="${k}-h">${title}</th><td>${r.level}</td>
          <td><select name="${k}_status" aria-label="${X.statusFor(r.criterion)}">${STATUSES.map((st) => html`<option value="${st}" ${r.status === st ? 'selected' : ''}>${X.statuses[st]}</option>`)}</select></td>
          <td><select name="${k}_assignee" aria-label="${X.assigneeFor(r.criterion)}"><option value="">${X.nobody}</option>${members.map((m) => html`<option value="${m.id}" ${r.assignee_id === m.id ? 'selected' : ''}>${m.email}</option>`)}</select></td>
          <td><textarea name="${k}_notes" rows="2" maxlength="${String(NOTES_MAX)}" aria-label="${X.notesFor(r.criterion)}">${r.notes ?? ''}</textarea></td>
          <td class="small">${r.checked_at ? html`${localTime(r.checked_at, l)}<br><span class="muted">${X.lastBy(r.checked_by_email ?? '–')}</span>` : '–'}</td></tr>`; })}
      </tbody></table></div>
      <p style="margin-top:16px"><button class="btn btn-primary" type="submit">${X.save}</button></p>
      </form>` });
  });

  app.post('/app/sites/:id/manual', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return; const X = T(req, ctx).manual;
    const s = ownSite(ctx, (req.params as any).id); if (!s) return reply.code(404).send('Not found');
    if (!s.verified_at) return back(reply, `/app/sites/${s.id}`, 'err', X.notVerified);
    const n = saveChecklist(s.id, ctx.team.id, ctx.user.id, (req.body ?? {}) as any);
    return back(reply, `/app/sites/${s.id}/manual`, 'ok', X.saved(n));
  });
}
