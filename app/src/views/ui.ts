// Small server-rendered UI pieces shared by dashboard pages. Final values are in the HTML; app.js only animates them.
import { html, type Html } from '../lib/html.ts';
export function scoreRing(score: number, aria: string, sub: string): Html {
  return html`<div class="ring" style="--p:${score}" data-p="${score}" role="img" aria-label="${aria}"><svg width="112" height="112" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><circle class="bg" cx="60" cy="60" r="50"/><circle class="fg" cx="60" cy="60" r="50"/></svg><span class="ring-v" aria-hidden="true"><b data-to="${score}">${score}</b><small>${sub}</small></span></div>`;
}
export function sparkline(values: number[], aria: string): Html {
  if (values.length < 2) return html``;
  const max = Math.max(1, ...values), w = 120, h = 36, step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 6)).toFixed(1)}`).join(' ');
  return html`<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${aria}: ${values.join(', ')}"><polyline points="${pts}" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
export function sevChips(c: any, labels: Record<string, string>): Html {
  return html`<span class="chips">${(['critical', 'serious', 'moderate', 'minor'] as const).map((k) => html`<span class="chip imp-${k}${c[k] ? '' : ' zero'}"><span class="sr-only">${labels[k]}: </span><span aria-hidden="true" class="dot"></span>${c[k] ?? 0}</span>`)}</span>`;
}
export function emptyState(title: string, text: string, action: Html | string = ''): Html {
  return html`<div class="empty card"><svg aria-hidden="true" focusable="false" width="96" height="72" viewBox="0 0 96 72"><rect x="8" y="10" width="80" height="54" rx="10" fill="#eef2ff" stroke="#c7d2fe"/><rect x="18" y="22" width="34" height="6" rx="3" fill="#c7d2fe"/><rect x="18" y="34" width="54" height="6" rx="3" fill="#e0e7ff"/><rect x="18" y="46" width="44" height="6" rx="3" fill="#e0e7ff"/><circle cx="74" cy="22" r="10" fill="#4f46e5"/><path d="m69.5 22 3 3 6-6" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><h2>${title}</h2><p class="muted">${text}</p>${action}</div>`;
}
