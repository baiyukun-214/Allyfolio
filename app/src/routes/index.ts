import type { FastifyInstance } from 'fastify';
import { csrfOk } from '../lib/csrf.ts';
import { authRoutes } from './auth.ts';
import { dashboardRoutes } from './app.ts';
import { monitoringRoutes } from './monitoring.ts';
import { reportRoutes } from './reports.ts';
import { billingRoutes, stripeWebhook } from './billing.ts';
export default async function appRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (req.method === 'POST' && !req.url.startsWith('/api/') && req.url !== '/logout' && !csrfOk(req)) return reply.code(403).type('text/plain').send('Invalid form token. Please go back, reload the page and try again.');
  });
  app.get('/', async (_req, reply) => reply.redirect('/login'));
  await app.register(authRoutes);
  await app.register(dashboardRoutes);
  await app.register(monitoringRoutes);
  await app.register(reportRoutes);
  await app.register(billingRoutes);
  await app.register(stripeWebhook);
}
