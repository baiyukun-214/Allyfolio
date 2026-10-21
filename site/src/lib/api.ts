// Base URL of the Allyfolio API. Empty = same origin (production: reverse proxy routes /api to the app).
export const API_BASE: string = (import.meta.env.PUBLIC_API_BASE ?? '').replace(/\/$/, '');
// Dashboard (app) URL. Defaults to the local dev server.
export const APP_URL: string = (import.meta.env.PUBLIC_APP_URL ?? 'http://localhost:8787').replace(/\/$/, '');
export const appLink = (path: '/login' | '/signup' | '/app', lang: string) => `${APP_URL}${path}?lang=${encodeURIComponent(lang)}`;
