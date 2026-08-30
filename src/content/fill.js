// Fill engine: sets values with correct event sequences (React-safe native
// setter), fills in dependency order (country before state), waits for
// SFRA/SG state-option reloads, and handles checkboxes, selects, combined
// expiry inputs and masked card numbers.
(() => {
  const g = globalThis;
  g.SFCCAF = g.SFCCAF || {};

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function describeEl(el) {
    if (el.id) return `#${el.id}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
    return el.tagName.toLowerCase();
  }

  // Bypasses React's tracked value setter, then notifies frameworks/validators.
  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillText(el, value) {
    el.focus();
    setNativeValue(el, value);
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Per-character typing for hosted payment fields that reject synthetic input.
  async function typeInto(el, value) {
    el.focus();
    let current = '';
    for (const ch of String(value)) {
      const key = { key: ch, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', key));
      el.dispatchEvent(new KeyboardEvent('keypress', key));
      current += ch;
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (desc && desc.set) desc.set.call(el, current);
      else el.value = current;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      el.dispatchEvent(new KeyboardEvent('keyup', key));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return el.value.replace(/\D/g, '') === String(value).replace(/\D/g, '');
  }

  function setChecked(el, checked) {
    if (el.checked === checked) return;
    el.focus();
    // click toggles checked and fires click+change (SFRA listens to change,
    // PWA Kit to click) — matches a real user interaction in both.
    el.click();
    if (el.checked !== checked) {
      el.checked = checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // Match by option value, then option text, then any provided alternates.
  function setSelectValue(el, wanted) {
    const attempts = [wanted.value, wanted.text, ...(wanted.alternates || [])].filter(Boolean);
    for (const attempt of attempts) {
      const target = String(attempt).trim().toLowerCase();
      for (const opt of el.options) {
        if (
          String(opt.value).trim().toLowerCase() === target ||
          String(opt.textContent).trim().toLowerCase() === target
        ) {
          if (el.value !== opt.value) setNativeValue(el, opt.value);
          else {
            // Re-dispatch change so country->state handlers still run.
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return true;
        }
      }
    }
    return false;
  }

  // After a country change SFRA/SG reload state options via AJAX. Poll until
  // the (possibly re-rendered) select has real options, is gone, or times out.
  async function waitForStateOptions(resolveEl, { timeout = 1500, interval = 50 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const el = resolveEl();
      if (!el) return null; // removed: country has no states
      if (el.tagName === 'INPUT') return el; // degraded to a text input
      if (el.options.length > 1 || (el.options.length === 1 && el.options[0].value)) return el;
      if (Date.now() >= deadline) return el;
      await sleep(interval);
    }
  }

  function formatExpiry(el, card) {
    const placeholder = (el.getAttribute('placeholder') || '').toUpperCase();
    const maxLen = parseInt(el.getAttribute('maxlength') || '0', 10);
    if (maxLen === 4) return `${card.month}${card.yearShort}`;
    if (placeholder.includes('YYYY')) {
      const sep = placeholder.includes(' / ') ? ' / ' : '/';
      return `${card.month}${sep}${card.year}`;
    }
    if (placeholder.includes(' / ')) return `${card.month} / ${card.yearShort}`;
    return `${card.month}/${card.yearShort}`;
  }

  function phoneValueFor(el, profile) {
    const maxLen = parseInt(el.getAttribute('maxlength') || '0', 10);
    const numericOnly =
      (el.getAttribute('inputmode') || '') === 'numeric' || el.type === 'number';
    if (numericOnly || (maxLen > 0 && maxLen < profile.phone.length)) {
      return profile.phoneNationalCompact;
    }
    return profile.phone;
  }

  // ------------------------------------------------ profile application

  const GROUP_ORDER = ['address', 'shipping', 'billing'];
  const ADDRESS_FIELD_ORDER = ['firstName', 'lastName', 'country', 'state', 'address1', 'address2', 'city', 'postalCode', 'phone', 'email'];

  /**
   * @param {object} ctx {scope, fields, profile, countryMeta, options, frameLabel, stateWaitMs}
   * @returns {Promise<{filled:[], skipped:[]}>}
   */
  g.SFCCAF.applyProfile = async function applyProfile(ctx) {
    const { fields, profile, countryMeta, options } = ctx;
    const filled = [];
    const skipped = [];
    const done = (logical, el) => filled.push({ field: logical, selector: describeEl(el), frame: ctx.frameLabel || 'top' });
    const skip = (logical, reason) => skipped.push({ field: logical, reason });

    const fillOne = (logical, el, value) => {
      if (value == null || value === '') return skip(logical, 'no value for this country/profile');
      if (!g.SFCCAF.isVisible(el)) return skip(logical, 'hidden');
      fillText(el, value);
      done(logical, el);
    };

    // --- identity / account fields
    const simple = {
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      emailConfirm: profile.email,
      password: profile.password,
      passwordConfirm: profile.password,
      loginEmail: profile.email,
      loginPassword: profile.password,
      guestEmail: profile.email,
    };
    for (const [logical, value] of Object.entries(simple)) {
      for (const el of fields[logical] || []) fillOne(logical, el, value);
    }
    for (const el of fields.phone || []) fillOne('phone', el, phoneValueFor(el, profile));
    for (const el of fields['address.addressId'] || []) {
      fillOne('address.addressId', el, `QA ${profile.address ? profile.address.city : 'addr'} ${Date.now().toString(36).slice(-5)}`);
    }
    for (const el of fields.terms || []) { setChecked(el, true); done('terms', el); }

    // --- billing same-as-shipping
    let skipBillingAddress = false;
    const sameEls = fields['billing.sameAsShipping'] || [];
    if (sameEls.length) {
      const el = sameEls[0];
      setChecked(el, !!options.billingSameAsShipping);
      done('billing.sameAsShipping', el);
      skipBillingAddress = !!options.billingSameAsShipping;
    }

    // --- address groups (dependency order: country -> await states -> state -> rest)
    for (const group of GROUP_ORDER) {
      const source = group === 'billing' ? profile.billing : profile.address;
      if (!source) continue;
      const has = (base) => (fields[`${group}.${base}`] || []).length > 0;
      if (!ADDRESS_FIELD_ORDER.some(has)) continue;

      if (group === 'billing' && skipBillingAddress) {
        // SFRA still requires billing contact info when reusing the shipping address.
        for (const el of fields['billing.email'] || []) fillOne('billing.email', el, profile.email);
        for (const el of fields['billing.phone'] || []) fillOne('billing.phone', el, phoneValueFor(el, profile));
        for (const base of ['firstName', 'lastName', 'address1', 'city', 'postalCode', 'state', 'country']) {
          if (has(base)) skip(`billing.${base}`, 'billing same as shipping');
        }
        continue;
      }

      // country first
      for (const el of fields[`${group}.country`] || []) {
        if (!g.SFCCAF.isVisible(el)) { skip(`${group}.country`, 'hidden'); continue; }
        const ok = el.tagName === 'SELECT'
          ? setSelectValue(el, { value: source.country, text: source.countryName })
          : (fillText(el, source.country), true);
        ok ? done(`${group}.country`, el) : skip(`${group}.country`, `no option for ${source.country}`);
      }

      // state (after waiting for a possible option reload)
      const stateEls = fields[`${group}.state`] || [];
      if (stateEls.length) {
        const original = stateEls[0];
        const resolveEl = () => {
          const current = original.isConnected ? original
            : (original.id && document.getElementById(original.id)) || null;
          return current && g.SFCCAF.isVisible(current) ? current : (current && !g.SFCCAF.isVisible(current) ? null : current);
        };
        if (countryMeta.state.mode === 'none' && original.tagName === 'SELECT' && original.options.length <= 1) {
          skip(`${group}.state`, 'country has no states');
        } else {
          const el = await waitForStateOptions(resolveEl, { timeout: ctx.stateWaitMs || 1500 });
          if (!el) skip(`${group}.state`, 'state field removed/hidden after country change');
          else if (el.tagName === 'SELECT') {
            const ok = setSelectValue(el, {
              value: source.state,
              text: source.stateName,
              alternates: Object.entries(countryMeta.states)
                .filter(([code]) => code === source.state)
                .map(([, name]) => name),
            });
            ok ? done(`${group}.state`, el)
               : (countryMeta.state.required
                   ? skip(`${group}.state`, `no option for ${source.state || source.stateName}`)
                   : skip(`${group}.state`, 'state not applicable'));
          } else {
            fillText(el, countryMeta.state.mode === 'name' ? (source.stateName || source.state) : source.state);
            done(`${group}.state`, el);
          }
        }
      }

      // remaining address fields
      const rest = {
        firstName: source.firstName,
        lastName: source.lastName,
        address1: source.address1,
        address2: source.address2,
        city: source.city,
        postalCode: source.postalCode || (countryMeta.postal.required ? countryMeta.postal.example : ''),
        email: group === 'billing' ? profile.email : null,
      };
      for (const [base, value] of Object.entries(rest)) {
        for (const el of fields[`${group}.${base}`] || []) {
          if (base === 'address2' && !value) continue; // optional, don't report
          fillOne(`${group}.${base}`, el, value);
        }
      }
      for (const el of fields[`${group}.phone`] || []) {
        fillOne(`${group}.phone`, el, phoneValueFor(el, { ...profile, phone: source.phone || profile.phone }));
      }
    }

    // --- card
    if (profile.card) {
      const card = profile.card;
      for (const el of fields['card.holder'] || []) fillOne('card.holder', el, card.holder);
      for (const el of fields['card.number'] || []) {
        if (!g.SFCCAF.isVisible(el)) { skip('card.number', 'hidden'); continue; }
        // Set raw digits; masks (Cleave.js on SFRA #cardNumber) reformat on input.
        fillText(el, card.number);
        done('card.number', el);
      }
      for (const el of fields['card.expMonth'] || []) {
        if (el.tagName === 'SELECT') {
          const ok = setSelectValue(el, { value: card.month, alternates: [String(+card.month)] });
          ok ? done('card.expMonth', el) : skip('card.expMonth', `no option ${card.month}`);
        } else fillOne('card.expMonth', el, card.month);
      }
      for (const el of fields['card.expYear'] || []) {
        if (el.tagName === 'SELECT') {
          const ok = setSelectValue(el, { value: card.year, alternates: [card.yearShort] });
          ok ? done('card.expYear', el) : skip('card.expYear', `no option ${card.year}`);
        } else fillOne('card.expYear', el, card.year);
      }
      for (const el of fields['card.expiry'] || []) fillOne('card.expiry', el, formatExpiry(el, card));
      for (const el of fields['card.cvv'] || []) fillOne('card.cvv', el, card.cvv);
      for (const el of fields['card.type'] || []) {
        if (el.tagName === 'SELECT') {
          setSelectValue(el, { value: card.type, text: card.type, alternates: [card.brand] })
            ? done('card.type', el) : skip('card.type', `no option ${card.type}`);
        } else if (el.value !== card.type) {
          setNativeValue(el, card.type);
          done('card.type', el);
        }
      }
    } else if (ctx.scope === 'card' || ctx.scope === 'all') {
      if (profile.cardInstructions && (fields['card.number'] || []).length === 0) {
        skip('card', 'vendor has no fillable card — see instructions in the popup');
      }
    }

    return { filled, skipped };
  };

  g.SFCCAF.fillUtil = { setNativeValue, fillText, typeInto, setChecked, setSelectValue, waitForStateOptions, formatExpiry, describeEl };
})();
