import { claim, complete, fail, enqueueDueScans, enqueue } from './queue.ts';
import { runSiteScan, applyRetention } from './siteScan.ts';
import { get } from '../db.ts';
const handlers: Record<string, (p: any, log: any) => Promise<unknown>> = {
  site_scan: (p, log) => runSiteScan(p, log),
  retention: async () => applyRetention(),
  apply_downgrades: async () => (await import('../lib/billing.ts')).applyDueDowngrades(),
};
let stopped = false;
export async function workOnce(log: any = console): Promise<boolean> {
  const job = claim(); if (!job) return false;
  try { await handlers[job.type]?.(JSON.parse(job.payload), log); complete(job.id); }
  catch (e: any) { log.error?.({ job: job.id, err: e?.message }, 'job failed'); fail(job.id, String(e?.message ?? e), job.attempts); }
  return true;
}
export function startWorker(log: any = console) {
  const loop = async () => { while (!stopped) { const did = await workOnce(log).catch(() => false); if (!did) await new Promise((r) => setTimeout(r, 2000)); } };
  void loop();
  const tick = () => {
    try {
      enqueueDueScans();
      const day = new Date().toISOString().slice(0, 10);
      if (!get("SELECT 1 FROM jobs WHERE type = 'retention' AND created_at >= ?", day)) { enqueue('retention', {}); enqueue('apply_downgrades', {}); }
    } catch (e: any) { log.error?.(e?.message); }
  };
  tick(); setInterval(tick, 60_000).unref();
  log.info?.('worker + scheduler started');
}
export const stopWorker = () => { stopped = true; };
