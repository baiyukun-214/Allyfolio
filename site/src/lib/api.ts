// Production defaults: the dashboard and API live on app.allyfolio.com. Override with PUBLIC_APP_URL / PUBLIC_API_BASE at build
// time (an explicitly empty PUBLIC_API_BASE means same origin). `astro dev` defaults to the local app on :8787.
const PROD_APP = 'https://app.allyfolio.com';
const DEV_APP = 'http://localhost:8787';
const fallback = import.meta.env.PROD ? PROD_APP : DEV_APP;
// Base URL of the Allyfolio API (/api/scan, /api/waitlist).
export const API_BASE: string = (import.meta.env.PUBLIC_API_BASE ?? fallback).replace(/\/$/, '');
// Pre-launch switch: Log in / Sign up / Dashboard links are only rendered when PUBLIC_APP_LIVE=true at build time
// (set it together with PUBLIC_APP_URL once app.allyfolio.com is live). Until then CTAs point to the waitlist / free scan.
export const APP_LIVE: boolean = import.meta.env.PUBLIC_APP_LIVE === 'true';
// Dashboard (app) URL for Log in / Sign up / Dashboard links.
export const APP_URL: string = (import.meta.env.PUBLIC_APP_URL ?? fallback).replace(/\/$/, '');
export const appLink = (path: '/login' | '/signup' | '/app', lang: string) => `${APP_URL}${path}?lang=${encodeURIComponent(lang)}`;
