export type Html = { __html: string };
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Tagged template that escapes interpolations unless they are Html (or arrays of Html). */
export function html(strings: TemplateStringsArray, ...vals: unknown[]): Html {
  let out = strings[0];
  vals.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return { __html: out };
}
function render(v: unknown): string {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(render).join('');
  if (typeof v === 'object' && '__html' in (v as any)) return (v as Html).__html;
  return esc(v);
}
export const raw = (s: string): Html => ({ __html: s });
export { esc };
