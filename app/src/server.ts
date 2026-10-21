import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fstatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';
import { db } from './db.ts';
import { publicRoutes } from './routes/public.ts';
import appRoutes from './routes/index.ts';
import { localeHook } from './routes/guard.ts';

export async function buildServer() {
  db();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true, bodyLimit: 64 * 1024 });
  await app.register(formbody);
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(cors, { origin: config.siteOrigins, methods: ['GET', 'POST'] });
  await app.register(fstatic, { root: fileURLToPath(new URL('../public', import.meta.url)), prefix: '/static/' });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff').header('referrer-policy', 'strict-origin-when-cross-origin').header('x-frame-options', 'DENY');
    return payload;
  });
  app.decorateRequest('locale', 'en' as any);
  app.addHook('onRequest', localeHook);
  await app.register(publicRoutes);
  await app.register(appRoutes);
  return app;
}
