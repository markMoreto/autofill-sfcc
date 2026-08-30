// Field detection: resolves logical field names to DOM elements using the
// platform selector map (merged with per-host overrides), falling back to
// scored generic heuristics. One querySelectorAll pass per fill, no observers.
(() => {
  const g = globalThis;
  g.SFCCAF = g.SFCCAF || {};

  const SCOPE_FIELDS = {
    registration: ['firstName', 'lastName', 'email', 'emailConfirm', 'phone', 'password', 'passwordConfirm', 'newsletter'],
    login: ['loginEmail', 'loginPassword'],
    contact: ['firstName', 'lastName', 'email', 'phone'],
    guest: ['guestEmail', 'email'],
    address: ['address.addressId', 'address.firstName', 'address.lastName', 'address.address1', 'address.address2', 'address.country', 'address.state', 'address.city', 'address.postalCode', 'address.phone', 'account.setDefault'],
    shipping: ['shipping.firstName', 'shipping.lastName', 'shipping.address1', 'shipping.address2', 'shipping.country', 'shipping.state', 'shipping.city', 'shipping.postalCode', 'shipping.phone'],
    billing: ['billing.firstName', 'billing.lastName', 'billing.address1', 'billing.address2', 'billing.country', 'billing.state', 'billing.city', 'billing.postalCode', 'billing.phone', 'billing.email', 'billing.sameAsShipping'],
    card: ['card.holder', 'card.number', 'card.expMonth', 'card.expYear', 'card.expiry', 'card.cvv', 'card.type'],
  };
  SCOPE_FIELDS.all = [
    ...SCOPE_FIELDS.registration, ...SCOPE_FIELDS.login, ...SCOPE_FIELDS.guest,
    ...SCOPE_FIELDS.address, ...SCOPE_FIELDS.shipping, ...SCOPE_FIELDS.billing,
    ...SCOPE_FIELDS.card,
  ];

  // Fields whose absence makes the surrounding group report `unresolved`
  // (only when at least one field of the group WAS found). `postalCode` and
  // `state` requirements are decided per-country at build time.
  const GROUP_REQUIRED = {
    registration: ['firstName', 'lastName', 'email', 'password'],
    address: ['address.firstName', 'address.lastName', 'address.address1', 'address.city'],
    shipping: ['shipping.firstName', 'shipping.lastName', 'shipping.address1', 'shipping.city'],
    billing: ['billing.address1', 'billing.city'],
    card: ['card.number', 'card.cvv'],
  };

  const FILLABLE_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

  function isFillable(el, logical) {
    if (!el || !FILLABLE_TAGS.has(el.tagName)) return false;
    if (el.disabled || el.readOnly) return false;
    // Hidden inputs are only fillable for card.type (SFRA keeps it hidden).
    if (el.type === 'hidden') return logical === 'card.type';
    return true;
  }

  // Visibility: cheap layout check in a real browser; in layoutless
  // environments (jsdom fixtures) fall back to inline styles / hidden attrs.
  function isVisible(el) {
    if (el.type === 'hidden') return true; // handled by isFillable
    const hasLayout = !!(document.body && (document.body.offsetWidth || document.body.offsetHeight));
    if (hasLayout) return el.offsetParent !== null || el.getClientRects().length > 0;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden) return false;
      const s = n.getAttribute && n.getAttribute('style');
      if (s && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(s)) return false;
    }
    return true;
  }

  function queryAllSafe(root, selector) {
    try { return Array.from(root.querySelectorAll(selector)); } catch { return []; }
  }

  function resolveFromMap(root, map, logical) {
    const selectors = (map && map.fields && map.fields[logical]) || [];
    for (const sel of selectors) {
      const matches = queryAllSafe(root, sel).filter((el) => isFillable(el, logical));
      if (matches.length) return matches;
    }
    return [];
  }

  // ------------------------------------------------ generic heuristics

  const tokenize = (s) => String(s || '').toLowerCase().split(/[_\-.\s[\]]+/).filter(Boolean);

  function containerScope(el, hints) {
    let n = el.parentElement;
    for (let depth = 0; n && depth < 8; depth++, n = n.parentElement) {
      const hay = (
        (n.className && String(n.className)) + ' ' + (n.id || '') + ' ' +
        (n.getAttribute ? (n.getAttribute('data-testid') || '') + ' ' + (n.getAttribute('data-address-type') || '') : '')
      ).toLowerCase();
      for (const t of hints.billing) if (hay.includes(t)) return 'billing';
      for (const t of hints.shipping) if (hay.includes(t)) return 'shipping';
    }
    return null;
  }

  function labelText(el) {
    let text = el.getAttribute('placeholder') || '';
    text += ' ' + (el.getAttribute('aria-label') || '');
    if (el.id) {
      const label = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) text += ' ' + label.textContent;
    }
    const wrapping = el.closest && el.closest('label');
    if (wrapping) text += ' ' + wrapping.textContent;
    return text.toLowerCase();
  }

  function scoreCandidate(el, base, generic) {
    // autocomplete attribute — strongest signal
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase().trim();
    if (ac && generic.autocomplete[ac] === base) return 1.0;
    // name/id tokens
    const tokens = new Set([...tokenize(el.name), ...tokenize(el.id)]);
    const joinedName = String(el.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const joinedId = String(el.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const t of generic.tokens[base] || []) {
      if (tokens.has(t) || joinedName.endsWith(t) || joinedId.endsWith(t)) return 0.8;
    }
    // label / placeholder / aria-label text
    const text = labelText(el);
    for (const t of generic.labels[base] || []) {
      if (text.includes(t)) return 0.6;
    }
    return 0;
  }

  function resolveGeneric(candidates, logical, generic, claimed) {
    const dot = logical.indexOf('.');
    const group = dot > 0 ? logical.slice(0, dot) : null;
    const base = dot > 0 ? logical.slice(dot + 1) : logical;
    // Only address-block groups make sense for container disambiguation.
    const groupKey = group === 'card' ? `card.${base}` : base;

    let best = null;
    let bestScore = 0;
    for (const el of candidates) {
      if (claimed.has(el) || !isFillable(el, logical)) continue;
      let score = scoreCandidate(el, groupKey, generic);
      if (!score) continue;
      if (group === 'shipping' || group === 'billing' || group === 'address') {
        const scope = containerScope(el, generic.containerHints);
        if (group === 'billing' && scope !== 'billing') continue;
        if (group === 'shipping' && scope === 'billing') continue;
        if (group === 'shipping' && scope === null) score *= 0.9; // lone address block: treat as shipping
        if (group === 'address' && scope !== null) continue; // address-book form has no ship/bill container
      }
      if (score > bestScore) { best = el; bestScore = score; }
    }
    return best && bestScore >= generic.threshold ? [best] : [];
  }

  // ------------------------------------------------ public API

  /**
   * @returns {{ fields: Object<string, Element[]>, unresolved: string[], scopeGroups: string[] }}
   */
  g.SFCCAF.buildFieldMap = function buildFieldMap(scope, maps, platform, countryMeta, doc) {
    const root = doc || document;
    const platformMap = maps[platform] || null;
    const override = maps.override || null;
    const generic = maps.generic;
    const logicals = SCOPE_FIELDS[scope] || SCOPE_FIELDS.all;

    const candidates = queryAllSafe(root, 'input, select, textarea').slice(0, 500);
    const fields = {};
    const claimed = new Set();
    const take = (logical, els) => {
      const free = els.filter((el) => !claimed.has(el));
      if (free.length) {
        fields[logical] = free;
        free.forEach((el) => claimed.add(el));
      }
    };

    // Three passes over the full field list — overrides, then platform map,
    // then generic heuristics — so a fuzzy heuristic can never claim an
    // element that an exact platform selector for another field owns.
    for (const logical of logicals) {
      if (override && !fields[logical]) take(logical, resolveFromMap(root, override, logical));
    }
    for (const logical of logicals) {
      if (platformMap && !fields[logical]) take(logical, resolveFromMap(root, platformMap, logical));
    }
    for (const logical of logicals) {
      if (!fields[logical]) take(logical, resolveGeneric(candidates, logical, generic, claimed));
    }

    // unresolved: required fields missing from groups that ARE on the page.
    const unresolved = [];
    // A registration form is only "present" when a password field exists —
    // a lone email input (checkout contact info, newsletter) doesn't count.
    const present = (group) =>
      Object.keys(fields).some((f) =>
        group === 'registration'
          ? ['password', 'passwordConfirm'].includes(f)
          : f.startsWith(group + '.'));
    for (const [group, required] of Object.entries(GROUP_REQUIRED)) {
      if (!present(group)) continue;
      const needed = [...required];
      if (group === 'shipping' || group === 'billing' || group === 'address') {
        if (countryMeta && countryMeta.postal.required) needed.push(`${group}.postalCode`);
        if (countryMeta && countryMeta.state.required && countryMeta.state.mode !== 'none') needed.push(`${group}.state`);
      }
      for (const f of needed) {
        // A bare top-level twin (e.g. `firstName` for `shipping.firstName`)
        // counts as resolved — single-address pages fill it once.
        const bare = f.includes('.') ? f.slice(f.indexOf('.') + 1) : f;
        if (!fields[f] && !fields[bare]) unresolved.push(f);
      }
    }

    return { fields, unresolved };
  };

  g.SFCCAF.SCOPE_FIELDS = SCOPE_FIELDS;
  g.SFCCAF.isVisible = isVisible;
  g.SFCCAF.isFillable = isFillable;
})();
