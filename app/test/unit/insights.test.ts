import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automatedScore, weeklyTrend } from '../../src/lib/insights.ts';
const s = (c: number, se: number, m: number, mi: number, pages: number, finished_at: string, fixed = 0) => ({ critical: c, serious: se, moderate: m, minor: mi, pages_scanned: pages, finished_at, fixed_issues: fixed });
test('automatedScore is 0–100 and weights severities per page', () => {
  assert.equal(automatedScore(s(0, 0, 0, 0, 5, '')), 100);
  assert.equal(automatedScore(s(2, 0, 0, 0, 2, '')), 60);
  assert.equal(automatedScore(s(50, 0, 0, 0, 1, '')), 0);
  assert.equal(automatedScore(s(1, 0, 0, 0, 0, '')), 60, 'zero pages treated as one');
});
test('weeklyTrend: series oldest→newest, delta vs a week earlier, fixed in last 7 days', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const done = [s(1, 1, 0, 0, 3, '2026-10-21T06:00:00Z', 4), s(2, 2, 1, 0, 3, '2026-10-17T06:00:00Z', 1), s(3, 3, 2, 0, 3, '2026-10-12T06:00:00Z', 9)];
  const t = weeklyTrend(done, now);
  assert.deepEqual(t.series, [8, 5, 2]); assert.equal(t.delta, -6); assert.equal(t.fixedWeek, 5);
  assert.equal(weeklyTrend([done[0]], now).delta, null);
});
