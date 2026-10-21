// Progressive enhancement: open Paddle's checkout overlay for a transaction created by the server.
// Without JavaScript the same form posts normally and redirects to Paddle's hosted checkout.
(function () {
  var cfg = document.getElementById('paddle-config');
  if (!cfg || !window.Paddle) return;
  if (cfg.dataset.env === 'sandbox') window.Paddle.Environment.set('sandbox');
  window.Paddle.Initialize({ token: cfg.dataset.token });
  document.querySelectorAll('form[data-checkout]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button'); btn.disabled = true;
      fetch(form.action, { method: 'POST', headers: { accept: 'application/json' }, body: new URLSearchParams(new FormData(form)) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'error'); return j; }); })
        .then(function (j) {
          window.Paddle.Checkout.open({ transactionId: j.transactionId, customer: { email: cfg.dataset.email },
            settings: { displayMode: 'overlay', locale: cfg.dataset.locale, successUrl: location.origin + cfg.dataset.success + '&txn=' + encodeURIComponent(j.transactionId) } });
        })
        .catch(function () { form.submit(); })
        .finally(function () { btn.disabled = false; });
    });
  });
})();
