// Storefront platform sniffing. Cheap synchronous checks, first hit wins.
// Runs only at fill time — never at page load.
(() => {
  const g = globalThis;
  g.SFCCAF = g.SFCCAF || {};

  g.SFCCAF.detectPlatform = function detectPlatform(doc) {
    const d = doc || document;

    // SFRA: reference-architecture markup / data attributes.
    if (
      d.querySelector(
        'form.registration, form.checkout-shipping-form, #checkout-main, [data-action-url], .veil .spinner'
      ) ||
      d.querySelector('.page[data-action]') ||
      (d.querySelector('#maincontent') && d.querySelector('.header-banner'))
    ) {
      return 'sfra';
    }

    // SiteGenesis: dwfrm_* form fields or the classic pt_* page wrappers.
    if (
      d.querySelector('input[name^="dwfrm_"], select[name^="dwfrm_"], button[name^="dwfrm_"]') ||
      d.querySelector('#wrapper.pt_checkout, #wrapper.pt_account, #wrapper[class*="pt_"]') ||
      (g.app && g.app.constants)
    ) {
      return 'sitegenesis';
    }

    // PWA Kit: React root with sf-* testids, Chakra classes, or the preloaded state.
    if (
      d.querySelector('#root [data-testid^="sf-"]') ||
      d.querySelector('#root .chakra-input, #root [class*="chakra-"]') ||
      g.__PRELOADED_STATE__ ||
      (g.__CONFIG__ && g.__CONFIG__.app && g.__CONFIG__.app.commerceAPI)
    ) {
      return 'pwakit';
    }

    return 'unknown';
  };
})();
