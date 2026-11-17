// Production defaults: the dashboard and API live on app.allyfolio.com. Override with PUBLIC_APP_URL / PUBLIC_API_BASE at build
// time (an explicitly empty PUBLIC_API_BASE means same origin). `astro dev` defaults to the local app on :8787.
const PROD_APP = 'https://app.allyfolio.com';
const DEV_APP = 'http://localhost:8787';
const fallback = import.meta.env.PROD ? PROD_APP : DEV_APP;
// Base URL of the Allyfolio API (/api/scan, /api/waitlist).
export const API_BASE: string = (import.meta.env.PUBLIC_API_BASE ?? fallback).replace(/\/$/, '');
// When true, plan buttons and the free-scan “monitor this site” CTA go to app signup (with ?plan= / ?site=).
// Log in / Sign up / Dashboard in the header and footer are always shown and do not use this flag.
// Do not set PUBLIC_APP_LIVE=true until paid signup from the marketing site is intended.
export const APP_LIVE: boolean = import.meta.env.PUBLIC_APP_LIVE === 'true';
// Dashboard (app) URL for Log in / Sign up / Dashboard links.
export const APP_URL: string = (import.meta.env.PUBLIC_APP_URL ?? fallback).replace(/\/$/, '');
export const appLink = (path: '/login' | '/signup' | '/app', lang: string) => `${APP_URL}${path}?lang=${encodeURIComponent(lang)}`;
