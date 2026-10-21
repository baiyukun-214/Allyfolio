// Base URL of the Allyfolio API. Empty = same origin (production: reverse proxy routes /api to the app).
export const API_BASE: string = (import.meta.env.PUBLIC_API_BASE ?? '').replace(/\/$/, '');
