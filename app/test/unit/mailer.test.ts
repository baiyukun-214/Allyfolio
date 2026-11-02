import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ResendMailer } from '../../src/lib/mailer.ts';
test('Resend adapter posts the expected payload and surfaces API errors', async () => {
  const got: any[] = []; let fail = false;
  const s = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) }); res.writeHead(fail ? 422 : 200, { 'content-type': 'application/json' }); res.end(fail ? '{"message":"invalid from"}' : '{"id":"em_1"}'); }); });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const m = new ResendMailer('re_test', `http://127.0.0.1:${(s.address() as any).port}`, 'Allyfolio <hello@allyfolio.com>');
  await m.send({ to: 'a@example.com', subject: '主题', text: '正文' });
  assert.deepEqual(got[0], { url: '/emails', auth: 'Bearer re_test', body: { from: 'Allyfolio <hello@allyfolio.com>', to: ['a@example.com'], subject: '主题', text: '正文' } });
  fail = true; await assert.rejects(m.send({ to: 'a@example.com', subject: 's', text: 't' }), /Resend 422/);
  s.close();
});

test('Resend payload carries attachments (base64), reply_to, headers and a sanitised From name', async () => {
  const { ResendMailer, fromWithName, safeFromName } = await import('../../src/lib/mailer.ts');
  const calls: any[] = []; const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); }) as any;
  try {
    await new ResendMailer('k', 'https://resend.test', 'Allyfolio <hello@allyfolio.com>').send({ to: 'a@b.de', subject: 's', text: 't', replyTo: 'me@agency.de', fromName: 'Acme "Web" <x>\r\nBcc: evil@x via Allyfolio',
      headers: { 'List-Unsubscribe': '<https://u>' }, attachments: [{ filename: 'r.pdf', content: Buffer.from('%PDF-1.7'), contentType: 'application/pdf' }] });
  } finally { globalThis.fetch = orig; }
  const b = calls[0].body;
  assert.equal(b.from, '"Acme Web x Bcc evil x via Allyfolio" <hello@allyfolio.com>');
  assert.equal(b.reply_to, 'me@agency.de'); assert.deepEqual(b.headers, { 'List-Unsubscribe': '<https://u>' });
  assert.deepEqual(b.attachments, [{ filename: 'r.pdf', content: Buffer.from('%PDF-1.7').toString('base64'), content_type: 'application/pdf' }]);
  assert.equal(fromWithName('Allyfolio <hello@allyfolio.com>'), 'Allyfolio <hello@allyfolio.com>');
  assert.equal(fromWithName('hello@allyfolio.com', 'Acme'), '"Acme" <hello@allyfolio.com>');
  assert.equal(safeFromName('a\nb'), 'a b');
});

test('report email helpers: recipients parsing, next run times, unsubscribe tokens', async () => {
  const m = await import('../../src/lib/reportMail.ts');
  assert.deepEqual(m.parseRecipients(' A@x.de, b@y.com;a@x.de '), { ok: true, list: ['a@x.de', 'b@y.com'] });
  assert.deepEqual(m.parseRecipients(''), { ok: false, reason: 'empty' });
  assert.equal((m.parseRecipients('a@x.de, nope') as any).reason, 'invalid');
  assert.equal((m.parseRecipients('a@x.de, "x"@y.de') as any).reason, 'invalid');
  assert.equal((m.parseRecipients('1@a.de 2@a.de 3@a.de 4@a.de 5@a.de 6@a.de') as any).reason, 'tooMany');
  // Monday 2 Nov 2026 05:00 UTC -> same day 06:00; at 06:00 -> next Monday.
  assert.equal(m.nextRunAt('weekly', new Date('2026-11-02T05:00:00Z')), '2026-11-02T06:00:00.000Z');
  assert.equal(m.nextRunAt('weekly', new Date('2026-11-02T06:00:00Z')), '2026-11-09T06:00:00.000Z');
  assert.equal(m.nextRunAt('weekly', new Date('2026-11-04T12:00:00Z')), '2026-11-09T06:00:00.000Z');
  assert.equal(m.nextRunAt('monthly', new Date('2026-11-02T04:00:00Z')), '2026-12-01T06:00:00.000Z');
  assert.equal(m.nextRunAt('monthly', new Date('2026-12-31T23:00:00Z')), '2027-01-01T06:00:00.000Z');
  const tok = m.unsubToken('s1', 'A@x.de');
  assert.ok(m.unsubOk('s1', 'a@x.de', tok)); assert.ok(!m.unsubOk('s2', 'a@x.de', tok)); assert.ok(!m.unsubOk('s1', 'b@x.de', tok)); assert.ok(!m.unsubOk('s1', 'a@x.de', 'x'));
});
