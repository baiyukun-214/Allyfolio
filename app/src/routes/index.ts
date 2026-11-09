import type { FastifyInstance } from 'fastify';
import { csrfOk } from '../lib/csrf.ts';
import { t } from '../i18n.ts';
import { currentUser } from '../lib/auth.ts';
import { loc, pg } from './guard.ts';
import { landingBody } from '../views/landing.ts';
import { authRoutes } from './auth.ts';
import { dashboardRoutes } from './app.ts';
import { monitoringRoutes } from './monitoring.ts';
import { reportRoutes } from './reports.ts';
import { manualRoutes } from './manual.ts';
import { emailReportRoutes } from './emailReports.ts';
import { clientRoutes } from './clients.ts';
import { accountRoutes } from './account.ts';
import { billingRoutes, billingWebhook } from './billing.ts';
export default async function appRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (req.method === 'POST' && !req.url.startsWith('/api/') && req.url !== '/logout' && !csrfOk(req)) return reply.code(403).type('text/plain').send(t(req.locale).errors.csrf);
  });
  // Public product page for Paddle / logged-out visitors; signed-in users still go to the dashboard.
  app.get('/', async (req, reply) => {
    if (currentUser(req)) return reply.redirect('/app');
    reply.type('text/html');
    const l = loc(req);
    return pg(req, { title: t(l).landing.pageTitle, body: landingBody(l) });
  });
  await app.register(authRoutes);
  await app.register(dashboardRoutes);
  await app.register(monitoringRoutes);
  await app.register(reportRoutes);
  await app.register(manualRoutes);
  await app.register(emailReportRoutes);
  await app.register(clientRoutes);
  await app.register(accountRoutes);
  await app.register(billingRoutes);
  await app.register(billingWebhook);
}
