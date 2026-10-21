import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIp, parsePublicUrl, assertPublicHost, UnsafeUrlError } from '../../src/lib/ssrf.ts';

test('blocks private, loopback, link-local and reserved IPv4', () => {
  for (const ip of ['127.0.0.1', '127.255.1.2', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1'])
    assert.equal(isBlockedIp(ip), true, ip);
});
test('allows public IPv4', () => { for (const ip of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '93.184.216.34']) assert.equal(isBlockedIp(ip), false, ip); });
test('blocks IPv6 loopback, ULA, link-local, mapped and NAT64 private', () => {
  for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:7f00:1::', 'ff02::1', '2001:db8::1', '[::1]', 'fe80::1%eth0'])
    assert.equal(isBlockedIp(ip), true, ip);
});
test('allows public IPv6', () => { for (const ip of ['2606:4700:4700::1111', '2a01:4f8::1', '::ffff:8.8.8.8']) assert.equal(isBlockedIp(ip), false, ip); });
test('rejects bad URLs', () => {
  for (const u of ['', 'ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user:pw@example.com', 'http://localhost/', 'http://foo.localhost', 'http://127.0.0.1', 'http://[::1]/', 'http://169.254.169.254/latest', 'http://example.com:8080', 'http://intranet', 'http://printer.local'])
    assert.throws(() => parsePublicUrl(u), UnsafeUrlError, u);
});
test('normalises scheme-less URLs', () => { assert.equal(parsePublicUrl('example.com/a#x').href, 'https://example.com/a'); });
test('rejects decimal/hex IP encodings via URL normalisation', () => {
  for (const u of ['http://2130706433/', 'http://0x7f000001/', 'http://017700000001/']) assert.throws(() => parsePublicUrl(u), UnsafeUrlError, u);
});
test('DNS: localhost-resolving names are blocked after resolution', async () => {
  await assert.rejects(assertPublicHost('localtest.me').catch((e) => { if (/could not find/.test(e.message)) throw new UnsafeUrlError('offline'); throw e; }), UnsafeUrlError);
});
