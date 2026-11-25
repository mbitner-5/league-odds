/* League Odds - start screen, loading a league, and handing it to the page. */
(function () {
  'use strict';
  var C = window.LOCore, E = window.LOEngine, S = window.LOSleeper, M = window.LOModel;
  var $ = function (id) { return document.getElementById(id); };
  var DATA = (window.LO_DATA || 'data/'), TTL = 3 * 60 * 1000;
  function el(tag, attrs, kids) {
    var e = document.createElement(tag), k;
    for (k in (attrs || {})) { var v = attrs[k]; if (v == null || v === false) continue; if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
    (kids || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function show(id) { ['start', 'loading', 'message', 'app'].forEach(function (x) { $(x).hidden = x !== id; }); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  /* ---------- network: JSON with a timeout, one retry, and a short-lived cache for league pulls ---------- */
  var mem = {};
  function getJSON(url, tries) {
    if (mem[url]) return mem[url];
    var attempt = function (left) {
      var ctl = window.AbortController ? new AbortController() : null, timer = setTimeout(function () { if (ctl) ctl.abort(); }, 15000);
      return fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (r) {
        clearTimeout(timer);
        if (r.status === 404) return null;
        if (r.status === 429) { var e = new Error('Sleeper is limiting requests right now. Wait a minute and try again.'); e.code = 'busy'; throw e; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).catch(function (err) {
        clearTimeout(timer);
        if (err && err.code === 'busy') throw err;
        if (left > 0) return new Promise(function (res) { setTimeout(res, 700); }).then(function () { return attempt(left - 1); });
        var e2 = new Error(navigator.onLine === false ? 'You appear to be offline.' : 'Couldn’t reach Sleeper. Check your connection and try again.'); e2.code = 'net'; throw e2;
      });
    };
    var p = attempt(tries == null ? 1 : tries);
    mem[url] = p; p.catch(function () { delete mem[url]; });
    return p;
  }
  function optional(url) { return getJSON(url, 0).catch(function () { return null; }); }

  /* ---------- start screen ---------- */
  function recent() { return store('league-odds-recent') || []; }
  function remember(D) {
    var list = recent().filter(function (x) { return x.id !== D.id; });
    list.unshift({ id: D.id, name: D.name, season: D.season }); store('league-odds-recent', list.slice(0, 6));
  }
  function leagueLink(x, sub) { return el('a', { href: '?league=' + x.id }, [x.name, el('small', { text: sub || x.season })]); }
  function showStart(err) {
    show('start'); document.title = 'League Odds';
    $('start-err').hidden = !err; $('start-err').textContent = err || '';
    var r = recent(), box = $('recent'); box.textContent = ''; box.hidden = !r.length;
    if (r.length) { box.appendChild(el('h2', { text: 'Recent' })); r.forEach(function (x) { box.appendChild(leagueLink(x)); }); }
    $('found').hidden = true;
  }
  function busy(on) { $('go-btn').disabled = on; $('go-btn').textContent = on ? 'Looking' : 'Show odds'; }
  function onGo(ev) {
    ev.preventDefault();
    var q = $('q').value.trim(), id = S.parseId(q);
    $('start-err').hidden = true; $('found').hidden = true;
    if (!q) { $('start-err').textContent = 'Enter a league ID, a league link or a Sleeper username.'; $('start-err').hidden = false; return; }
    if (id) { location.href = '?league=' + id; return; }
    // otherwise treat it as a username and list that user's leagues
    var name = q.replace(/^@/, '').replace(/^https?:\/\/\S*\/(u|user)\//, '');
    if (!/^[A-Za-z0-9_.-]{2,40}$/.test(name)) { $('start-err').textContent = 'That doesn’t look like a league ID, a Sleeper link or a username.'; $('start-err').hidden = false; return; }
    busy(true);
    Promise.all([getJSON(S.API + '/user/' + encodeURIComponent(name)), getJSON(S.API + '/state/nfl')]).then(function (r) {
      var u = r[0], st = r[1] || {};
      if (!u || !u.user_id) throw Object.assign(new Error('No Sleeper user is named “' + name + '”.'), { code: 'nouser' });
      var season = st.league_season || st.season || new Date().getFullYear();
      return getJSON(S.API + '/user/' + u.user_id + '/leagues/nfl/' + season).then(function (list) {
        list = (list || []).filter(function (L) { return L && L.league_id; });
        if (!list.length) throw Object.assign(new Error(name + ' has no NFL leagues in ' + season + '.'), { code: 'none' });
        var box = $('found'); box.textContent = ''; box.hidden = false;
        box.appendChild(el('h2', { text: (u.display_name || name) + '’s leagues' }));
        list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }).forEach(function (L) {
          var s = L.settings || {}, kind = s.type === 2 ? 'Dynasty' : s.type === 1 ? 'Keeper' : 'Redraft';
          box.appendChild(leagueLink({ id: L.league_id, name: S.titleCase(L.name) }, (L.total_rosters || s.num_teams || '?') + ' teams, ' + kind));
        });
      });
    }).catch(function (e) { $('start-err').textContent = e.message || 'Something went wrong.'; $('start-err').hidden = false; }).then(function () { busy(false); });
  }

  /* ---------- shared projections ---------- */
  function loadShared(D) {
    var need = M.weeksNeeded(D), out = { players: {}, weeks: {}, meta: null };
    if (!need.length) return Promise.resolve(out);
    return optional(DATA + 'meta.json').then(function (meta) {
      if (!meta || String(meta.season) !== String(D.season)) return out;
      out.meta = meta;
      var have = need.filter(function (w) { return meta.weeks.indexOf(w) >= 0; });
      if (!have.length) return out;
      var v = '?v=' + encodeURIComponent(meta.built || '');
      return Promise.all([optional(DATA + 'players_' + meta.season + '.json' + v)].concat(have.map(function (w) { return optional(DATA + 'proj_' + meta.season + '_' + w + '.json' + v); }))).then(function (r) {
        if (!r[0]) return out;
        out.players = r[0]; have.forEach(function (w, i) { if (r[i + 1]) out.weeks[w] = r[i + 1]; });
        return out;
      });
    });
  }

  /* ---------- a week under way: which NFL teams have played, are playing, or are still to come ---------- */
  function liveWeek(D, raw, shared) {
    var w = D.scored + 1;
    if (D.phase === 'done' || w > D.set.lastWeek || !(D.scores[w] || []).some(function (x) { return x > 0; })) return Promise.resolve(null);
    if (!shared.weeks[w]) return Promise.resolve({ week: w, unknown: true });
    return optional('https://api.sleeper.app/schedule/nfl/regular/' + D.season).then(function (sched) {
      if (!sched || !sched.length) return { week: w, unknown: true };
      var st = {};
      sched.forEach(function (g) { if (g.week !== w) return; var s = g.status === 'complete' ? 'done' : g.status === 'pre_game' ? 'pre' : 'live'; st[g.home] = s; st[g.away] = s; });
      if (!Object.keys(st).length) return { week: w, unknown: true };
      return M.liveWeek(D, raw.matchups[w], shared.weeks[w], shared.players, function (team) { return st[team] || null; }, w);
    });
  }

  /* ---------- this league's draft-order habit, from its own past drafts (remembered per league) ---------- */
  function draftRule(D, raw) {
    var fallback = { nonPlayoff: 'maxpf', playoff: 'place', byRound: null, seasons: 0 };
    if (D.set.type === 'redraft' || !D.prevId) return Promise.resolve(fallback);
    var key = 'league-odds-rule-' + D.id, saved = store(key);
    if (saved && saved.nonPlayoff) return Promise.resolve(saved);
    var slow = new Promise(function (res) { setTimeout(function () { res(null); }, 6000); });
    return Promise.race([S.loadHistory(raw, getJSON, 3), slow]).then(function (hist) {
      if (!hist) return fallback;
      var inf = M.inferDraftRule(hist), rule = { nonPlayoff: inf.nonPlayoff, playoff: inf.playoff, byRound: inf.byRound || null, seasons: inf.seasons, known: inf.known };
      if (!inf.seasons) return fallback;
      store(key, rule); return rule;
    }).catch(function () { return fallback; });
  }

  /* ---------- "How it works", written for the league on screen ---------- */
  function methodText(D, cfg, N, rule, draftShown) {
    var s = D.set, cols = $('method-cols'); cols.textContent = '';
    var col = function (title, kids) { cols.appendChild(el('div', null, [el('h3', { text: title })].concat(kids))); };
    var p = function (t) { return el('p', { text: t }); }, li = function (t) { return el('li', { text: t }); };
    var byes = E.bracketInfo(D.bracket).byeSeeds.length;
    col('The model', [
      p('Every game left is played out ' + N.toLocaleString('en-US') + ' times. A team’s score in a week is its expected score plus luck, sized from how much scores in this league swing week to week.'),
      p(cfg.haveProj ? 'Expected scores start from Sleeper’s projections for each team’s best lineup, then lean toward how the team has actually scored as the weeks add up.' : 'Expected scores come from how each team has scored so far, pulled toward the league average early in the year.'),
      p('Picking a winner reruns the season with that result fixed.')]);
    var items = [s.P + ' of ' + D.n + ' teams make the playoffs' + (byes ? ', top ' + (byes === 1 ? 'seed gets' : byes + ' get') + ' a bye' : '') + '.',
      'Standings: record, then points for, then points against.'];
    if (s.nDiv) items.push('Division winners take the top seeds.');
    if (s.median) items.push('Each week every team also plays the league median.');
    if (s.reseed) items.push('The bracket re-seeds each round.');
    if (s.rounds.some(function (r) { return r.length > 1; })) items.push(s.roundType === 2 ? 'Every playoff round runs two weeks.' : 'The title game runs two weeks.');
    if (s.bestBall) items.push('Best ball: projected lineups stand in for the lineups Sleeper picks after the games.');
    if (draftShown) items.push('Draft order: non-playoff teams by ' + (rule.nonPlayoff === 'maxpf' ? 'fewest potential points (Max PF)' : rule.nonPlayoff === 'pf' ? 'fewest points' : 'worst record') + ', then playoff teams by how far they got.' + (rule.seasons ? ' Checked against ' + (rule.seasons === 1 ? 'last year’s draft.' : 'the last ' + rule.seasons + ' drafts.') : ''));
    col('This league', [el('ul', null, items.map(li))]);
    col('Limits', [el('ul', null, [
      li('In a week under way, points already scored count and the rest is projected. A game in progress is treated as half played.'),
      li('Trades, injuries and waiver moves that haven’t happened yet aren’t predicted.'),
      li('Commissioner edits to seeds or draft order can’t be known ahead of time.'),
      li('100% and a dash mean settled by arithmetic. >99% and <1% mean very likely, not certain.')])]);
  }

  /* ---------- load and show one league ---------- */
  function fail(D, text) {
    show('message'); var box = $('message'); box.textContent = '';
    box.appendChild(el('h1', { text: D ? D.name : 'League Odds' }));
    box.appendChild(el('p', { text: text }));
    box.appendChild(el('p', null, [el('a', { href: './', text: 'Try another league' })]));
  }
  function openLeague(id) {
    show('loading');
    var known = recent().filter(function (x) { return x.id === id; })[0];
    $('load-name').textContent = known ? known.name : 'Loading the league';
    var cacheKey = 'league-odds-raw-' + id, cached = null;
    try { var c = JSON.parse(sessionStorage.getItem(cacheKey)); if (c && Date.now() - c.at < TTL) cached = c.raw; } catch (e) {}
    var pull = cached ? Promise.resolve(cached) : S.load(id, getJSON, function (step) { if (step === 'league') $('load-step').textContent = 'Reading every week’s matchups.'; });
    return pull.then(function (raw) {
      if (!cached) { try { sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), raw: raw })); } catch (e) {} }
      var D = S.normalize(raw);
      window.__lo = { raw: raw, league: D };
      if (D.phase === 'unsupported' || D.phase === 'pre') { remember(D); fail(D, D.why); return; }
      $('load-name').textContent = D.name; $('load-step').textContent = 'Projecting lineups and running the season.';
      return loadShared(D).then(function (sh) { return Promise.all([sh, draftRule(D, raw), liveWeek(D, raw, sh)]); }).then(function (r) {
        var shared = r[0], rule = r[1], live = r[2], need = M.weeksNeeded(D), proj = M.projectWeeks(D, shared, need);
        var nextSeason = String(Number(D.season) + 1), rounds = Math.min(D.set.draftRounds || 0, 6);
        var draftShown = D.set.type === 'dynasty' && rounds > 0 && D.n >= 4 || (D.set.type === 'keeper' && rule.known && rounds > 0 && rounds <= 6);
        var ctx = { league: D, proj: proj, shared: shared, live: live && !live.unknown ? live : null, draft: { show: !!draftShown, season: nextSeason, rounds: rounds || 1, traded: D.traded.filter(function (x) { return x.season === nextSeason; }), rule: rule },
          onRun: function (o) { methodText(D, o.cfg, o.N, { nonPlayoff: app ? app.state.np : rule.nonPlayoff, seasons: rule.seasons }, draftShown); window.__lo.cfg = o.cfg; window.__lo.base = o.base; } };
        remember(D);
        document.title = D.name + ' League Odds';
        $('league-name').textContent = D.name;
        var when = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(' AM', ' am').replace(' PM', ' pm');
        var meta = D.phase === 'done' ? D.season + ' season, final.' : D.phase === 'playoffs' ? 'Playoffs, through Week ' + D.scored + '.' : (D.through ? 'Through Week ' + D.through + ' of ' + D.set.regEnd + '.' : 'Before Week ' + D.set.first + '.');
        $('meta').textContent = meta + ' Updated ' + when + '.';
        show('app');
        var app = null;
        // let the page paint before the heavy part
        return new Promise(function (res) { setTimeout(res, 20); }).then(function () {
          app = window.LOApp.mount(ctx); window.__lo.app = app;
          var notes = [];
          if (D.set.overridden && !D.seedsMatch) notes.push('Your commissioner has edited the playoff bracket, so seeds here may differ from Sleeper’s.');
          if (!shared.meta && need.length) notes.push('Projections aren’t available right now, so teams are rated on season scoring alone.');
          if (live && live.unknown) notes.push('Week ' + live.week + ' is under way. It counts here once Sleeper marks it final.');
          else if (live) notes.push('Week ' + live.week + ' is under way. Points scored so far are counted and the rest is projected.');
          var old = $('flags'); if (old) old.remove();
          if (notes.length) { var bar = document.querySelector('.bar'); bar.parentNode.insertBefore(el('p', { class: 'note flag', id: 'flags', text: notes.join(' ') }), bar); window.__lo.notes = notes; }
        });
      });
    }).catch(function (e) {
      if (e && e.code === 'notfound') { showStart('No Sleeper league has the ID ' + id + '. Check the number and try again.'); return; }
      if (e && (e.code === 'net' || e.code === 'busy' || e.code === 'sport')) { fail(null, e.message); return; }
      window.__loError = String(e && e.stack || e);
      fail(null, 'Something went wrong showing this league. Reload to try again.');
      if (window.console) console.error(e);
    });
  }

  $('go').addEventListener('submit', onGo);
  var qs = new URLSearchParams(location.search), id = S.parseId(qs.get('league') || qs.get('l') || '');
  if (id) openLeague(id); else showStart(qs.get('league') ? 'That league ID doesn’t look right.' : '');
})();
