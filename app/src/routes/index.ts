import type { FastifyInstance } from 'fastify';
export default async function appRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => reply.redirect('/login'));
}
