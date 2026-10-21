import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from '../config.ts';
import { html } from './html.ts';
import { SESSION_COOKIE } from './auth.ts';
const key = (req: FastifyRequest) => req.cookies[SESSION_COOKIE] ?? 'anon';
export const csrfToken = (req: FastifyRequest) => createHmac('sha256', config.sessionSecret).update('csrf:' + key(req)).digest('base64url');
export const csrfField = (req: FastifyRequest) => html`<input type="hidden" name="_csrf" value="${csrfToken(req)}">`;
export function csrfOk(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (origin && origin !== new URL(config.appUrl).origin && origin !== `${req.protocol}://${req.headers.host}`) return false;
  const got = String((req.body as any)?._csrf ?? ''), exp = csrfToken(req);
  return got.length === exp.length && timingSafeEqual(Buffer.from(got), Buffer.from(exp));
}
