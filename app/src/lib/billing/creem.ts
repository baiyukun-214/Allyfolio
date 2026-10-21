// Creem (Merchant of Record) – placeholder so BILLING_PROVIDER=creem can be wired up later.
// Implement the same contract as PaddleProvider: server-created checkout, plan changes (upgrade prorated now,
// downgrade from next period), cancellation, customer portal and signed webhooks mapped to BillingEvent.
import type { BillingProvider } from './index.ts';
import { BillingNotConfigured } from './index.ts';
const todo = (): never => { throw new BillingNotConfigured('Creem provider is not implemented yet'); };
export class CreemProvider implements BillingProvider {
  readonly id = 'creem' as const;
  configured() { return false; }
  clientConfig() { return null; }
  checkout = todo; changePrice = todo; currentPeriod = todo; cancel = todo; portalUrl = todo; parseWebhook = todo;
}
