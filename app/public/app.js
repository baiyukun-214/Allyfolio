// Dashboard progressive enhancement: count-ups, score ring, live "Scan now" progress, toasts. No libraries, no tracking.
(() => {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const countUp = (el) => {
    const to = Number(el.dataset.to); if (RM || !to) return;
    let t0 = 0; const step = (n) => { t0 ||= n; const k = Math.min(1, (n - t0) / 900); el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
    el.textContent = '0'; requestAnimationFrame(step);
  };
  const animate = (root) => {
    root.querySelectorAll('[data-to]').forEach(countUp);
    if (!RM) root.querySelectorAll('.ring[data-p]').forEach((r) => { r.style.setProperty('--p', '0'); requestAnimationFrame(() => requestAnimationFrame(() => r.style.setProperty('--p', r.dataset.p))); });
  };
  animate(document);

  const toasts = document.getElementById('toasts');
  function toast(msg, link, dismissLabel) {
    if (!toasts) return;
    const el = document.createElement('div'); el.className = 'toast';
    const p = document.createElement('p'); p.textContent = msg; el.append(p);
    if (link) { const a = document.createElement('a'); a.href = link.href; a.textContent = link.text; el.append(a); }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-x'; b.textContent = '×'; b.setAttribute('aria-label', dismissLabel || 'Dismiss'); b.onclick = () => el.remove(); el.append(b);
    toasts.append(el); requestAnimationFrame(() => el.classList.add('on'));
  }

  const form = document.querySelector('form[data-scan-form]');
  const T = document.getElementById('scan-i18n')?.dataset ?? {};
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button'); const box = document.getElementById('scan-progress'); const txt = document.getElementById('scan-progress-text');
    const bar = box.querySelector('.prog'), fill = bar.firstElementChild;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); box.hidden = false; txt.textContent = T.starting; fill.style.width = '0%';
    const before = await status();
    const lastId = before?.last?.id;
    try {
      const r = await fetch(form.action, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(form)), credentials: 'same-origin' });
      if (!r.ok) throw new Error(String(r.status));
    } catch { form.submit(); return; } // fall back to the normal form post
    skeleton();
    const poll = setInterval(async () => {
      const s = await status(); if (!s) return;
      if (s.running) {
        const lim = s.running.limit || 1; fill.style.width = Math.min(100, Math.round(100 * s.running.pages / lim)) + '%';
        bar.setAttribute('aria-valuenow', String(s.running.pages)); bar.setAttribute('aria-valuemax', String(lim));
        txt.textContent = T.scanning.replace('{n}', s.running.pages).replace('{limit}', lim);
      }
      if (!s.pending && !s.running && s.last && s.last.id !== lastId) {
        clearInterval(poll); fill.style.width = '100%';
        if (s.last.status === 'done') {
          const msg = T.done.replace('{n}', s.last.newIssues).replace('{f}', s.last.fixedIssues);
          txt.textContent = msg; toast(msg, { href: '/app/scans/' + s.last.id, text: T.view }, T.dismiss);
        } else { txt.textContent = T.failed; toast(T.failed, null, T.dismiss); }
        await refresh(); btn.disabled = false; btn.removeAttribute('aria-busy');
        setTimeout(() => { box.hidden = true; }, 1500);
      }
    }, 1500);
    async function status() { try { const r = await fetch(form.dataset.statusUrl, { headers: { accept: 'application/json' }, credentials: 'same-origin' }); return r.ok ? r.json() : null; } catch { return null; } }
  });
  function skeleton() {
    const tb = document.querySelector('#history tbody'); if (!tb) return;
    const cols = tb.closest('table').querySelectorAll('thead th').length;
    for (let i = 0; i < 2; i++) { const tr = document.createElement('tr'); tr.className = 'skel-row'; tr.setAttribute('aria-hidden', 'true'); for (let j = 0; j < cols; j++) { const td = document.createElement('td'); td.innerHTML = '<span class="skel"></span>'; tr.append(td); } tb.prepend(tr); }
  }
  async function refresh() {
    try {
      const doc = new DOMParser().parseFromString(await (await fetch(location.pathname, { credentials: 'same-origin' })).text(), 'text/html');
      for (const id of ['kpis', 'history']) { const fresh = doc.getElementById(id), cur = document.getElementById(id); if (fresh && cur) cur.replaceWith(fresh); else if (fresh && id === 'kpis') document.querySelector('.facts')?.before(fresh); }
      const k = document.getElementById('kpis'); if (k) animate(k);
    } catch {}
  }
})();
