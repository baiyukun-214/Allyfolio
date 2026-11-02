// German messages for the free-scan API error codes. The app API has no German locale yet,
// so German pages map the error `code` to these texts instead of showing the app's English `error`.
export const scanErrorsDe: Record<string, string> = {
  invalid_url: 'Bitte geben Sie eine Adresse wie example.com oder https://example.com/seite ein (fehlt https://, ergänzen wir es automatisch).',
  not_public: 'Bitte geben Sie die Adresse einer öffentlich erreichbaren Website ein.',
  dns_not_found: 'Diese Domain wurde nicht gefunden – die DNS-Abfrage lieferte keine Adresse. Bitte prüfen Sie die Schreibweise (zum Beispiel example.com) und ob die Website online ist.',
  timeout: 'Die Seite wurde nicht innerhalb von 30 Sekunden vollständig geladen. Die Website ist möglicherweise gerade langsam oder ausgelastet. Bitte versuchen Sie es in einigen Minuten erneut oder wählen Sie eine schlankere Seite, etwa einen einzelnen Artikel.',
  blocked: 'Die Website hat unseren Scanner abgewiesen oder die Verbindung getrennt. Manche Websites sperren Zugriffe aus dem Ausland oder aus Rechenzentren; unser Scanner läuft in Deutschland (EU). Versuchen Sie eine andere Seite der Website oder bitten Sie Ihren Hoster, den User-Agent AllyfolioBot zuzulassen.',
  rate_limited: 'Sie haben die kostenlosen Scans für diese Stunde aufgebraucht.',
  rate_limited_min: 'Sie haben die kostenlosen Scans für diese Stunde aufgebraucht. In etwa {min} Min. können Sie wieder scannen.',
  load_failed: 'Die Seite konnte diesmal nicht geladen werden. Bitte prüfen Sie, ob sie sich in Ihrem Browser öffnen lässt, und versuchen Sie es in einigen Minuten erneut. Klappt es weiterhin nicht, versuchen Sie eine andere Seite der Website.',
  busy: 'Unser Scanner ist gerade mit anderen Scans ausgelastet – an Ihrer Seite liegt es nicht. Bitte versuchen Sie es in etwa {wait} erneut.',
};
