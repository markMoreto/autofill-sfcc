// Content-script entry point. The ONLY work done at page load is registering
// this message listener — no observers, no polling, no data loading. All
// detection happens on demand when a FILL message arrives (the payload
// carries the data, selector maps and generated profile from the background).
(() => {
  const g = globalThis;
  if (g.SFCCAF && g.SFCCAF.contentLoaded) return;
  g.SFCCAF = g.SFCCAF || {};
  g.SFCCAF.contentLoaded = true;

  const isTop = (() => { try { return window.self === window.top; } catch { return false; } })();
  const frameLabel = isTop ? 'top' : `frame:${location.hostname}`;

  // A reveal toggle must be button-like. Anchors that would navigate are
  // never clicked — theme class collisions must not send the page elsewhere.
  function isClickSafe(el) {
    const tag = el.tagName;
    if (tag === 'BUTTON') return true;
    if (tag === 'INPUT' && ['button', 'checkbox', 'radio'].includes(el.type)) return true;
    if (el.getAttribute('role') === 'button') return true;
    if (tag === 'A') {
      const href = el.getAttribute('href') || '';
      return href === '' || href === '#' || href.startsWith('javascript:');
    }
    return false;
  }

  // Expand a collapsed section (e.g. SFRA billing edit) ONLY when the group
  // has no visible fields — an already-open section must never be clicked.
  // Returns a report of what was clicked for the popup's result panel.
  async function clickReveals(map, scope, fields) {
    const reveals = (map && map.reveals) || {};
    // 'guest' reveals are submit buttons on some platforms (they navigate!) —
    // only click them when the user explicitly asked for the guest scope.
    const wanted = (scope === 'all' ? Object.keys(reveals).filter((k) => k !== 'guest') : [scope])
      .filter((key) => reveals[key] && reveals[key].length);
    const clicked = [];
    // Only core address fields tell whether the collapsible section is open —
    // the same-as-shipping checkbox and contact email/phone live outside it.
    const CORE = ['firstName', 'lastName', 'address1', 'address2', 'city', 'postalCode', 'state', 'country'];
    for (const key of wanted) {
      const groupVisible = CORE.some((base) =>
        (fields[`${key}.${base}`] || []).some((el) => g.SFCCAF.isVisible(el))
      );
      if (groupVisible) continue; // section already open — nothing to reveal
      for (const sel of reveals[key] || []) {
        let el;
        try { el = document.querySelector(sel); } catch { continue; }
        if (!el || !g.SFCCAF.isVisible(el) || !isClickSafe(el)) continue;
        console.debug('[SFCC Autofill] clicking reveal for', key, '→', sel, el);
        el.click();
        clicked.push({ field: `reveal:${key}`, selector: sel, frame: frameLabel });
        break; // one toggle per section
      }
    }
    if (clicked.length) await new Promise((r) => setTimeout(r, 250));
    return clicked;
  }

  async function handleFill(msg) {
    const started = performance.now();

    // Hosted payment iframe? Fill card fields only.
    if (!isTop) {
      const vendor = g.SFCCAF.hostedVendorForFrame(msg.maps.hosted, location.hostname);
      if (vendor) {
        const result = await g.SFCCAF.fillHostedFrame(vendor, msg.profile, frameLabel);
        return {
          platform: 'hosted:' + vendor.id, isTop, frame: frameLabel,
          filled: result.filled, skipped: result.skipped, unresolved: [],
          durationMs: Math.round(performance.now() - started),
        };
      }
      // Non-vendor iframe: fall through and treat like a normal document
      // (some storefronts render checkout steps in same-origin iframes).
    }

    const platform = g.SFCCAF.detectPlatform(document);
    const platformMap = msg.maps[platform];

    let { fields, unresolved } = g.SFCCAF.buildFieldMap(
      msg.scope, msg.maps, platform, msg.countryMeta, document
    );

    // If a section (e.g. SFRA billing) is collapsed, open it and re-detect.
    let revealClicks = [];
    if (platform === 'sfra' || platform === 'sitegenesis') {
      revealClicks = await clickReveals(platformMap, msg.scope, fields);
      if (revealClicks.length) {
        ({ fields, unresolved } = g.SFCCAF.buildFieldMap(
          msg.scope, msg.maps, platform, msg.countryMeta, document
        ));
      }
    }

    const { filled, skipped } = await g.SFCCAF.applyProfile({
      scope: msg.scope,
      fields,
      profile: msg.profile,
      countryMeta: msg.countryMeta,
      options: msg.options,
      frameLabel,
    });

    if (filled.length || skipped.length) {
      console.debug('[SFCC Autofill]', platform, 'filled:', filled, 'skipped:', skipped, 'unresolved:', unresolved);
    }

    // Only frames that actually found something report unresolved fields —
    // an empty ad iframe shouldn't flag "missing card number".
    return {
      platform, isTop, frame: frameLabel,
      filled: [...revealClicks, ...filled], skipped,
      unresolved: filled.length || skipped.length ? unresolved : [],
      durationMs: Math.round(performance.now() - started),
    };
  }

  // ---- per-host override element picker (activated from the popup) ----
  function robustSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
    const cls = Array.from(el.classList).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
    return el.tagName.toLowerCase() + cls;
  }

  function startPicker(field) {
    const prevOutline = new Map();
    const onOver = (e) => {
      const t = e.target;
      if (!/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      prevOutline.set(t, t.style.outline);
      t.style.outline = '2px solid #007a80';
    };
    const onOut = (e) => {
      const t = e.target;
      if (prevOutline.has(t)) { t.style.outline = prevOutline.get(t); prevOutline.delete(t); }
    };
    const onClick = (e) => {
      const t = e.target;
      if (!/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      chrome.runtime.sendMessage({
        type: 'SAVE_OVERRIDE',
        hostname: location.hostname,
        field,
        selector: robustSelector(t),
      });
    };
    const onKey = (e) => { if (e.key === 'Escape') cleanup(); };
    const cleanup = () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      for (const [el, val] of prevOutline) el.style.outline = val;
    };
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'FILL') {
      handleFill(msg)
        .catch((e) => ({
          platform: 'unknown', isTop, frame: frameLabel,
          filled: [], skipped: [{ field: 'error', reason: String(e && e.stack || e) }],
          unresolved: [], durationMs: 0,
        }))
        .then((result) => {
          chrome.runtime.sendMessage({ type: 'FILL_RESULT', fillId: msg.fillId, result });
        });
      return false; // results flow back via FILL_RESULT, not sendResponse
    }
    if (msg && msg.type === 'PICKER' && isTop) {
      startPicker(msg.field);
      return false;
    }
    return false;
  });
})();
