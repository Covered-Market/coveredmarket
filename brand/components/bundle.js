/* @ds-bundle: {"format":4,"namespace":"CoveredMarket","components":[{"name":"Button"},{"name":"Stamp"},{"name":"Figure"},{"name":"Coin"},{"name":"Field"},{"name":"StatTile"},{"name":"OfferCard"},{"name":"PositionsTable"},{"name":"Countdown"},{"name":"SettlementTimeline"},{"name":"Notice"},{"name":"TopBar"},{"name":"Certificate"},{"name":"Mark"}]} */
(function () {
  var R = window.React, h = R.createElement;
  function cx() { var out = []; for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]); return out.join(' '); }

  // ---- Mark: the Lid. One coin, its top lifted off. tone: 'ink' (currentColor) | 'two-tone' (intaglio coin, gilt lid) | 'copper' (copper coin, intaglio lid). state: open | kept | exercised. ----
  function Mark(p) {
    var size = p.size || 24, tone = p.tone || 'ink', state = p.state || 'open', small = size < 28;
    var body = tone === 'two-tone' ? 'var(--intaglio)' : tone === 'copper' ? 'var(--copper)' : 'currentColor';
    var cap = tone === 'two-tone' ? 'var(--gilt)' : tone === 'copper' ? 'var(--intaglio)' : body;
    var cx = 32, cy = 33.5, r = 25, k = small ? 0.45 : 0.5, gap = small ? 5 : 3.5;
    if (state === 'kept') gap = small ? 2.2 : 1.4; if (state === 'exercised') gap = small ? 9 : 7;
    var ch = cy - k * r, hw = Math.sqrt(r * r - (cy - ch) * (cy - ch));
    return h('svg', { width: size, height: size, viewBox: '0 0 64 64', 'aria-label': 'CoveredMarket', style: p.style, className: p.className },
      h('path', { fill: body, d: 'M' + (cx - hw) + ',' + ch + ' A' + r + ',' + r + ' 0 1 0 ' + (cx + hw) + ',' + ch + ' Z' }),
      h('path', { fill: cap, d: 'M' + (cx - hw) + ',' + (ch - gap) + ' A' + r + ',' + r + ' 0 0 1 ' + (cx + hw) + ',' + (ch - gap) + ' Z' }));
  }

  // ---- Button ----
  function Button(p) {
    var variant = p.variant || 'quiet', size = p.size || 'md';
    var props = Object.assign({}, p); delete props.variant; delete props.size; delete props.as;
    props.className = cx('cv-btn', 'cv-btn--' + variant, size !== 'md' && 'cv-btn--' + size, p.className);
    if (!props.type && !p.href) props.type = 'button';
    return h(p.href ? 'a' : 'button', props, p.children);
  }

  // ---- Stamp ----
  var ICON = {
    open: h('svg', { viewBox: '0 0 24 24' }, h('circle', { cx: 12, cy: 12, r: 8 })),
    kept: h('svg', { viewBox: '0 0 24 24' }, h('path', { d: 'M5 12l5 5 9-10' })),
    exercised: h('svg', { viewBox: '0 0 24 24' }, h('path', { d: 'M5 19L19 5M9 5h10v10' })),
    settled: h('svg', { viewBox: '0 0 24 24' }, h('path', { d: 'M4 12h16M4 7h16M4 17h10' })),
    pending: h('svg', { viewBox: '0 0 24 24' }, h('circle', { cx: 12, cy: 12, r: 8 }), h('path', { d: 'M12 8v4l3 2' })),
    refused: h('svg', { viewBox: '0 0 24 24' }, h('path', { d: 'M6 6l12 12M18 6L6 18' }))
  };
  var WORD = { open: 'Open', kept: 'Kept', exercised: 'Exercised', settled: 'Settled', pending: 'Pending', refused: 'Refused' };
  function Stamp(p) {
    var s = p.status || 'open';
    return h('span', { className: cx('cv-stamp', 'cv-stamp--' + s, p.flat && 'cv-stamp--flat', p.className), role: 'status' }, ICON[s], p.children || WORD[s]);
  }

  // ---- Figure ----
  function fmt(v, kind) {
    if (typeof v !== 'number') return v;
    if (kind === 'btc') return v.toFixed(4);
    if (kind === 'usd') return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (kind === 'pct') return v.toFixed(1) + '%';
    return v.toLocaleString('en-US');
  }
  function Figure(p) {
    var size = p.size || 'md', kind = p.kind || 'plain';
    var tone = p.tone || (kind === 'btc' ? 'btc' : 'ink');
    var unit = p.unit !== undefined ? p.unit : (kind === 'btc' ? 'BTC' : null);
    return h('span', { className: cx('cv-figure', 'cv-figure--' + size, tone !== 'ink' && 'cv-figure--' + tone, p.className) },
      h('span', null, fmt(p.value, kind)), unit ? h('span', { className: 'cv-figure__unit' }, unit) : null);
  }

  // ---- Coin ----
  function Coin(p) {
    return h('span', { className: cx('cv-coin', p.size === 'lg' && 'cv-coin--lg', p.className) },
      h('span', { className: 'cv-coin__disc', 'aria-hidden': true }),
      h(Figure, { value: p.amount, kind: 'btc', size: p.size === 'lg' ? 'xl' : 'md' }));
  }

  // ---- Field ----
  function Field(p) {
    var id = p.id || ('cvf' + Math.random().toString(36).slice(2, 7));
    return h('label', { className: cx('cv-field', p.invalid && 'cv-field--invalid', p.className), htmlFor: id },
      h('span', { className: 'cv-field__label' }, p.label),
      h('span', { className: 'cv-field__wrap' },
        h('input', { id: id, className: 'cv-field__input', value: p.value, defaultValue: p.defaultValue, placeholder: p.placeholder, onChange: p.onChange, inputMode: p.inputMode || 'decimal', spellCheck: false }),
        p.adorn ? h('span', { className: 'cv-field__adorn' }, p.adorn) : null),
      p.help ? h('span', { className: 'cv-field__help' }, p.help) : null);
  }

  // ---- StatTile ----
  function StatTile(p) {
    return h('div', { className: cx('cv-stat', p.className) },
      h('span', { className: 'cv-stat__label' }, p.label),
      h(Figure, { value: p.value, kind: p.kind, unit: p.unit, size: 'xl', tone: p.tone }),
      p.note ? h('span', { className: 'cv-stat__note' }, p.note) : null);
  }

  // ---- OfferCard ----
  function OfferCard(p) {
    var o = p.offer || {};
    return h('article', { className: cx('cv-offer', p.className) },
      h('div', { className: 'cv-offer__head' },
        h('div', null, h('div', { className: 'cv-offer__k' }, 'Call · expires ' + o.expiry), h('h3', { className: 'cv-offer__title' }, 'Strike ', h('span', { className: 'cv-mono' }, '$' + Number(o.strike).toLocaleString('en-US')))),
        h(Stamp, { status: o.status || 'open', flat: true })),
      h('dl', { className: 'cv-offer__grid' },
        h('div', null, h('dt', { className: 'cv-offer__k' }, 'Size'), h('dd', { style: { margin: 0 } }, h(Coin, { amount: o.size }))),
        h('div', null, h('dt', { className: 'cv-offer__k' }, 'Strike'), h('dd', { style: { margin: 0 } }, h(Figure, { value: o.strike, kind: 'usd' }))),
        h('div', null, h('dt', { className: 'cv-offer__k' }, 'Spot now'), h('dd', { style: { margin: 0 } }, h(Figure, { value: o.spot, kind: 'usd', tone: 'muted' }))),
        h('div', null, h('dt', { className: 'cv-offer__k' }, 'Coins held at'), h('dd', { style: { margin: 0 } }, h(Figure, { value: o.vault, size: 'sm', tone: 'muted' })))),
      h('div', { className: 'cv-offer__premium' },
        h('div', null, h('div', { className: 'cv-offer__k' }, 'Premium'), h(Figure, { value: o.premium, kind: 'usd', size: 'xl', tone: 'gilt' })),
        h('div', { className: 'cv-offer__yield' }, fmt(o.annualised, 'pct') + ' annualised')),
      h('div', { className: 'cv-offer__foot' },
        h('span', { className: 'cv-offer__seller' }, 'seller ' + (o.seller || '')),
        h(Button, { variant: 'primary', onClick: p.onAct }, p.action || 'Buy this call')));
  }

  // ---- PositionsTable ----
  function PositionsTable(p) {
    var rows = p.rows || [];
    return h('table', { className: cx('cv-table', p.className) },
      h('thead', null, h('tr', null, ['Position', 'Size', 'Strike', 'Expiry', 'Premium', 'Status'].map(function (k, i) { return h('th', { key: k, className: i === 1 || i === 2 || i === 4 ? 'cv-num' : '' }, k); }))),
      h('tbody', null, rows.map(function (r) {
        return h('tr', { key: r.id },
          h('td', null, h('span', { className: 'cv-mono' }, r.id), h('div', { style: { color: 'var(--ink-muted)' } }, r.side === 'sell' ? 'Sold call' : 'Bought call')),
          h('td', { className: 'cv-num' }, h(Figure, { value: r.size, kind: 'btc', size: 'sm' })),
          h('td', { className: 'cv-num' }, h(Figure, { value: r.strike, kind: 'usd', size: 'sm' })),
          h('td', null, h('span', { className: 'cv-mono', style: { fontSize: 13 } }, r.expiry)),
          h('td', { className: 'cv-num' }, h(Figure, { value: r.premium, kind: 'usd', size: 'sm', tone: 'gilt' })),
          h('td', null, h(Stamp, { status: r.status, flat: true })));
      })));
  }

  // ---- Countdown ----
  function Countdown(p) {
    var total = p.totalSeconds || 1, left = Math.max(0, Math.min(total, p.secondsLeft || 0));
    var r = 32, C = 2 * Math.PI * r, frac = left / total;
    var d = Math.floor(left / 86400), hh = Math.floor((left % 86400) / 3600), mm = Math.floor((left % 3600) / 60), ss = left % 60;
    var txt = d > 0 ? d + 'd ' + String(hh).padStart(2, '0') + 'h' : String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    return h('div', { className: cx('cv-countdown', frac < 0.1 && 'cv-countdown--due', p.className) },
      h('svg', { className: 'cv-countdown__ring', viewBox: '0 0 72 72' },
        h('circle', { className: 'cv-countdown__track', cx: 36, cy: 36, r: r }),
        h('circle', { className: 'cv-countdown__arc', cx: 36, cy: 36, r: r, strokeDasharray: C, strokeDashoffset: C * (1 - frac) })),
      h('div', null, h('div', { className: 'cv-countdown__label' }, p.label || 'Until expiry'), h(Figure, { value: txt, size: 'xl' }), p.note ? h('div', { className: 'cv-stat__note' }, p.note) : null));
  }

  // ---- SettlementTimeline ----
  function SettlementTimeline(p) {
    var steps = p.steps || [];
    return h('ol', { className: cx('cv-timeline', p.className), style: { listStyle: 'none', padding: 0, margin: 0 } }, steps.map(function (s, i) {
      var st = s.state || 'todo';
      return h('li', { key: i, className: cx('cv-timeline__step', 'cv-timeline__step--' + st) },
        h('span', { className: 'cv-timeline__dot' }, st === 'done' ? ICON.kept : st === 'refused' ? ICON.refused : st === 'now' ? h('svg', { viewBox: '0 0 24 24' }, h('circle', { cx: 12, cy: 12, r: 4, fill: 'currentColor', stroke: 'none' })) : null),
        h('span', null, h('div', { className: 'cv-timeline__title' }, s.title), s.detail ? h('div', { className: 'cv-timeline__detail' }, s.detail) : null),
        h('span', { className: 'cv-timeline__when' }, s.when || ''));
    }));
  }

  // ---- Notice ----
  function Notice(p) {
    return h('div', { className: cx('cv-notice', p.tone === 'refused' && 'cv-notice--refused', p.className), role: p.tone === 'refused' ? 'alert' : 'note' },
      h('span', { className: 'cv-notice__mark', 'aria-hidden': true }, p.tone === 'refused' ? '✕' : 'N.B.'), h('span', null, p.children));
  }

  // ---- TopBar ----
  function TopBar(p) {
    var items = p.items || [];
    return h('header', { className: cx('cv-topbar', p.className) },
      h('a', { className: 'cv-topbar__brand', href: p.href || '#' }, h(Mark, { tone: 'two-tone', size: 28 }), h('span', { className: 'cv-topbar__word' }, 'CoveredMarket')),
      h('nav', { className: 'cv-topbar__nav' }, items.map(function (it) { return h('a', { key: it.label, href: it.href || '#', className: cx('cv-topbar__link', it.on && 'cv-topbar__link--on') }, it.label); })),
      h('div', { className: 'cv-topbar__right' }, p.children));
  }

  // ---- Certificate ----
  function braid(y) {
    var pts = [];
    for (var k = 0; k < 8; k++) {
      var ph = Math.PI * k / 8, s = '';
      for (var x = 0; x <= 720; x += 6) s += x + ',' + (14 + 11 * Math.sin(2 * Math.PI * x / 120 + ph)).toFixed(1) + ' ';
      pts.push(h('polyline', { key: k, points: s }));
      var s2 = '';
      for (var x2 = 0; x2 <= 720; x2 += 6) s2 += x2 + ',' + (14 - 11 * Math.sin(2 * Math.PI * x2 / 120 + ph)).toFixed(1) + ' ';
      pts.push(h('polyline', { key: 'm' + k, points: s2 }));
    }
    return h('svg', { className: 'cv-cert__band cv-cert__band--' + y, viewBox: '0 0 720 28', preserveAspectRatio: 'none', 'aria-hidden': true }, pts);
  }
  function Certificate(p) {
    var c = p.contract || {};
    return h('article', { className: cx('cv-cert', p.className) },
      braid('top'), braid('bottom'),
      h(Mark, { className: 'cv-cert__mark', tone: 'two-tone', size: 56 }),
      h('header', { className: 'cv-cert__head' },
        h('div', null, h('div', { className: 'cv-cert__kicker' }, 'Covered call · native Bitcoin'), h('h2', { className: 'cv-cert__title' }, 'Call option on ', h('span', { className: 'cv-mono' }, fmt(c.size, 'btc') + ' BTC'))),
        h('div', { className: 'cv-cert__serial' }, 'No. ' + (c.serial || '—'), h('br'), 'Issued ' + (c.issued || ''))),
      h('div', { className: 'cv-cert__body' },
        h('p', { className: 'cv-cert__lede' }, 'The holder may buy ' + fmt(c.size, 'btc') + ' BTC at ' + fmt(c.strike, 'usd') + ' per coin on ' + c.expiry + '. Until then the coins stay on Bitcoin at an address only the contract can sign for.'),
        h('div', { className: 'cv-cert__terms' },
          h('span', { className: 'cv-cert__k' }, 'Strike'), h(Figure, { value: c.strike, kind: 'usd' }),
          h('span', { className: 'cv-cert__k' }, 'Expiry'), h('span', { className: 'cv-mono' }, c.expiry),
          h('span', { className: 'cv-cert__k' }, 'Premium'), h(Figure, { value: c.premium, kind: 'usd', tone: 'gilt' }),
          h('span', { className: 'cv-cert__k' }, 'Coins at'), h('span', { className: 'cv-cert__addr' }, c.vault),
          h('span', { className: 'cv-cert__k' }, 'Status'), h(Stamp, { status: c.status || 'open' }))),
      h('footer', { className: 'cv-cert__foot' },
        h('div', { className: 'cv-cert__parties' }, 'Seller ', h('b', null, c.seller), ' · Buyer ', h('b', null, c.buyer || '—'), h('br'), 'Contract ', h('span', { className: 'cv-mono' }, c.contractId || 'coveredmarket.near'), ' · settles by Chain Signatures'),
        h('div', { className: 'cv-row' }, p.children)));
  }

  window.CoveredMarket = { Button: Button, Stamp: Stamp, Figure: Figure, Coin: Coin, Field: Field, StatTile: StatTile, OfferCard: OfferCard, PositionsTable: PositionsTable, Countdown: Countdown, SettlementTimeline: SettlementTimeline, Notice: Notice, TopBar: TopBar, Certificate: Certificate, Mark: Mark };
})();
