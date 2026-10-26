// Shared tilt + cursor spotlight. data-tilt="<max deg>" tilts (perspective set in CSS); data-spotlight sets --x/--y.
// Fine pointer + hover + motion allowed only; otherwise no listeners are attached at all. Transform/opacity/CSS vars only.
const els = matchMedia('(hover:hover) and (pointer:fine) and (prefers-reduced-motion: no-preference)').matches
  ? [...document.querySelectorAll('[data-tilt],[data-spotlight]')] : [];
const fns = els.map((el) => {
  const max = +el.dataset.tilt || 0, st = el.style;
  let r, tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, on = 0, out = 0;
  const measure = () => { r = el.getBoundingClientRect(); };
  const loop = () => {
    cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12;
    st.setProperty('--rx', cx.toFixed(2) + 'deg'); st.setProperty('--ry', cy.toFixed(2) + 'deg');
    raf = on && (Math.abs(tx - cx) > 0.01 || Math.abs(ty - cy) > 0.01) ? requestAnimationFrame(loop) : 0;
  };
  el.addEventListener('pointerenter', () => {
    measure(); on = 1; clearTimeout(out); el.classList.remove('tilt-out'); el.classList.add('is-hover');
    if (max) st.willChange = 'transform';
  });
  el.addEventListener('pointermove', (e) => {
    if (!r) measure();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    st.setProperty('--x', (x * r.width).toFixed(0) + 'px'); st.setProperty('--y', (y * r.height).toFixed(0) + 'px');
    st.setProperty('--mx', (x * 100).toFixed(1) + '%'); st.setProperty('--my', (y * 100).toFixed(1) + '%');
    if (max) { tx = (0.5 - y) * 2 * max; ty = (x - 0.5) * 2 * max; raf ||= requestAnimationFrame(loop); }
  });
  el.addEventListener('pointerleave', () => {
    on = 0; cancelAnimationFrame(raf); raf = 0; tx = ty = cx = cy = 0;
    el.classList.remove('is-hover'); if (!max) return;
    el.classList.add('tilt-out'); st.setProperty('--rx', '0deg'); st.setProperty('--ry', '0deg');
    out = setTimeout(() => { el.classList.remove('tilt-out'); st.willChange = ''; }, 600);
  });
  return measure;
});
if (fns.length) addEventListener('resize', () => fns.forEach((f) => f()), { passive: true });
