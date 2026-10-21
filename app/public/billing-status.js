// After returning from checkout (?paid=1): poll /app/billing/status every 2 s for up to 30 s.
// Announces progress in the aria-live region and reloads (without ?paid) once the plan or one-off credit changed.
(function () {
  var el = document.getElementById('pay-status');
  if (!el || !window.fetch) return;
  var plan = el.dataset.plan, credits = Number(el.dataset.credits || 0), tries = 0, max = 15;
  function done(msg) { el.textContent = msg; }
  function tick() {
    tries++;
    fetch('/app/billing/status', { headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (s && ((s.plan !== plan && s.plan !== 'none') || s.credits > credits)) {
          done(el.dataset.done);
          setTimeout(function () { location.replace(location.pathname); }, 800);
        } else if (tries < max) setTimeout(tick, 2000);
        else done(el.dataset.slow);
      })
      .catch(function () { if (tries < max) setTimeout(tick, 2000); else done(el.dataset.slow); });
  }
  setTimeout(tick, 2000);
})();
