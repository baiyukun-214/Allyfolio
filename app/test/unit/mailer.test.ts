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
