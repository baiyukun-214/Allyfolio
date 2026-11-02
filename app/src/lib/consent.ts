/**
 * Best-effort cookie-consent dismissal before axe runs, so the report describes the page rather than the banner overlay.
 * Clicks a known CMP "accept" button (OneTrust, Cookiebot, Didomi, Quantcast, Usercentrics, TrustArc, …) or a visible
 * button whose text is a common EN/DE accept phrase. Checks the main frame and same-origin iframes (plus open shadow roots).
 * Never throws and never takes longer than the cap (default 2 s): a slow, hung or banner-less page just returns.
 */
import type { Frame, Page } from 'playwright';

export const CONSENT_SELECTORS = [
  '#onetrust-accept-btn-handler', '#accept-recommended-btn-handler',                          // OneTrust
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept', // Cookiebot
  '#didomi-notice-agree-button', // Didomi
  '.qc-cmp2-summary-buttons button[mode="primary"]', '#qc-cmp2-ui button[mode="primary"]',          // Quantcast Choice
  '[data-testid="uc-accept-all-button"]', '#uc-btn-accept-banner',                                  // Usercentrics
  '#truste-consent-button', '.truste-consent-button',                                               // TrustArc
  '.cky-btn-accept', '.cc-allow', '.cc-accept-all', '#cookie-accept-all',                           // CookieYes, cookieconsent, misc
];
/** Exact (normalised) button texts, strongest first. */
export const CONSENT_TEXTS = [
  'accept all cookies', 'accept all', 'allow all cookies', 'allow all', 'agree to all', 'accept cookies', 'accept and close', 'accept & close',
  'alle cookies akzeptieren', 'alle akzeptieren', 'alles akzeptieren', 'alle zulassen', 'alle cookies zulassen', 'akzeptieren und schließen', 'akzeptieren & schließen',
  'accept', 'agree', 'i agree', 'i accept', 'allow cookies', 'got it',
  'akzeptieren', 'zustimmen', 'einverstanden', 'ich stimme zu', 'ich bin einverstanden', 'alle annehmen', 'annehmen', 'zulassen',
];

export interface ConsentResult { clicked: string | null; frame?: string; timedOut: boolean; ms: number }

/**
 * Runs inside the page: find the first matching visible control and click it; returns what was clicked or null.
 * Kept as plain JS source (not a TS function) because tsx/esbuild injects helpers such as __name into serialised functions,
 * which do not exist in the page.
 */
const CLICK_IN_PAGE = `(arg) => {
  const roots = [document];
  for (const el of document.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
  const visible = (el) => {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true' || !el.getClientRects().length) return false;
    const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  // A link is only clicked if it does not navigate (CMPs use href="#" or javascript:).
  const safeLink = (el) => { const h = el.tagName === 'A' ? el.getAttribute('href') : null; return !h || /^(#|javascript:)/i.test(h); };
  for (const sel of arg.selectors) for (const r of roots) {
    let el = null; try { el = r.querySelector(sel); } catch (e) {}
    if (el && visible(el) && safeLink(el)) { el.click(); return sel; }
  }
  const norm = (s) => s.replace(/\\s+/g, ' ').trim().replace(/[!.\u2713\u2714\u00d7\\s]+$/, '').trim().toLowerCase();
  const cands = [];
  for (const r of roots) cands.push(...r.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]'));
  const label = (el) => norm(el.tagName === 'INPUT' ? el.value || '' : (el.textContent || el.getAttribute('aria-label') || ''));
  for (const t of arg.texts) for (const el of cands) if (label(el) === t && visible(el) && safeLink(el)) { el.click(); return 'text:' + t; }
  return null;
}`;
const clickExpr = () => `(${CLICK_IN_PAGE})(${JSON.stringify({ selectors: CONSENT_SELECTORS, texts: CONSENT_TEXTS })})`;

export async function dismissConsent(page: Page, opts: { capMs?: number } = {}): Promise<ConsentResult> {
  const capMs = opts.capMs ?? 2000, t0 = Date.now();
  let done = false;
  const work = (async (): Promise<ConsentResult> => {
    const main = page.mainFrame();
    let origin = ''; try { origin = new URL(main.url()).origin; } catch { /* about:blank */ }
    const frames: Frame[] = [main, ...page.frames().filter((f) => f !== main && (() => { try { return new URL(f.url()).origin === origin; } catch { return false; } })()).slice(0, 5)];
    for (const f of frames) {
      if (done) break; // cap already hit: never click after the scan has moved on
      const hit = await f.evaluate<string | null>(clickExpr()).catch(() => null);
      if (hit) {
        // Give the CMP a moment to remove the overlay (or reload the page) within the remaining budget.
        const left = capMs - (Date.now() - t0) - 50;
        if (left > 0) await page.waitForTimeout(Math.min(400, left)).catch(() => {});
        if (capMs - (Date.now() - t0) > 50) await page.waitForLoadState('load', { timeout: Math.max(1, capMs - (Date.now() - t0) - 50) }).catch(() => {});
        return { clicked: hit, frame: f === main ? 'main' : f.url(), timedOut: false, ms: Date.now() - t0 };
      }
    }
    return { clicked: null, timedOut: false, ms: Date.now() - t0 };
  })().catch((): ConsentResult => ({ clicked: null, timedOut: false, ms: Date.now() - t0 }));
  let timer: NodeJS.Timeout | undefined;
  const cap = new Promise<ConsentResult>((r) => { timer = setTimeout(() => r({ clicked: null, timedOut: true, ms: Date.now() - t0 }), capMs); });
  try { return await Promise.race([work, cap]); } finally { done = true; clearTimeout(timer); }
}
