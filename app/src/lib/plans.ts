export type PlanId = 'none' | 'starter' | 'business' | 'agency';
export interface Plan { id: PlanId; name: string; priceCents: number; sites: number; pagesPerSite: number; frequency: 'weekly' | 'daily' | null; retentionMonths: number; seats: number; pdf: boolean; whiteLabel: boolean; statement: boolean }
export const PLANS: Record<PlanId, Plan> = {
  none:     { id: 'none', name: 'No plan', priceCents: 0, sites: 1, pagesPerSite: 0, frequency: null, retentionMonths: 12, seats: 1, pdf: false, whiteLabel: false, statement: false },
  starter:  { id: 'starter', name: 'Starter', priceCents: 1900, sites: 1, pagesPerSite: 100, frequency: 'weekly', retentionMonths: 12, seats: 1, pdf: false, whiteLabel: false, statement: true },
  business: { id: 'business', name: 'Business', priceCents: 3900, sites: 3, pagesPerSite: 500, frequency: 'daily', retentionMonths: 24, seats: 3, pdf: true, whiteLabel: false, statement: true },
  agency:   { id: 'agency', name: 'Agency', priceCents: 9900, sites: 15, pagesPerSite: 1000, frequency: 'daily', retentionMonths: 24, seats: 10, pdf: true, whiteLabel: true, statement: true },
};
export const ONE_OFF = { priceCents: 3900, sites: 1, pages: 100, pdf: true };
export const PAID: PlanId[] = ['starter', 'business', 'agency'];
export const planOf = (id: string | null | undefined): Plan => PLANS[(id as PlanId)] ?? PLANS.none;
export const rank = (id: PlanId) => ['none', 'starter', 'business', 'agency'].indexOf(id);

export class LimitError extends Error { constructor(msg: string) { super(msg); this.name = 'LimitError'; } }
export function assertCanAddSite(plan: Plan, currentSites: number) {
  if (currentSites >= plan.sites) throw new LimitError(`Your ${plan.name} plan includes ${plan.sites} site${plan.sites === 1 ? '' : 's'}. Upgrade to add more.`);
}
export function assertCanAddSeat(plan: Plan, currentSeats: number) {
  if (currentSeats >= plan.seats) throw new LimitError(`Your ${plan.name} plan includes ${plan.seats} seat${plan.seats === 1 ? '' : 's'}. Upgrade to invite more people.`);
}
/** Page cap for a scan: subscription plan limit, or the one-off report limit. */
export function pageCap(plan: Plan, oneoff: boolean) { return oneoff ? ONE_OFF.pages : plan.pagesPerSite; }
export function canPdf(plan: Plan, oneoff: boolean) { return oneoff || plan.pdf; }
export function nextScanAt(plan: Plan, from = new Date()): string | null {
  if (!plan.frequency) return null;
  return new Date(from.getTime() + (plan.frequency === 'daily' ? 1 : 7) * 86400_000).toISOString();
}
export function retentionCutoff(plan: Plan, nowD = new Date()): string {
  const d = new Date(nowD); d.setUTCMonth(d.getUTCMonth() - plan.retentionMonths); return d.toISOString();
}
