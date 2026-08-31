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

  async function clickReveals(map, scope) {
    // Expand collapsed sections (SFRA billing edit, guest-checkout reveal)
    // before detection, so hidden-but-fillable fields become visible.
    const reveals = (map && map.reveals) || {};
    // 'guest' reveals are submit buttons on some platforms (they navigate!) —
    // only click them when the user explicitly asked for the guest scope.
    const wanted = scope === 'all' ? Object.keys(reveals).filter((k) => k !== 'guest') : [scope];
    let clicked = false;
    for (const key of wanted) {
      for (const sel of reveals[key] || []) {
        let el;
        try { el = document.querySelector(sel); } catch { continue; }
        if (el && g.SFCCAF.isVisible(el)) {
          el.click();
          clicked = true;
        }
      }
    }
    if (clicked) await new Promise((r) => setTimeout(r, 250));
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
    if (platform === 'sfra' || platform === 'sitegenesis') {
      await clickReveals(platformMap, msg.scope);
    }

    const { fields, unresolved } = g.SFCCAF.buildFieldMap(
      msg.scope, msg.maps, platform, msg.countryMeta, document
    );

    const { filled, skipped } = await g.SFCCAF.applyProfile({
      scope: msg.scope,
      fields,
      profile: msg.profile,
      countryMeta: msg.countryMeta,
      options: msg.options,
      frameLabel,
    });

    // Only frames that actually found something report unresolved fields —
    // an empty ad iframe shouldn't flag "missing card number".
    return {
      platform, isTop, frame: frameLabel,
      filled, skipped,
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
