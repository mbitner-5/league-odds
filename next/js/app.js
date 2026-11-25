/* League Odds - the page. Built from the single-league page; draws any league the reader hands it. */
(function (root) {
  'use strict';
  var C = root.LOCore, E = root.LOEngine, M = root.LOModel;
  // ctx = { league, proj, shared, draft: { show, season, rounds, traded, rule }, saved, onRun }
  function mount(ctx) {
  var N = 40000, SEED = 20261124, SWITCH = 0.68;   // SWITCH: where chip text turns white (keeps contrast above 4.5:1)
  var LG = ctx.league, T = LG.teams, n = T.length, PT = Math.min(LG.set.P, n), proj = ctx.proj || {}, shared = ctx.shared || { players: {} };
  var D = ctx.draft;                                  // { show, season, rounds, traded, rule }
  var BI = E.bracketInfo(LG.bracket), R = BI.rounds, NB = BI.byeSeeds.length, hasDiv = LG.set.nDiv > 1;
  var state = { picks: [], tab: 'playoffs', mode: 'blend', open: -1, mine: -1, week: null, luWeek: null, np: D.rule.nonPlayoff, nums: false };
  var cfg, baseCache = {}, base, cur, cl6, cl2, c06, c02, G = 0, orderNow = [], seedNow = [], gameRank = {}, pending = 0, stale = false, levIx = {};
  var $ = function (id) { return document.getElementById(id); };
  var TABS = D.show ? ['playoffs', 'draft', 'lineups', 'method'] : ['playoffs', 'lineups', 'method'];
  var NONE = { clinched: new Array(n).fill(false), eliminated: new Array(n).fill(false) };
  function decided(g) { var lv = cfg && cfg.live; return !!lv && g.week === lv.week && lv.share[g.a] === 0 && lv.share[g.b] === 0; }

  /* ---------- small helpers ---------- */
  function el(tag, attrs, kids) {
    var e = document.createElement(tag), k;
    if (attrs) for (k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k === 'bg') e.style.background = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function sv(tag, attrs) { var e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function pct(p, zero, one) {
    if (one) return '100%';
    if (zero) return '–';
    if (p >= 0.995) return '>99%';
    if (p < 0.005) return '<1%';
    return Math.round(p * 100) + '%';
  }
  function pz(p) { return pct(p, p <= 0); }                 // dash when it never happened
  function pct1(p) { return (p * 100).toFixed(1) + '%'; }
  function poss(name) { return /[’']s$/.test(name) ? name : /s$/i.test(name) ? name + '’' : name + '’s'; }
  function dpts(a, b) { return Math.round(b * 100) - Math.round(a * 100); }
  function arrow(d) { return (d > 0 ? '▲' : '▼') + Math.abs(d) + '%'; }
  function ord(k) { var s = ['th', 'st', 'nd', 'rd'], v = k % 100; return k + (s[(v - 20) % 10] || s[v] || s[0]); }
  function pkLabel(r, s) { return r + '.' + (s < 10 ? '0' : '') + s; }
  function plural(k, w) { return k + ' ' + w + (k === 1 ? '' : 's'); }
  function rec(i) { return cfg.wins[i] + '-' + cfg.losses[i] + (cfg.ties[i] ? '-' + cfg.ties[i] : ''); }
  function nPicks() { return state.picks.filter(Boolean).length; }
  function anyPicks() { return state.picks.some(Boolean); }
  // full team name wherever a team has its own row; "tight" grids fall back to the short name on a phone
  function nameEl(i, tight) { return el('span', { class: 'nm' + (tight ? ' tight' : '') }, [el('span', { class: 'f', text: T[i].name }), el('span', { class: 's', text: T[i].short })]); }
  function head(title, note, reset) {
    var p = note ? el('p', { class: 'note' }, [note]) : null;
    if (p && reset) { p.appendChild(document.createTextNode(' ')); p.appendChild(el('button', { type: 'button', class: 'linkbtn inl', 'data-k': 'reset1', text: 'Reset picks', onclick: resetPicks })); }
    return el('div', { class: 'shead' }, [el('h2', { text: title }), p]);
  }
  function focusKey() { var a = document.activeElement; return a && a.getAttribute ? a.getAttribute('data-k') : null; }
  function refocus(k) { if (!k) return; var e = document.querySelector('[data-k="' + k + '"]'); if (e) { try { e.focus({ preventScroll: true }); } catch (x) { e.focus(); } } }
  function checkIcon() { var s = sv('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }); s.appendChild(sv('path', { d: 'M3 8.5l3.2 3.2L13 4.8', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); return s; }

  /* ---------- the odds ramp: one blue, light to dark, mixed in OKLCH ---------- */
  var ramp = (function () {
    var cs = getComputedStyle(document.documentElement);
    function tok(name, fb) { var v = (cs.getPropertyValue(name) || '').trim(); return /^#[0-9a-f]{6}$/i.test(v) ? v : fb; }
    function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    function gam(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
    function toLab(h) {
      var r = lin(parseInt(h.slice(1, 3), 16) / 255), g = lin(parseInt(h.slice(3, 5), 16) / 255), b = lin(parseInt(h.slice(5, 7), 16) / 255);
      var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
    }
    function toRgb(Lc, a, b) {
      var l = Math.pow(Lc + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(Lc - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(Lc - 0.0894841775 * a - 1.2914855480 * b, 3);
      var c = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
      return 'rgb(' + c.map(function (x) { return Math.round(255 * Math.min(1, Math.max(0, gam(Math.max(0, x))))); }).join(',') + ')';
    }
    var A = toLab(tok('--ramp-lo', '#eef4fb')), B = toLab(tok('--ramp-hi', '#0e3d7e'));
    var ca = Math.sqrt(A[1] * A[1] + A[2] * A[2]), cb = Math.sqrt(B[1] * B[1] + B[2] * B[2]), ha = Math.atan2(A[2], A[1]), dh = Math.atan2(B[2], B[1]) - ha, out = [];
    if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
    for (var k = 0; k <= 100; k++) { var p = k / 100, c = ca + (cb - ca) * p, h = ha + dh * p; out.push(toRgb(A[0] + (B[0] - A[0]) * p, c * Math.cos(h), c * Math.sin(h))); }
    return out;
  })();
  function heat(t) { return ramp[Math.max(0, Math.min(100, Math.round(t * 100)))]; }
  function chip(p, o) {
    o = o || {};
    var nil = !o.one && !!o.zero, v = o.one ? 1 : p;
    var c = el('span', { class: 'chip' + (nil ? ' nil' : v >= SWITCH ? ' hi' : ''), bg: nil ? null : heat(v), 'data-tip': o.tip }, [pct(p, o.zero, o.one)]);
    if (o.delta) c.appendChild(el('span', { class: 'd', text: arrow(o.delta) }));
    return c;
  }

  /* ---------- who holds which pick: OWN[round][original team] = holder ---------- */
  var OWN = (function () {
    var idx = {}, own = [], r;
    for (r = 1; r <= D.rounds; r++) own[r] = T.map(function (t, i) { return i; });
    D.traded.forEach(function (x) { if (own[x.round] && x.orig != null && x.owner != null) own[x.round][x.orig] = x.owner; });
    return own;
  })();

  /* ---------- numbers ---------- */
  function compute() {
    var rule = { nonPlayoff: state.np, playoff: D.rule.playoff, byRound: D.rule.byRound };
    cfg = M.buildConfig(LG, proj, { mode: state.mode, draft: D.show ? rule : null, live: ctx.live || null }); G = cfg.games.length;
    if (state.picks.length !== G) state.picks = new Array(G).fill(0);
    cfg.games.forEach(function (g, gi) { if (decided(g)) state.picks[gi] = 0; });      // a finished game can't be picked
    // big leagues early in the season get fewer runs so a phone stays quick
    var cost = n * (cfg.weeks.length + 3); N = cost <= 150 ? 40000 : Math.max(8000, Math.round(40000 * 150 / cost / 1000) * 1000);
    // swings are tracked for the week being picked (all weeks when the league is small)
    var wk0 = state.week, lev = null;
    if (G * n > 2400) { lev = []; cfg.games.forEach(function (g, gi) { if (g.week === wk0 || (wk0 == null && g.week === cfg.games[0].week)) lev.push(gi); }); }
    cfg.levGames = lev;
    var key = state.mode + '|' + state.np + '|' + (lev ? (wk0 == null ? cfg.games[0].week : wk0) : 'all'), fresh = !baseCache[key];
    if (fresh) baseCache[key] = E.simulate(cfg, [], N, SEED);
    base = baseCache[key];
    cur = anyPicks() ? E.simulate(cfg, state.picks, N, SEED) : base;
    levIx = {}; base.levGames.forEach(function (gi, k) { levIx[gi] = k; });
    var live = LG.phase === 'regular';
    cl6 = live ? E.clinch(cfg, state.picks, PT) : NONE; cl2 = live && NB && !hasDiv ? E.clinch(cfg, state.picks, NB) : NONE;
    c06 = live ? E.clinch(cfg, [], PT) : NONE; c02 = live && NB && !hasDiv ? E.clinch(cfg, [], NB) : NONE;
    orderNow = LG.fixed && LG.fixed.seeds ? LG.fixed.seeds.concat(LG.fixed.rest || []) : C.seedOrder(LG.rec, cfg.div, cfg.nDiv); seedNow = new Array(n);
    orderNow.forEach(function (i, k) { seedNow[i] = k; });
    // open games, biggest stakes first: how far each result moves playoff and bye odds (or the top of the draft) across the league
    function ranked(keys, wts) {
      var imp = cfg.games.map(function (g, gi) {
        var q = levIx[gi]; if (q == null) return 0;
        var wa = base.levWA[q], wb = base.levWB[q], s = 0;
        if (!(wa > 0) || !(wb > 0)) return 0;
        for (var i = 0; i < n; i++) for (var k = 0; k < keys.length; k++) s += wts[k] * Math.abs(base[keys[k] + 'A'][q][i] / wa - base[keys[k] + 'B'][q][i] / wb);
        return s;
      });
      return cfg.games.map(function (g, gi) { return gi; }).sort(function (x, y) { return cfg.games[x].week - cfg.games[y].week || imp[y] - imp[x] || x - y; });
    }
    gameRank = { playoffs: ranked(['levP', 'levB'], [1, 1]), draft: ranked(['levT', 'levS'], [1, 0.05]) };   // draft tab: top-three odds first, slots as the tiebreak
  }
  function P(res, key, i) { return (key.charAt(0) === 'r' && key.charAt(1) !== 'e' ? res.reach[Number(key.slice(1))][i] : res[key][i]) / res.wsum; }
  function slotP(res, i, s) { return res.slotDist[i][s] / res.wsum; }
  function top3(res, i) { var t = 0; for (var k = 0; k < Math.min(3, n); k++) t += res.slotDist[i][k]; return t / res.wsum; }
  function meanSlot(res, i) { return res.slotSum[i] / res.wsum; }
  function projOrder(res) { var o = []; for (var i = 0; i < n; i++) o.push(i); o.sort(function (x, y) { return res.slotSum[x] - res.slotSum[y] || seedNow[y] - seedNow[x]; }); return o; }
  function rankOf(order) { var r = new Array(n); order.forEach(function (i, k) { r[i] = k + 1; }); return r; }
  function flags(key, i, c6, c2) {      // certain / ruled out, from win-loss arithmetic rather than the simulation
    var out = c6.eliminated[i];
    if (key === 'playoff') return { one: c6.clinched[i], zero: out };
    if (key === 'bye') return { one: c2.clinched[i], zero: out || c2.eliminated[i] };
    if (key === 'r2' && NB) return { one: c2.clinched[i], zero: out };
    return { one: false, zero: out };
  }
  // what a cell shows: only the playoff column says "<1%" for a long shot that never came up in the runs
  function shown(res, key, i, c6, c2) {
    var f = flags(key, i, c6, c2), p = P(res, key, i);
    return { p: f.one ? 1 : f.zero ? 0 : p, one: f.one, zero: f.zero || (!f.one && key !== 'playoff' && p <= 0), ruledOut: f.zero };
  }

  /* ---------- top bar ---------- */
  function renderBar() {
    TABS.forEach(function (t) { $('tab-' + t).setAttribute('aria-selected', String(state.tab === t)); });
    $('tab-draft').hidden = !D.show;
    var sel = $('mine');
    if (!sel.options.length) {
      sel.appendChild(el('option', { value: '-1', text: 'Pick your team' }));
      T.forEach(function (t, i) { sel.appendChild(el('option', { value: String(i), text: t.name })); });
    }
    sel.value = String(state.mine);
    var seg = document.querySelectorAll('#basis button');
    for (var i = 0; i < seg.length; i++) seg[i].setAttribute('aria-pressed', String(seg[i].getAttribute('data-mode') === (cfg ? cfg.mode : state.mode)));
    $('basis').hidden = !!cfg && !cfg.haveProj;
  }

  /* ---------- your team ---------- */
  function mineCard() {
    var i = state.mine, picks = anyPicks(), card = el('div', { class: 'me-card' }, [el('span', { class: 't', text: T[i].name })]);
    if (state.tab === 'playoffs') {
      if (cl6.eliminated[i]) { card.appendChild(el('p', { class: 'me-line', text: 'Out of the playoff race.' + (D.show ? ' The Draft picks tab shows where their pick lands.' : '') })); return card; }
      var stats = el('div', { class: 'me-stats' });
      [['playoff', 'playoffs'], ['bye', 'bye'], ['champ', 'title']].forEach(function (c) {
        if (c[0] === 'bye' && !NB) return;
        var x = shown(cur, c[0], i, cl6, cl2), d = picks ? dpts(shown(base, c[0], i, c06, c02).p, x.p) : 0;
        stats.appendChild(el('span', null, [el('b', { text: pct(x.p, x.zero, x.one) }), d ? el('i', { class: 'dl ' + (d > 0 ? 'up' : 'down'), text: arrow(d) }) : null, el('small', { text: c[1] })]));
      });
      card.appendChild(stats);
    } else {
      var rk = rankOf(projOrder(cur)), owner = OWN[1][i], t3 = top3(cur, i), held = [];
      card.appendChild(el('p', { class: 'me-line' }, ['Their first-round pick projects ', el('b', { text: ord(rk[i]) }),
        owner !== i ? ' and belongs to ' + T[owner].name + '.' : t3 >= 0.005 ? ', with a ' + pct(t3) + ' chance at a top-three pick.' : '.']));
      for (var r = 1; r <= D.rounds; r++) for (var t = 0; t < n; t++) if (OWN[r][t] === i) held.push({ r: r, s: rk[t], t: t });
      held.sort(function (x, y) { return x.r - y.r || x.s - y.s; });
      card.appendChild(el('p', { class: 'me-line', text: held.length ? 'Picks they hold: ' + held.map(function (h) { return pkLabel(h.r, h.s) + (h.t !== i ? ' (from ' + T[h.t].short + ')' : ''); }).join(', ') + '.' : 'They hold no ' + D.season + ' picks.' }));
    }
    return card;
  }

  /* ---------- playoff table ---------- */
  var COLS = (function () {
    var c = [['playoff', 'Playoffs', 'Make the playoffs']];
    if (NB) c.push(['bye', 'Bye', 'Finish in the top ' + (NB === 1 ? 'spot' : NB) + ' and skip the first round']);
    for (var r = 2; r < R; r++) { var left = R - r; c.push(['r' + r, left === 1 ? 'Semis' : left === 2 ? 'Quarters' : 'Round ' + r, left === 1 ? 'Reach the semifinals' : left === 2 ? 'Reach the quarterfinals' : 'Reach round ' + r]); }
    if (R > 1) c.push(['fin', 'Final', 'Reach the final']);
    c.push(['champ', 'Title', 'Win the title']);
    return c;
  })();
  function playoffTable(host) {
    var picks = anyPicks(), cols = COLS;
    host.appendChild(head('Playoff odds', picks ? 'With your ' + plural(nPicks(), 'pick') + '.' : 'Tap a team for more.', picks));
    var cg = el('colgroup', null, [el('col')]), hr = el('tr', null, [el('th', { scope: 'col', class: 'team', text: 'Team' })]), body = el('tbody');
    cols.forEach(function (c) { cg.appendChild(el('col', { class: 'c' })); hr.appendChild(el('th', { scope: 'col', 'data-tip': c[2], text: c[1] })); });
    orderNow.forEach(function (i, pos) {
      var tr = el('tr', { class: 'r' + (pos === PT ? ' cut' : '') + (i === state.mine ? ' me' : '') });
      tr.appendChild(el('th', { scope: 'row' }, [el('button', { class: 'tbtn', type: 'button', 'data-k': 't' + i, 'aria-expanded': String(state.open === i), onclick: function () { toggleOpen(i); } },
        [el('span', { class: 'rk', text: String(pos + 1) }), el('span', null, [nameEl(i), el('span', { class: 'sub', text: rec(i) + (T[i].mgr ? ', ' + T[i].mgr : '') })])])]));
      cols.forEach(function (c) {
        var x = shown(cur, c[0], i, cl6, cl2), b = shown(base, c[0], i, c06, c02);
        var say = function (v) { return v.one ? 'certain' : v.ruledOut ? 'ruled out' : v.p <= 0 ? 'never in ' + N.toLocaleString('en-US') + ' runs' : pct1(v.p); };
        var tip = T[i].short + ', ' + c[2].toLowerCase() + ': ' + say(x) + (picks ? ' (' + say(b) + ' today)' : '');
        tr.appendChild(el('td', { 'aria-label': tip }, [chip(x.p, { zero: x.zero, one: x.one, tip: tip, delta: picks ? dpts(b.p, x.p) : 0 })]));
      });
      body.appendChild(tr);
      if (state.open === i) body.appendChild(el('tr', { class: 'det' }, [el('td', { colspan: String(cols.length + 1) }, [detailPlayoffs(i)])]));
    });
    host.appendChild(el('table', { class: 'odds' }, [cg, el('thead', null, [hr]), body]));
    
  }

  /* ---------- draft table ---------- */
  function draftTable(host) {
    var picks = anyPicks(), ordC = projOrder(cur), rB = rankOf(projOrder(base));
    var hd = head(D.season + ' draft order', picks ? 'With your ' + plural(nPicks(), 'pick') + '.' : 'Darker is more likely. Tap a square for the odds.', picks);
    hd.appendChild(el('button', { type: 'button', class: 'linkbtn numtog', 'data-k': 'nums', 'aria-pressed': String(state.nums), text: state.nums ? 'Hide numbers' : 'Show numbers', onclick: function () { state.nums = !state.nums; renderMain(); } }));
    host.appendChild(hd);
    var sh = el('div', { class: 'striph', 'aria-hidden': 'true' }), grp = el('div', { class: 'stripg', 'aria-hidden': 'true' }), body = el('tbody'), s, b0 = n - PT;
    var g1 = el('span', { text: b0 > 2 ? 'Miss the playoffs' : '' }), g2 = el('span', { text: 'By playoff finish' }), dense = n > 16;
    g1.style.gridColumn = 'span ' + b0; g2.style.gridColumn = 'span ' + PT; if (b0 > 0) grp.appendChild(g1); grp.appendChild(g2);
    for (s = 1; s <= n; s++) sh.appendChild(el('span', { text: dense && s % 4 !== 1 ? '' : String(s) }));
    ordC.forEach(function (i, k) {
      var owner = OWN[1][i], strip = el('div', { class: 'strip' + (state.nums ? ' nums' : '') }), best = 0, d = picks ? rB[i] - (k + 1) : 0;
      for (var j = 0; j < n; j++) {
        var p = slotP(cur, i, j), v = Math.round(p * 100); if (v >= 100 && p < 1) v = 99;
        if (p > slotP(cur, i, best)) best = j;
        var t = 0.1 + 0.9 * p, tip = T[i].short + ' pick lands ' + ord(j + 1) + ': ' + (p > 0 ? pct1(p) : 'never in ' + N.toLocaleString('en-US') + ' runs');
        strip.appendChild(p > 0 ? el('span', { class: 'cell' + (t >= SWITCH ? ' hi' : ''), bg: heat(t), 'data-tip': tip }, [p >= 0.005 && state.nums && !dense ? String(v) : '']) : el('span', { class: 'cell', 'data-tip': tip }));
      }
      var tr = el('tr', { class: 'r' + (i === state.mine || owner === state.mine ? ' me' : '') });
      tr.appendChild(el('th', { scope: 'row' }, [el('button', { class: 'tbtn', type: 'button', 'data-k': 't' + i, 'aria-expanded': String(state.open === i), onclick: function () { toggleOpen(i); } },
        [el('span', { class: 'rk', 'data-tip': d ? 'Projected ' + ord(rB[i]) + ' before your picks' : null }, [String(k + 1), d ? el('i', { 'aria-label': d > 0 ? 'moved earlier' : 'moved later', text: d > 0 ? '▲' : '▼' }) : null]), el('span', null, [nameEl(owner),
          owner !== i ? el('span', { class: 'sub to', text: 'from ' + T[i].name }) : el('span', { class: 'sub', text: rec(i) })])])]));
      tr.appendChild(el('td', { 'aria-label': 'Most likely ' + ord(best + 1) + ', ' + pct(slotP(cur, i, best)) }, [strip]));
      body.appendChild(tr);
      if (state.open === i) body.appendChild(el('tr', { class: 'det' }, [el('td', { colspan: '2' }, [detailDraft(i)])]));
    });
    var tb = el('table', { class: 'odds' }, [el('colgroup', null, [el('col', { class: 't' }), el('col')]),
      el('thead', null, [el('tr', null, [el('th', { scope: 'col', class: 'team', text: 'Who picks' }), el('th', { scope: 'col' }, [grp, sh])])]), body]);
    tb.style.setProperty('--n', String(n));
    host.appendChild(tb);
    // the order rule this league follows, with a switch for the two common ones
    var seg = el('span', { class: 'seg', role: 'group', 'aria-label': 'Order of non-playoff teams' });
    [['maxpf', 'Max PF', 'Fewest potential points picks first. The most common rule on Sleeper.'], ['record', 'Record', 'Worst record picks first.']].forEach(function (o) {
      seg.appendChild(el('button', { type: 'button', 'data-k': 'np' + o[0], 'aria-pressed': String(state.np === o[0]), 'data-tip': o[2], text: o[1], onclick: function () { state.np = o[0]; run(); } }));
    });
    var why = D.rule.seasons ? (D.rule.nonPlayoff === state.np ? 'Matches ' + (D.rule.seasons === 1 ? 'last year’s draft' : 'your last ' + D.rule.seasons + ' drafts') + '.' : '') : 'No past draft to check against.';
    host.appendChild(el('div', { class: 'rulebar' }, [el('span', { text: 'Non-playoff order' }), seg, why ? el('span', { class: 'note', text: why }) : null]));
  }

  /* ---------- who holds the picks ---------- */
  function renderExtra() {
    var host = $('extra'); host.textContent = ''; host.hidden = state.tab !== 'draft' || !D.show;
    if (state.tab !== 'draft' || !D.show) return;
    var rk = rankOf(projOrder(cur)), rows = [], o, r, t;
    for (o = 0; o < n; o++) {
      var per = [], first = Infinity, cnt = 0;
      for (r = 1; r <= D.rounds; r++) {
        var list = [];
        for (t = 0; t < n; t++) if (OWN[r][t] === o) { list.push({ t: t, s: rk[t] }); first = Math.min(first, (r - 1) * n + rk[t]); cnt++; }
        list.sort(function (x, y) { return x.s - y.s; }); per.push(list);
      }
      rows.push({ o: o, per: per, first: first, cnt: cnt });
    }
    rows.sort(function (x, y) { return x.first - y.first || x.o - y.o; });
    var val = function (r, slot) { return 100 * Math.pow(0.5, ((r - 1) * n + slot - 1) / n); }, top = 0;   // rough scale: 1.01 counts 100, value halves each round
    rows.forEach(function (row) { row.cap = 0; row.per.forEach(function (list, ri) { list.forEach(function (x) { row.cap += val(ri + 1, x.s); }); }); top = Math.max(top, row.cap); });
    rows.sort(function (x, y) { return y.cap - x.cap || x.first - y.first; });
    var hd = head('Who holds the picks', ' '), nt = hd.querySelector('.note');
    if (nt) { nt.textContent = ''; nt.appendChild(el('span', { class: 'dot', 'aria-hidden': 'true' })); nt.appendChild(document.createTextNode('= received in a trade')); }
    host.appendChild(hd);
    var cg = el('colgroup', null, [el('col')]), hr = el('tr', null, [el('th', { scope: 'col', text: 'Team and value' })]), body = el('tbody');
    for (r = 1; r <= D.rounds; r++) { cg.appendChild(el('col', { class: 'c' })); hr.appendChild(el('th', { scope: 'col', text: 'Rd ' + r })); }
    rows.forEach(function (row) {
      var bar = el('i'); bar.style.width = Math.round(56 * row.cap / top) + 'px';
      var tr = el('tr', { class: row.o === state.mine ? 'me' : null }, [el('th', { scope: 'row' }, [nameEl(row.o), el('span', { class: 'cap', 'data-tip': plural(row.cnt, 'pick') + ', draft value ' + Math.round(row.cap) }, [bar, String(Math.round(row.cap))])])]);
      row.per.forEach(function (list, ri) {
        var td = el('td');
        if (!list.length) td.appendChild(el('span', { class: 'none', text: '–' }));
        list.forEach(function (x) {
          var t = val(ri + 1, x.s) / 100;
          td.appendChild(el('span', { class: 'pk' + (t >= SWITCH ? ' hi' : '') + (x.t !== row.o ? ' got' : ''), bg: heat(t), 'data-tip': 'Pick ' + pkLabel(ri + 1, x.s) + (x.t !== row.o ? ', from ' + T[x.t].name : ', their own') + '. Value ' + Math.round(val(ri + 1, x.s)) }, [pkLabel(ri + 1, x.s)]));
        });
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    host.appendChild(el('table', { class: 'own' }, [cg, el('thead', null, [hr]), body]));
    
  }

  /* ---------- team drawers ---------- */
  function ownTable(i, colsDef) {
    var mine = []; cfg.games.forEach(function (g, gi) { if (g.a === i || g.b === i) mine.push(gi); });
    var left = mine.length, wrap = el('div');
    if (!left) { wrap.appendChild(el('p', { class: 'note', text: 'No regular-season games left.' })); return wrap; }
    var names = left === 2 ? ['Lose both', 'Split', 'Win both'] : left === 1 ? ['Lose', 'Win'] : null;
    var hr = el('tr', null, [el('th', { scope: 'col', text: 'Rest of season' }), el('th', { scope: 'col', text: 'Chance' })]), body = el('tbody');
    colsDef.forEach(function (c) { hr.appendChild(el('th', { scope: 'col', text: c[0] })); });
    for (var k = left; k >= 0; k--) {
      var w = cur.ownW[i][k], share = w / cur.wsum; if (share < 0.0005) continue;
      var tr = el('tr', null, [el('th', { scope: 'row', text: names ? names[k] : 'Go ' + k + '-' + (left - k) }), el('td', { text: share > 0.99995 ? '100%' : pct(share) })]);
      colsDef.forEach(function (c) { tr.appendChild(el('td', { text: c[1](k, w) })); });
      body.appendChild(tr);
    }
    wrap.appendChild(el('table', { class: 'mini' }, [el('thead', null, [hr]), body]));
    wrap.appendChild(el('p', { class: 'note', text: mine.map(function (gi) {
      var g = cfg.games[gi], home = g.a === i, opp = home ? g.b : g.a, pick = state.picks[gi];
      var pa = E.winProb(cfg.rel[g.week][g.a], cfg.rel[g.week][g.b], cfg.sigma, cfg.v[g.a], cfg.v[g.b]);
      return 'Week ' + g.week + ' vs ' + T[opp].short + ' (' + (pick ? (pick === (home ? 1 : 2) ? 'picked to win' : 'picked to lose') : pct(home ? pa : 1 - pa) + ' to win') + ')';
    }).join(', ') + '.' }));
    return wrap;
  }
  function swings(i, keyA, keyB, minD) {
    var rows = [];
    cfg.games.forEach(function (g, gi) {
      if (state.picks[gi] || g.a === i || g.b === i || levIx[gi] == null) return;
      var q = levIx[gi], wa = cur.levWA[q], wb = cur.levWB[q];
      if (wa / cur.wsum < 0.01 || wb / cur.wsum < 0.01) return;
      var a = cur[keyA][q][i] / wa, b = cur[keyB][q][i] / wb;
      rows.push({ g: g, a: a, b: b, d: Math.abs(a - b) });
    });
    rows.sort(function (x, y) { return y.d - x.d; });
    return rows.filter(function (r) { return r.d >= minD; }).slice(0, 4);
  }
  function swingList(rows, lowerIsBetter, fmt, empty) {
    rows = rows.filter(function (r) { return fmt(r.a) !== fmt(r.b); });      // skip swings too small to show
    if (!rows.length) return el('p', { class: 'note', text: empty });
    var ul = el('ul', { class: 'swing' });
    rows.slice(0, 3).forEach(function (r) {
      var aBetter = lowerIsBetter ? r.a <= r.b : r.a >= r.b, w = aBetter ? r.g.a : r.g.b, l = aBetter ? r.g.b : r.g.a;
      ul.appendChild(el('li', null, [el('span', null, ['Week ' + r.g.week + ': ', el('b', { text: T[w].short }), ' over ' + T[l].short]),
        el('span', { class: 'v' }, [el('b', { text: fmt(aBetter ? r.a : r.b) }), ' if so, ' + fmt(aBetter ? r.b : r.a) + ' if not'])]));
    });
    return ul;
  }
  function bars(vals, labels, o) {
    var m = vals.length, step = 46, bw = 30, W = Math.max(m * step, 138), H = 132, padB = 22, padT = 18, max = Math.max.apply(null, vals.concat([0.05]));
    var s = sv('svg', { class: 'bars', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.aria });
    s.style.maxWidth = W + 'px';
    s.appendChild(sv('line', { x1: 0, x2: W, y1: H - padB + 0.5, y2: H - padB + 0.5 }));
    vals.forEach(function (v, j) {
      var x = j * step + (step - bw) / 2, h = v > 0 ? Math.max(2, (H - padB - padT) * v / max) : 0, y = H - padB - h, r = Math.min(4, h), tip = o.tip(j) + ': ' + (v > 0 ? pct1(v) : 'never');
      s.appendChild(sv('rect', { class: 'hit', x: j * step, y: 0, width: step, height: H - padB, 'data-tip': tip }));
      if (h > 0) s.appendChild(sv('path', { class: 'bar' + (o.muted && o.muted(j) ? ' out' : ''), 'data-tip': tip, d: 'M' + x + ' ' + (y + h) + 'V' + (y + r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' -' + r + 'h' + (bw - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r + 'V' + (y + h) + 'z' }));
      if (v > 0) { var tv = sv('text', { class: 'v', x: x + bw / 2, y: y - 5, 'text-anchor': 'middle' }); tv.textContent = v < 0.005 ? '<1%' : Math.round(v * 100) + '%'; s.appendChild(tv); }
      var tl = sv('text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle' }); tl.textContent = labels[j]; s.appendChild(tl);
    });
    return s;
  }
  function lineupLink(i) { return el('button', { type: 'button', class: 'linkbtn', 'data-k': 'lu' + i, text: 'See their projected lineup', onclick: function () { showLineup(i); } }); }
  function pathTable(i) {       // the bracket decides picks past the lottery, so show each finish and the slot it brings
    var b0 = n - PT, sum = function (a, b) { var t = 0; for (var k = a; k <= b; k++) t += slotP(cur, i, k - 1); return t; }, body = el('tbody'), rows = [], at = b0 + 1, r;
    if (b0 > 0) rows.push(['Miss the playoffs', b0 === 1 ? '1' : '1-' + b0, sum(1, b0)]);
    for (r = 1; r <= R; r++) {
      var cnt = 0; LG.bracket.forEach(function (g) { if (g.r === r && BI.title[g.m]) cnt++; });
      if (!cnt) continue;
      var name = r === R ? 'Lose the final' : r === R - 1 ? 'Lose in the semifinals' : r === 1 ? 'Lose in the first round' : 'Lose in round ' + r;
      rows.push([name, cnt === 1 ? String(at) : cnt === 2 ? at + ' or ' + (at + 1) : at + '-' + (at + cnt - 1), sum(at, at + cnt - 1)]); at += cnt;
    }
    rows.push(['Win the title', String(n), sum(n, n)]);
    rows.forEach(function (r) {
      body.appendChild(el('tr', null, [el('th', { scope: 'row', text: r[0] }), el('td', { text: r[1] }), el('td', { text: pz(r[2]) })]));
    });
    return el('table', { class: 'mini' }, [el('thead', null, [el('tr', null, [el('th', { scope: 'col', text: 'Their season' }), el('th', { scope: 'col', text: 'Pick' }), el('th', { scope: 'col', text: 'Chance' })])]), body]);
  }
  function detailPlayoffs(i) {
    var box = el('div', { class: 'detail' }), pfRank = 1, p = P(cur, 'playoff', i), k;
    for (k = 0; k < n; k++) if (cfg.pf[k] > cfg.pf[i]) pfRank++;
    box.appendChild(el('div', { class: 'dhead' }, [el('b', { text: T[i].name }), el('span', { text: rec(i) + ', ' + ord(seedNow[i] + 1) + ' in the standings. ' + cfg.pf[i].toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' points for, ' + (pfRank === 1 ? 'the most' : ord(pfRank) + ' most') + ' in the league.' })]));
    if (cl6.eliminated[i]) {
      box.appendChild(el('p', { class: 'note', text: 'Out of the playoff race.' + (D.show ? ' The Draft picks tab shows where their pick lands.' : '') }));
      box.appendChild(lineupLink(i));
      return box;
    }
    var grid = el('div', { class: 'dgrid' });
    grid.appendChild(el('div', null, [el('h4', { text: 'By their own results' }), ownTable(i, [
      ['Playoffs', function (kk, w) { return pct(cur.ownP[i][kk] / w, false, cl6.clinched[i]); }],
      ['Title', function (kk, w) { return pz(cur.ownC[i][kk] / w); }]])]));
    var vals = [], out = 0, labels = [];
    for (k = 0; k < n; k++) { var q = cur.seedDist[i][k] / cur.wsum; if (k < PT) { vals.push(q); labels.push(String(k + 1)); } else out += q; }
    vals.push(out); labels.push('Out');
    grid.appendChild(el('div', null, [el('h4', { text: 'Where they finish' }), bars(vals, labels, { aria: 'Chance of each final seed for ' + T[i].name, tip: function (j) { return j < PT ? ord(j + 1) + ' seed' : 'Miss the playoffs'; }, muted: function (j) { return j === PT; } })]));
    var m = !cl6.clinched[i] && !cl6.eliminated[i] && p > 0.01 && p < 0.99 ? ['levPA', 'levPB', 'playoff odds'] : !cl6.eliminated[i] && P(cur, 'champ', i) >= 0.005 ? ['levCA', 'levCB', 'title odds'] : null;
    grid.appendChild(el('div', { class: 'wide' }, [el('h4', { text: m ? 'Other games that move their ' + m[2] : 'Other games' }),
      m ? swingList(swings(i, m[0], m[1], 0.01), false, function (x) { return pct(x); }, 'No other open game moves their ' + m[2] + ' by a full point.')
        : el('p', { class: 'note', text: 'Nothing left to settle in the open games.' })]));
    box.appendChild(grid);
    box.appendChild(lineupLink(i));
    return box;
  }
  function detailDraft(i) {
    var box = el('div', { class: 'detail' }), owner = OWN[1][i], lo = n, hi = -1, vals = [], labels = [], k;
    var p1 = slotP(cur, i, 0), p3 = top3(cur, i), lot = 1 - P(cur, 'playoff', i), topN = 'Top ' + (n - PT);
    box.appendChild(el('div', { class: 'dhead' }, [el('b', { text: poss(T[i].name) + ' first-round pick' }),
      el('span', { text: (owner !== i ? 'Held by ' + T[owner].name + '. ' : '') + 'Average slot ' + meanSlot(cur, i).toFixed(1) + '.'
        + (p1 >= 0.005 ? ' First-pick odds ' + pct(p1) + '.' : '') + (p3 >= 0.005 ? ' Top-three odds ' + pct(p3) + '.' : lot >= 0.005 ? ' ' + topN + ' odds ' + pct(lot) + '.' : '') })]));
    for (k = 0; k < n; k++) if (slotP(cur, i, k) >= 0.005) { lo = Math.min(lo, k); hi = Math.max(hi, k); }
    for (k = lo; k <= hi; k++) { vals.push(slotP(cur, i, k)); labels.push(String(k + 1)); }
    var grid = el('div', { class: 'dgrid' });
    grid.appendChild(el('div', null, [el('h4', { text: 'Where it lands' }), bars(vals, labels, { aria: 'Chance of each draft slot for this pick', tip: function (j) { return ord(lo + j + 1) + ' pick'; } })]));
    if (D.rule.playoff !== 'record') grid.appendChild(el('div', null, [el('h4', { text: 'What decides the slot' }), pathTable(i)]));
    var ownCols = [['Avg slot', function (kk, w) { return (cur.ownS[i][kk] / w).toFixed(1); }]];
    if (p3 >= 0.005) ownCols.push(['Top three', function (kk, w) { return pz(cur.ownT[i][kk] / w); }]);
    else if (lot >= 0.005) ownCols.push([topN, function (kk, w) { return pz(1 - cur.ownP[i][kk] / w); }]);
    grid.appendChild(el('div', null, [el('h4', { text: 'By ' + poss(T[i].short) + ' own results' }), ownTable(i, ownCols)]));
    grid.appendChild(el('div', { class: 'wide' }, [el('h4', { text: 'Other games that move it earlier' }),
      swingList(swings(i, 'levSA', 'levSB', 0.1), true, function (x) { return 'slot ' + x.toFixed(1); }, 'No other open game moves this pick by much.')]));
    box.appendChild(grid);
    return box;
  }

  /* ---------- lineups tab ---------- */
  function abbr(name) { var p = name.split(' '); return p.length < 2 ? name : p[0].charAt(0) + '. ' + p.slice(1).join(' '); }
  var SLOT = { SUPER_FLEX: 'SF', FLEX: 'FLX', WRRB_FLEX: 'W/R', REC_FLEX: 'W/T', IDP_FLEX: 'IDP', WRRBTE_FLEX: 'FLX' };
  function lineupCard(i, wk, opp, pWin) {
    var card = el('div', { class: 'lcard' + (i === state.mine ? ' me' : ''), id: 'lu-' + T[i].rid });
    card.appendChild(el('div', { class: 'lhead' }, [el('span', { class: 'lname', text: T[i].name }), el('span', { class: 'ltot' }, [el('b', { text: fx(proj[wk].totals[i]) }), 'points']),
      el('span', { class: 'lsub', text: opp >= 0 ? pct(pWin) + ' to beat ' + T[opp].short : rec(i) + ', ' + ord(seedNow[i] + 1) + ' in the standings' })]));
    proj[wk].lineups[i].forEach(function (r) {
      var info = r.id != null ? shared.players[r.id] : null, name = info ? info[0] : r.id != null ? 'Player ' + r.id : 'Empty';
      card.appendChild(el('div', { class: 'lrow' }, [el('span', { class: 'sl', text: SLOT[r.slot] || r.slot }),
        el('span', { class: 'pl' }, [el('span', { class: 'f', text: name }), el('span', { class: 's', text: abbr(name) }), r.fa ? el('span', { class: 'fa', 'data-tip': 'A free agent the model assumes gets added to fill an empty slot', text: 'FA' }) : null]),
        el('span', { class: 'pts', text: fx(r.pts) })]));
    });
    return card;
  }
  function projTable(host) {
    var weeks = Object.keys(proj).sort(function (a, b) { return a - b; }).slice(0, 8), lo = Infinity, hi = -Infinity;
    weeks.forEach(function (w) { T.forEach(function (t, i) { var x = proj[w].totals[i]; if (x < lo) lo = x; if (x > hi) hi = x; }); });
    var cg = el('colgroup', null, [el('col')]), hr = el('tr', null, [el('th', { scope: 'col', class: 'team', text: 'Team' })]), body = el('tbody');
    weeks.forEach(function (w) { cg.appendChild(el('col', { class: 'c' })); hr.appendChild(el('th', { scope: 'col', text: 'Wk ' + w })); });
    orderNow.forEach(function (i) {
      var tr = el('tr', { class: 'r' + (i === state.mine ? ' me' : '') }, [el('th', { scope: 'row' }, [nameEl(i, true), el('span', { class: 'sub', text: cfg.form.games[i] ? 'avg ' + (cfg.base + cfg.form.raw[i]).toFixed(1) : '' })])]);
      weeks.forEach(function (w) {
        var x = proj[w].totals[i], t = hi > lo ? (x - lo) / (hi - lo) : 0.5;
        tr.appendChild(el('td', null, [el('span', { class: 'chip' + (t >= SWITCH ? ' hi' : ''), bg: heat(t) }, [fx(x)])]));
      });
      body.appendChild(tr);
    });
    host.appendChild(el('div', { class: 'ptab' }, [head('Projected points by week', 'Season average in gray.'),
      el('table', { class: 'odds pts' }, [cg, el('thead', null, [hr]), body])]));
  }
  function lineupsTab(host) {
    var weeks = Object.keys(proj).sort(function (a, b) { return a - b; });
    host.appendChild(head('Projected lineups', weeks.length ? 'Each team’s best lineup by ' + (ctx.source || 'Sleeper') + '’s projections.' : 'No projections are out for the weeks left.'));
    if (!weeks.length) return;
    if (weeks.indexOf(state.luWeek) < 0) state.luWeek = weeks[0];
    var wk = state.luWeek, anyFa = false;
    host.appendChild(weekPicker(weeks.map(Number), Number(wk), 'lw', function (w) { state.luWeek = String(w); renderMain(); }, 'wkseg'));
    var games = gameRank.playoffs.filter(function (gi) { return String(cfg.games[gi].week) === wk; }), grid = el('div', { class: 'lgrid' + (games.length ? ' pairs' : '') });
    var mineIn = function (gi) { return cfg.games[gi].a === state.mine || cfg.games[gi].b === state.mine ? 1 : 0; };
    games.sort(function (x, y) { return mineIn(y) - mineIn(x); });                   // your own matchup first
    if (games.length) games.forEach(function (gi) {
      var g = cfg.games[gi], pa = E.winProb(cfg.rel[g.week][g.a], cfg.rel[g.week][g.b], cfg.sigma, cfg.v[g.a], cfg.v[g.b]);
      grid.appendChild(el('div', { class: 'pair' }, [lineupCard(g.a, wk, g.b, pa), lineupCard(g.b, wk, g.a, 1 - pa)]));
    });
    else orderNow.forEach(function (i) { grid.appendChild(lineupCard(i, wk, -1, 0)); });
    host.appendChild(grid);
    proj[wk].lineups.forEach(function (l) { l.forEach(function (r) { if (r.fa) anyFa = true; }); });
    if (anyFa) host.appendChild(el('p', { class: 'note foot', text: 'FA is a free agent filling an empty slot.' }));
    projTable(host);
  }
  function showLineup(i) {
    setTab('lineups');
    var c = $('lu-' + T[i].rid); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'center' });
  }

  /* ---------- main column ---------- */
  function renderMain() {
    var host = $('main'), keep = focusKey(), data = state.tab === 'playoffs' || state.tab === 'draft'; host.textContent = '';
    if (state.tab === 'method') return;
    host.setAttribute('aria-labelledby', 'tab-' + state.tab);
    if (data && state.mine >= 0) host.appendChild(mineCard());
    if (state.tab === 'draft' && !D.show) state.tab = 'playoffs';
    if (state.tab === 'playoffs') playoffTable(host); else if (state.tab === 'draft') draftTable(host); else lineupsTab(host);
    refocus(keep);
  }

  function fx(x) { return x >= 1000 ? String(Math.round(x)) : x.toFixed(1); }
  function weekPicker(weeks, at, kp, go, cls, count) {
    if (weeks.length <= 3) {
      var seg = el('div', { class: 'seg ' + (cls || ''), role: 'group', 'aria-label': 'Week' });
      weeks.forEach(function (w) { var c = count ? count(w) : 0; seg.appendChild(el('button', { type: 'button', 'data-k': kp + w, 'aria-pressed': String(w === at), onclick: function () { go(w); } }, ['Week ' + w, c ? el('span', { class: 'cnt', 'aria-label': plural(c, 'pick'), text: String(c) }) : null])); });
      return seg;
    }
    var k = weeks.indexOf(at), c0 = count ? count(at) : 0, total = 0; if (count) weeks.forEach(function (w) { total += count(w); });
    return el('div', { class: 'stepper ' + (cls || '') }, [
      el('button', { type: 'button', 'data-k': kp + 'prev', 'aria-label': 'Earlier week', disabled: k <= 0 ? '' : null, text: '‹', onclick: function () { if (k > 0) go(weeks[k - 1]); } }),
      el('span', { class: 'wk' }, ['Week ' + at, c0 ? el('span', { class: 'cnt', 'aria-label': plural(c0, 'pick'), text: String(c0) }) : null, total > c0 ? el('small', { text: plural(total, 'pick') + ' in all' }) : null]),
      el('button', { type: 'button', 'data-k': kp + 'next', 'aria-label': 'Later week', disabled: k >= weeks.length - 1 ? '' : null, text: '›', onclick: function () { if (k < weeks.length - 1) go(weeks[k + 1]); } })]);
  }

  /* ---------- what-if panel ---------- */
  function changes() {
    var rows = [], i;
    for (i = 0; i < n; i++) {
      if (state.tab === 'playoffs') {
        var best = null;
        [['playoff', 'Make the playoffs'], ['bye', 'First-round bye'], ['champ', 'Win the title']].forEach(function (c) {
          if (c[0] === 'bye' && !NB) return;
          var a = shown(base, c[0], i, c06, c02), b = shown(cur, c[0], i, cl6, cl2), d = dpts(a.p, b.p);
          if (d && (!best || Math.abs(d) > Math.abs(best.d))) best = { i: i, who: T[i].name, label: c[1], from: pct(a.p, a.zero, a.one), to: pct(b.p, b.zero, b.one), d: d, score: Math.abs(d) / 100, dl: arrow(d), cls: d > 0 ? 'up' : 'down' };
        });
        if (best) rows.push(best);
      } else {
        var a1 = slotP(base, i, 0), b1 = slotP(cur, i, 0), a3 = top3(base, i), b3 = top3(cur, i), am = meanSlot(base, i), bm = meanSlot(cur, i), owner = OWN[1][i];
        var who = poss(T[i].name) + ' pick', held = owner !== i ? ', held by ' + T[owner].name : '', d1 = dpts(a1, b1), d3 = dpts(a3, b3), dm = (Math.round(bm * 10) - Math.round(am * 10)) / 10;
        if (d1 || d3) {
          var first = Math.abs(d1) > Math.abs(d3), dd = first ? d1 : d3;
          rows.push({ i: i, who: who, label: (first ? 'First pick' : 'Top-three pick') + held, from: pz(first ? a1 : a3), to: pz(first ? b1 : b3), d: dd, score: Math.abs(dd) / 100, dl: arrow(dd), cls: '' });
        } else if (dm) {
          rows.push({ i: i, who: who, label: 'Average slot' + held, from: am.toFixed(1), to: bm.toFixed(1), d: dm, score: Math.abs(dm) * 0.25, dl: Math.abs(dm).toFixed(1) + (dm > 0 ? ' later' : ' earlier'), cls: '' });
        }
      }
    }
    rows.sort(function (x, y) { return (y.i === state.mine) - (x.i === state.mine) || y.score - x.score; });
    return rows.slice(0, 5);
  }
  function renderPicker() {
    var host = $('whatif'), keep = focusKey(), k = nPicks(), weeks = [];
    host.textContent = '';
    cfg.games.forEach(function (g) { if (weeks.indexOf(g.week) < 0) weeks.push(g.week); });
    var hint = el('p', { class: 'note', text: 'Tap a winner.' });
    host.appendChild(el('div', { class: 'wihead' }, [el('div', null, [el('h2', { text: 'What if?' }), hint]), k ? el('button', { type: 'button', class: 'reset', 'data-k': 'reset2', text: 'Reset picks', onclick: resetPicks }) : null]));
    if (!weeks.length) { hint.textContent = LG.phase === 'done' ? 'The season is over.' : 'The regular season is over, so there are no games left to pick.'; return; }
    if (weeks.indexOf(state.week) < 0) state.week = weeks[0];
    if (weeks.length > 1) host.appendChild(weekPicker(weeks, state.week, 'w', function (w) { state.week = w; if (cfg.levGames) run(); else renderPicker(); }, '', function (w) { var c = 0; cfg.games.forEach(function (g, gi) { if (g.week === w && state.picks[gi]) c++; }); return c; }));
    var list = el('div', { class: 'games' });
    gameRank[state.tab].forEach(function (gi) {
      var g = cfg.games[gi]; if (g.week !== state.week) return;
      var pa = base.gameW[gi] > 0 ? base.gameA[gi] / base.gameW[gi] : 0.5, pick = state.picks[gi], over = decided(g);
      var row = el('div', { class: 'game' + (over ? ' over' : ''), role: 'group', 'aria-label': T[g.a].name + ' against ' + T[g.b].name });
      [[g.a, pa, 1, 'a'], [g.b, 1 - pa, 2, 'b']].forEach(function (s) {
        var won = pick === s[2], lost = !!pick && !won;
        row.appendChild(el('button', { type: 'button', 'data-k': 'g' + gi + s[3], 'aria-pressed': String(won), disabled: over ? '' : null,
          class: 'side ' + s[3] + (lost ? ' lost' : '') + (s[1] > 0.5 ? ' fav' : '') + (s[0] === state.mine ? ' mine' : ''),
          'aria-label': T[s[0]].name + (won ? ', picked to win. Tap to undo.' : ', ' + pct(s[1]) + ' to win. Tap to pick.'),
          onclick: function () { setPick(gi, won ? 0 : s[2]); } },
          [nameEl(s[0]), won ? checkIcon() : lost ? null : el('span', { class: 'wp', text: pct(s[1]) })]));
      });
      list.appendChild(row);
    });
    host.appendChild(list);
    if (!k) { refocus(keep); return; }
    var rows = stale ? [] : changes(), box = el('div', { class: 'changes' }, [el('h3', { text: 'What your ' + (k === 1 ? 'pick changes' : k + ' picks change') })]);
    if (stale) box.appendChild(el('p', { class: 'note', text: 'Rerunning the season.' }));
    else if (rows.length) {
      var ul = el('ul');
      rows.forEach(function (r) {
        ul.appendChild(el('li', null, [el('span', { class: 'who' }, [el('b', { text: r.who }), el('span', { text: r.label })]),
          el('span', { class: 'vals' }, [r.from + ' → ' + r.to, el('i', { class: 'dl ' + r.cls, text: r.dl })])]));
      });
      box.appendChild(ul);
    } else box.appendChild(el('p', { class: 'note', text: state.tab === 'playoffs' ? 'No team’s playoff or title odds move by a full point.' : 'No first-round pick moves by much.' }));
    box.appendChild(el('button', { type: 'button', class: 'linkbtn totop', 'data-k': 'totop', text: 'See every team in the table', onclick: function () {
      var smooth = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      $('main').scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    } }));
    host.appendChild(box);
    refocus(keep);
  }

  /* ---------- actions ---------- */
  function renderAll() {
    var data = state.tab === 'playoffs' || state.tab === 'draft', method = state.tab === 'method';
    renderBar();
    $('grid').hidden = method; $('method-panel').hidden = !method;
    $('grid').className = 'grid' + (data ? '' : ' solo'); $('whatif').hidden = !data;   // picks only matter on the two odds tabs
    renderMain(); renderExtra(); if (data) renderPicker();
  }
  function run() { compute(); stale = false; renderAll(); if (ctx.onRun) ctx.onRun({ cfg: cfg, base: base, N: N }); }
  function setPick(gi, v) {
    state.picks[gi] = v; stale = true;
    renderBar(); renderPicker();                       // the tap shows at once; the numbers follow
    var id = ++pending; setTimeout(function () { if (id === pending) run(); }, 30);
  }
  function resetPicks() { state.picks = new Array(G).fill(0); pending++; run(); }
  function toggleOpen(i) { state.open = state.open === i ? -1 : i; renderMain(); }
  function setTab(t, quiet) {
    if (TABS.indexOf(t) < 0) return;
    state.tab = t;
    if (!quiet) { try { if (location.hash !== '#' + t) location.hash = t; } catch (e) {} }
    renderAll();
    var bar = document.querySelector('.bar'), panel = t === 'method' ? $('method-panel') : $('grid');
    if (bar.getBoundingClientRect().top <= 0) window.scrollTo(0, Math.max(0, (window.pageYOffset || 0) + panel.getBoundingClientRect().top - bar.offsetHeight));   // tabs pinned: open the new tab at its top
  }

  /* one tooltip for chips, cells and bars: hover with a mouse, tap on a phone */
  var tip = $('tip'), tipTimer = 0;
  if (!window.__loTips) { window.__loTips = 1;
  function showTip(tgt, x, y) {
    tip.textContent = tgt.getAttribute('data-tip'); tip.hidden = false;
    var left = Math.min(window.innerWidth - tip.offsetWidth - 8, x + 14), top = y + 16;
    if (top + tip.offsetHeight > window.innerHeight - 8) top = y - tip.offsetHeight - 10;
    tip.style.left = Math.max(8, left) + 'px'; tip.style.top = Math.max(8, top) + 'px';
  }
  function tipTarget(ev) { return ev.target && ev.target.closest ? ev.target.closest('[data-tip]') : null; }
  document.addEventListener('pointermove', function (ev) { if (ev.pointerType === 'touch') return; var t = tipTarget(ev); if (t) showTip(t, ev.clientX, ev.clientY); else tip.hidden = true; });
  document.addEventListener('click', function (ev) {
    var t = tipTarget(ev); clearTimeout(tipTimer);
    if (!t) { tip.hidden = true; return; }
    showTip(t, ev.clientX, ev.clientY); tipTimer = setTimeout(function () { tip.hidden = true; }, 2800);
  });
  window.addEventListener('scroll', function () { tip.hidden = true; }, true);
  }

  function start(saved) {
    try { var r = Number(localStorage.getItem('league-odds-team-' + LG.id)); T.forEach(function (t, i) { if (t.rid === r) state.mine = i; }); } catch (e) {}
    if (saved && typeof saved === 'object') {
      if (Array.isArray(saved.picks)) state.picks = saved.picks;
      if (typeof saved.mode === 'string') state.mode = saved.mode;
      if (typeof saved.open === 'number') state.open = saved.open;
      if (typeof saved.week === 'number') state.week = saved.week;
      if (TABS.indexOf(saved.tab) >= 0) state.tab = saved.tab;
    }
    var h = (location.hash || '').replace('#', ''); if (TABS.indexOf(h) >= 0) state.tab = h;
    TABS.forEach(function (t) { $('tab-' + t).onclick = function () { setTab(t); }; });
    document.querySelector('.tabs').onkeydown = function (ev) {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      var t = TABS[(TABS.indexOf(state.tab) + (ev.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]; setTab(t); $('tab-' + t).focus();
    };
    window.onhashchange = function () { var x = (location.hash || '').replace('#', ''); if (TABS.indexOf(x) >= 0 && x !== state.tab) setTab(x, true); };
    $('mine').textContent = '';
    $('mine').onchange = (function () {
      state.mine = Number($('mine').value);
      try { if (state.mine >= 0) localStorage.setItem('league-odds-team-' + LG.id, String(T[state.mine].rid)); else localStorage.removeItem('league-odds-team-' + LG.id); } catch (e) {}
      renderAll();
    });
    Array.prototype.forEach.call(document.querySelectorAll('#basis button'), function (b) { b.onclick = function () { state.mode = b.getAttribute('data-mode'); run(); }; });
    run();
  }
    start(ctx.saved || {});
    return { state: state, rerun: run };
  }
  root.LOApp = { mount: mount };
})(typeof self !== 'undefined' ? self : this);
