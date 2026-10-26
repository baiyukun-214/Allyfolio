// /pay: Paddle default payment link handler. Paddle.js auto-opens checkout when the URL has ?_ptxn=txn_… after Initialize.
(function () {
  var cfg = document.getElementById('paddle-pay');
  if (!cfg || !window.Paddle) return;
  if (cfg.dataset.env === 'sandbox') window.Paddle.Environment.set('sandbox');
  var txn = new URLSearchParams(location.search).get('_ptxn') || '';
  window.Paddle.Initialize({
    token: cfg.dataset.token,
    checkout: { settings: { displayMode: 'overlay', locale: cfg.dataset.locale, successUrl: cfg.dataset.success + (txn ? '&txn=' + encodeURIComponent(txn) : '') } },
    eventCallback: function (ev) {
      if (ev && ev.name === 'checkout.completed') {
        var m = document.getElementById('pay-msg'); if (m) m.textContent = cfg.dataset.thanks;
      }
    }
  });
})();
