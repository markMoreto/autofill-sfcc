// Hosted payment-field iframes (Adyen, Stripe, Braintree, Cybersource,
// Checkout.com). The content script runs in every frame; when the current
// frame's host matches a vendor pattern from hosted.json, only card fields
// are filled — with per-character typing where the vendor rejects synthetic
// input events. Best-effort by design; the popup offers Copy buttons as the
// manual fallback.
(() => {
  const g = globalThis;
  g.SFCCAF = g.SFCCAF || {};

  g.SFCCAF.hostedVendorForFrame = function hostedVendorForFrame(hostedMap, hostname) {
    if (!hostedMap || !hostedMap.vendors) return null;
    for (const vendor of hostedMap.vendors) {
      for (const pattern of vendor.hostPatterns) {
        if (new RegExp(pattern).test(hostname)) return vendor;
      }
    }
    return null;
  };

  g.SFCCAF.fillHostedFrame = async function fillHostedFrame(vendor, profile, frameLabel) {
    const filled = [];
    const skipped = [];
    if (!profile.card) return { filled, skipped };
    const card = profile.card;
    const values = {
      'card.number': card.number,
      'card.expiry': `${card.month}/${card.yearShort}`,
      'card.expMonth': card.month,
      'card.expYear': card.year,
      'card.cvv': card.cvv,
      'card.holder': card.holder,
      'card.postalCode': profile.address ? profile.address.postalCode : '',
    };

    for (const [logical, selectors] of Object.entries(vendor.fields)) {
      const value = values[logical];
      if (!value) continue;
      let el = null;
      for (const sel of selectors) {
        try { el = document.querySelector(sel); } catch { el = null; }
        if (el) break;
      }
      if (!el) continue; // most hosted frames contain exactly one field
      const finalValue = logical === 'card.expiry' ? g.SFCCAF.fillUtil.formatExpiry(el, card) : value;
      let ok;
      if (vendor.typingSimulation) {
        ok = await g.SFCCAF.fillUtil.typeInto(el, finalValue);
      } else {
        g.SFCCAF.fillUtil.fillText(el, finalValue);
        ok = true;
      }
      if (ok) filled.push({ field: logical, selector: g.SFCCAF.fillUtil.describeEl(el), frame: frameLabel });
      else skipped.push({ field: logical, reason: `${vendor.id} frame rejected synthetic input — use the Copy buttons in the popup` });
    }
    return { filled, skipped };
  };
})();
