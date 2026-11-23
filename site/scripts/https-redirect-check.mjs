#!/usr/bin/env node
import assert from 'node:assert/strict';
import worker, { requestIsHttp } from '../https-redirect.mjs';

const asset = new Response('asset-ok', { status: 200, headers: { 'content-type': 'text/plain' } });
const env = { ASSETS: { fetch: async () => asset.clone() } };

const httpReq = new Request('http://allyfolio.com/pricing?x=1', { method: 'HEAD' });
assert.equal(requestIsHttp(httpReq), true);
const redir = await worker.fetch(httpReq, env);
assert.equal(redir.status, 301);
assert.equal(redir.headers.get('location'), 'https://allyfolio.com/pricing?x=1');

const httpsReq = new Request('https://allyfolio.com/', { method: 'GET' });
assert.equal(requestIsHttp(httpsReq), false);
const ok = await worker.fetch(httpsReq, env);
assert.equal(ok.status, 200);
assert.equal(await ok.text(), 'asset-ok');

const protoHttp = new Request('https://allyfolio.com/de', { headers: { 'X-Forwarded-Proto': 'http' } });
assert.equal(requestIsHttp(protoHttp), true);
const redir2 = await worker.fetch(protoHttp, env);
assert.equal(redir2.status, 301);
assert.equal(redir2.headers.get('location'), 'https://allyfolio.com/de');

const cfHttp = new Request('https://www.allyfolio.com/', { headers: { 'CF-Visitor': '{"scheme":"http"}' } });
assert.equal(requestIsHttp(cfHttp), true);
const redir3 = await worker.fetch(cfHttp, env);
assert.equal(redir3.status, 301);
assert.equal(redir3.headers.get('location'), 'https://www.allyfolio.com/');

const cfHttps = new Request('http://allyfolio.com/', { headers: { 'CF-Visitor': '{"scheme":"https"}' } });
assert.equal(requestIsHttp(cfHttps), false);

console.log('https-redirect-check: HTTP requests get a 301 to HTTPS; HTTPS is served as usual');
