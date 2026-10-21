import type { FastifyRequest } from 'fastify';
import { html } from '../lib/html.ts';
import type { Ctx } from '../lib/auth.ts';
export function siteDetailExtras(_req: FastifyRequest, _ctx: Ctx, _s: any) { return html`<p class="muted">Scans will appear here.</p>`; }
