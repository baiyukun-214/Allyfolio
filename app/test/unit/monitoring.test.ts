import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseDsn, buildEnvelope, captureException } from '../../src/lib/monitoring.ts';
test('DSN parsing (Sentry + GlitchTip shapes)', () => {
  assert.deepEqual(parseDsn('https://abc@o1.ingest.sentry.io/42'), { endpoint: 'https://o1.ingest.sentry.io/api/42/envelope/', publicKey: 'abc' });
  assert.deepEqual(parseDsn('https://k@glitchtip.example.eu/7'), { endpoint: 'https://glitchtip.example.eu/api/7/envelope/', publicKey: 'k' });
  assert.equal(parseDsn('nonsense'), null); assert.equal(captureException.length >= 1, true);
});
test('envelope scrubs tokens and is sent only with a DSN', async () => {
  const { body } = buildEnvelope(new Error('boom'), { method: 'GET', url: '/reset?token=secret123' });
  assert.match(body, /boom/); assert.doesNotMatch(body, /secret123/);
  assert.equal(await captureException(new Error('x'), {}, ''), false);
  let got = ''; const s = http.createServer((q, r) => { q.on('data', (c) => (got += c)); q.on('end', () => r.end('{}')); });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  assert.equal(await captureException(new Error('sent!'), {}, `http://pk@127.0.0.1:${(s.address() as any).port}/3`), true);
  s.close(); assert.match(got, /sent!/);
});
