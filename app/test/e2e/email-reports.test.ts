import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './helpers.ts';
process.env.MAILER = 'console'; process.env.RESEND_API_KEY = '';
let app: any, db: any, sentMail: any[], mailer: any, worker: any, rm: any, queue: any;
before(async () => {
  app = await (await import('../../src/server.ts')).buildServer();
  db = await import('../../src/db.ts');
  ({ sentMail, mailer } = await import('../../src/lib/mailer.ts'));
  worker = await import('../../src/jobs/worker.ts');
  rm = await import('../../src/lib/reportMail.ts');
  queue = await import('../../src/jobs/queue.ts');
});
after(async () => { await app.close(); (await import('../../src/lib/scanner.ts')).closeBrowser?.(); });
const drain = async () => { while (await worker.workOnce({})) {} };
const loc = (r: any) => decodeURIComponent(r.headers.location ?? '');

async function setup(email: string, plan: string, siteId: string) {
  const c = client(app);
  await c.post('/signup', { email, password: 'a very long password' }, '/signup');
  const team = db.get('SELECT t.id FROM teams t JOIN memberships m ON m.team_id = t.id JOIN users u ON u.id = m.user_id WHERE u.email = ?', email);
  db.run('UPDATE teams SET plan = ? WHERE id = ?', plan, team.id);
  db.run("INSERT INTO sites (id, team_id, name, origin, verify_token, verified_at, verify_method, created_at) VALUES (?, ?, 'Shop', 'https://shop.example', 't', '2026-11-01', 'dns', '2026-11-01')", siteId, team.id);
  return { c, team, uid: db.get('SELECT id FROM users WHERE email = ?', email).id };
}
const addScan = (siteId: string, id: string) => db.run("INSERT INTO scans (id, site_id, kind, status, created_at, finished_at, pages_scanned, page_limit, critical, serious, moderate, minor, new_issues, fixed_issues, evidence_hash) VALUES (?, ?, 'scheduled', 'done', '2026-11-01', '2026-11-01T10:00:00Z', 3, 500, 1, 2, 3, 4, 2, 1, 'h')", id, siteId);

test('send now: validation, queued job, one email per recipient with the PDF, delivery log, no unsubscribe link', async () => {
  const { c, uid } = await setup('sender@example.com', 'business', 'er1');
  let r = await c.req('GET', '/app/sites/er1');
  assert.match(r.body, /<h2 id="er-h"[^>]*>Email reports<\/h2>/); assert.match(r.body, /href="\/app\/sites\/er1\/email-reports"/);
  r = await c.req('GET', '/app/sites/er1/email-reports');
  assert.match(r.body, /There is no finished scan to send yet/);
  addScan('er1', 'scan-er1');
  r = await c.req('GET', '/app/sites/er1/email-reports');
  assert.match(r.body, /<label for="send-to">Recipients<\/label>/); assert.match(r.body, /No scheduled deliveries/); assert.match(r.body, /No report emails sent yet/);
  const P = '/app/sites/er1/email-reports';
  assert.match(loc(await c.post(P + '/send', { recipients: '' }, P)), /Enter at least one email/);
  assert.match(loc(await c.post(P + '/send', { recipients: 'a@x.de, nope' }, P)), /not a valid email address: nope/);
  assert.match(loc(await c.post(P + '/send', { recipients: '1@a.de 2@a.de 3@a.de 4@a.de 5@a.de 6@a.de' }, P)), /at most 5/);
  const before = sentMail.length;
  r = await c.post(P + '/send', { recipients: 'Client@Agency.example, boss@client.example', locale: 'en' }, P);
  assert.match(loc(r), /Report queued for 2 recipients/);
  assert.equal(sentMail.length, before, 'nothing sent inside the request');
  await drain();
  const mails = sentMail.slice(before);
  assert.deepEqual(mails.map((m) => m.to), ['client@agency.example', 'boss@client.example']);
  for (const m of mails) {
    assert.equal(m.subject, 'Accessibility report: Shop (1 November 2026)');
    assert.equal(m.replyTo, 'sender@example.com'); assert.equal(m.fromName, undefined);
    assert.equal(m.attachments[0].filename, 'accessibility-report-2026-11-01.pdf'); assert.equal(m.attachments[0].content.subarray(0, 5).toString(), '%PDF-');
    assert.match(m.text, /3 pages checked\. Issues found by automated checks: 1 critical, 2 serious, 3 moderate, 4 minor\./);
    assert.match(m.text, /2 new, 1 fixed/); assert.match(m.text, /not legal advice/); assert.match(m.text, /on behalf of sender@example\.com/);
    assert.doesNotMatch(m.text, /Unsubscribe/); assert.equal(m.headers, undefined);
  }
  const d = db.all("SELECT * FROM report_deliveries WHERE site_id = 'er1' ORDER BY recipient");
  assert.deepEqual(d.map((x: any) => [x.recipient, x.status, x.kind, x.scan_id, x.sent_by]), [['boss@client.example', 'sent', 'manual', 'scan-er1', uid], ['client@agency.example', 'sent', 'manual', 'scan-er1', uid]]);
  r = await c.req('GET', P);
  assert.match(r.body, /Sent now/); assert.match(r.body, /client@agency\.example/);

  // A failing recipient is recorded and the job is not retried (no duplicate mail to the others).
  const orig = mailer.send.bind(mailer); let calls = 0;
  mailer.send = async (m: any) => { calls++; if (m.to === 'bad@x.example') throw new Error('Resend 422: invalid to'); return orig(m); };
  try { await c.post(P + '/send', { recipients: 'ok@x.example, bad@x.example' }, P); await drain(); } finally { mailer.send = orig; }
  assert.equal(calls, 2);
  assert.equal(db.get("SELECT status FROM report_deliveries WHERE recipient = 'bad@x.example'").status, 'failed');
  assert.equal(db.get("SELECT status FROM jobs WHERE type = 'report_email_now' ORDER BY id DESC LIMIT 1").status, 'done');
  assert.match((await c.req('GET', P)).body, /Failed/);

  // Daily limit for manual sends (25 emails per team per 24 h).
  const tid = db.get("SELECT site_id, team_id FROM report_deliveries LIMIT 1").team_id;
  for (let i = 0; i < 20; i++) db.run("INSERT INTO report_deliveries (id, team_id, site_id, kind, recipient, status, created_at) VALUES (?, ?, 'er1', 'manual', 'x@y.de', 'sent', ?)", 'fill' + i, tid, new Date().toISOString());
  assert.match(loc(await c.post(P + '/send', { recipients: 'last@x.example, more@x.example' }, P)), /limit of 25/);
  assert.match(loc(await c.post(P + '/send', { recipients: 'last@x.example' }, P)), /queued for 1 recipient\./);
  assert.match(loc(await c.post(P + '/send', { recipients: 'again@x.example' }, P)), /limit of 25/, 'queued jobs count towards the limit');
  await drain();
});

test('schedules: add, scheduler sends with unsubscribe link and one-click header, pause/resume/delete, unsubscribe flow, white-label sender', async () => {
  const { c, team } = await setup('agency@example.com', 'agency', 'er2');
  db.run("UPDATE teams SET brand_name = 'Acme Digital', brand_color = '#1d4ed8' WHERE id = ?", team.id);
  addScan('er2', 'scan-er2');
  const P = '/app/sites/er2/email-reports';
  assert.match(loc(await c.post(P + '/schedules', { recipients: 'nope', frequency: 'weekly' }, P)), /not a valid email/);
  assert.match(loc(await c.post(P + '/schedules', { recipients: 'kunde@client.example, cto@client.example', frequency: 'weekly', locale: 'zh-CN' }, P)), /Schedule added/);
  const s = db.get("SELECT * FROM report_schedules WHERE site_id = 'er2'");
  assert.equal(s.active, 1); assert.equal(s.recipients, 'kunde@client.example,cto@client.example'); assert.equal(s.locale, 'zh-CN');
  assert.equal(new Date(s.next_run_at).getUTCDay(), 1); assert.equal(new Date(s.next_run_at).getUTCHours(), 6); assert.ok(s.next_run_at > new Date().toISOString());
  let r = await c.req('GET', P);
  assert.match(r.body, /kunde@client\.example, cto@client\.example/); assert.match(r.body, /aria-label="Pause: kunde@client\.example, cto@client\.example"/);
  assert.match((await c.req('GET', '/app/sites/er2')).body, /Scheduled delivery: 1 active/);

  // Not due yet: the scheduler does nothing.
  assert.equal(rm.enqueueDueReports(queue.enqueue), 0);
  db.run("UPDATE report_schedules SET next_run_at = '2026-01-05T06:00:00.000Z' WHERE id = ?", s.id);
  const before = sentMail.length;
  assert.equal(rm.enqueueDueReports(queue.enqueue), 1);
  assert.ok(db.get('SELECT next_run_at FROM report_schedules WHERE id = ?', s.id).next_run_at > new Date().toISOString());
  assert.equal(rm.enqueueDueReports(queue.enqueue), 0, 'not enqueued twice');
  await drain();
  const mails = sentMail.slice(before);
  assert.equal(mails.length, 2);
  const m = mails.find((x) => x.to === 'kunde@client.example');
  assert.equal(m.fromName, 'Acme Digital via Allyfolio'); assert.equal(m.replyTo, 'agency@example.com');
  assert.match(m.subject, /^无障碍报告：Shop/); assert.match(m.text, /由 Acme Digital 发送/); assert.match(m.text, /每周收到此报告/);
  const link = m.text.match(/退订：(\S+)/)[1];
  assert.match(link, /\/r\/unsubscribe\?s=/); assert.match(m.headers['List-Unsubscribe'], /\/api\/report-unsubscribe\?s=/); assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM report_deliveries WHERE schedule_id = ? AND kind = 'scheduled' AND status = 'sent'", s.id).n, 2);

  // Unsubscribe page and one-click; bad tokens rejected.
  const anon = client(app);
  const path = link.replace(/^https?:\/\/[^/]+/, '');
  r = await anon.req('GET', path); assert.match(r.body, /Stop sending scheduled accessibility reports for Shop to kunde@client\.example/);
  r = await anon.req('GET', path.replace(/t=[^&]+/, 't=forged')); assert.match(r.body, /invalid or has already been used/);
  const forged = await app.inject({ method: 'POST', url: m.headers['List-Unsubscribe'].slice(1, -1).replace(/^https?:\/\/[^/]+/, '').replace(/t=[^&]+/, 't=forged'), payload: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(forged.statusCode, 400);
  const one = await app.inject({ method: 'POST', url: m.headers['List-Unsubscribe'].slice(1, -1).replace(/^https?:\/\/[^/]+/, ''), payload: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(one.statusCode, 200); assert.match(one.body, /You are unsubscribed/);
  assert.equal(db.get('SELECT recipients FROM report_schedules WHERE id = ?', s.id).recipients, 'cto@client.example');
  assert.match((await anon.req('GET', path)).body, /invalid or has already been used/);
  const cto = sentMail.slice(before).find((x) => x.to === 'cto@client.example');
  const q = new URL(cto.text.match(/退订：(\S+)/)[1]).searchParams;
  r = await anon.post('/api/report-unsubscribe', { s: q.get('s')!, e: q.get('e')!, t: q.get('t')! });
  assert.equal(r.statusCode, 200);
  const after1 = db.get('SELECT * FROM report_schedules WHERE id = ?', s.id);
  assert.equal(after1.recipients, ''); assert.equal(after1.active, 0, 'paused once nobody is left');
  assert.match(loc(await c.post(`${P}/${s.id}/toggle`, {}, P)), /has unsubscribed/, 'cannot resume an empty schedule');

  // Pause / resume / delete.
  await c.post(P + '/schedules', { recipients: 'pm@client.example', frequency: 'monthly' }, P);
  const s2 = db.get("SELECT * FROM report_schedules WHERE site_id = 'er2' AND recipients = 'pm@client.example'");
  assert.equal(new Date(s2.next_run_at).getUTCDate(), 1);
  assert.match(loc(await c.post(`${P}/${s2.id}/toggle`, {}, P)), /paused/);
  db.run("UPDATE report_schedules SET next_run_at = '2026-01-01T06:00:00.000Z' WHERE id = ?", s2.id);
  assert.equal(rm.enqueueDueReports(queue.enqueue), 0, 'paused schedules never run');
  assert.match(loc(await c.post(`${P}/${s2.id}/toggle`, {}, P)), /resumed/);
  assert.ok(db.get('SELECT next_run_at FROM report_schedules WHERE id = ?', s2.id).next_run_at > new Date().toISOString(), 'resuming does not fire an overdue run');
  assert.match(loc(await c.post(`${P}/${s2.id}/delete`, {}, P)), /deleted/);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM report_schedules WHERE id = ?', s2.id).n, 0);

  // Other teams: 404 everywhere.
  const o = client(app);
  await o.post('/signup', { email: 'intruder@example.com', password: 'another long password' }, '/signup');
  assert.equal((await o.req('GET', P)).statusCode, 404);
  assert.equal((await o.post(P + '/send', { recipients: 'x@y.de' })).statusCode, 404);
  assert.equal((await o.post(P + '/schedules', { recipients: 'x@y.de' })).statusCode, 404);
  assert.equal((await o.post(`${P}/${s.id}/toggle`, {})).statusCode, 404);
  assert.equal((await o.post(`${P}/${s.id}/delete`, {})).statusCode, 404);
});

test('plan gate: no paid plan means no forms, no sends, and due schedules are skipped without mail', async () => {
  const { c, team } = await setup('free@example.com', 'none', 'er3');
  addScan('er3', 'scan-er3');
  const P = '/app/sites/er3/email-reports';
  const r = await c.req('GET', P);
  assert.match(r.body, /Email reports are part of all paid plans/); assert.doesNotMatch(r.body, /name="recipients"/);
  assert.match(loc(await c.post(P + '/send', { recipients: 'a@b.de' }, '/app')), /part of all paid plans/);
  assert.match(loc(await c.post(P + '/schedules', { recipients: 'a@b.de' }, '/app')), /part of all paid plans/);
  // A schedule left over from a paid period.
  db.run("INSERT INTO report_schedules (id, team_id, site_id, recipients, frequency, locale, active, next_run_at, created_at) VALUES ('old', ?, 'er3', 'a@b.de', 'weekly', 'en', 1, '2026-01-05T06:00:00Z', '2026-01-01')", team.id);
  const before = sentMail.length;
  rm.enqueueDueReports(queue.enqueue); await drain();
  assert.equal(sentMail.length, before);
  assert.equal(db.get("SELECT status FROM report_deliveries WHERE schedule_id = 'old'").status, 'skipped');
  assert.match((await c.req('GET', P)).body, /Skipped.*plan does not include reports/s);
  // Data export lists schedules.
  const exp = JSON.parse((await c.req('GET', '/app/account/export')).body);
  assert.equal(exp.teams[0].report_schedules[0].recipients, 'a@b.de');
});
