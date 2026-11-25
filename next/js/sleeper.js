/* League Odds - reads a Sleeper league and turns it into one plain description every other part uses.
 * Works in the browser and in Node (pass any function that returns parsed JSON for a URL).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.LOSleeper = factory(root.LOCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  var API = 'https://api.sleeper.app/v1';

  function num(a, b) { return (a || 0) + (b || 0) / 100; }
  // a league id out of whatever was pasted: digits, or any Sleeper link that carries them
  function parseId(text) {
    var m = String(text || '').match(/(\d{15,22})/);
    return m ? m[1] : null;
  }
  function titleCase(name) {
    var small = { a: 1, an: 1, and: 1, as: 1, at: 1, but: 1, by: 1, for: 1, 'in': 1, of: 1, on: 1, or: 1, the: 1, to: 1, vs: 1, 'with': 1 };
    return String(name || '').trim().split(/\s+/).map(function (w, i) {
      if (/[A-Z]/.test(w)) return w;
      if (i && small[w.toLowerCase()]) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  // Everything the page needs for one league. get(url) -> Promise of JSON (null for "not found").
  function load(id, get, onStep) {
    var step = function (s) { if (onStep) onStep(s); };
    return Promise.all([get(API + '/league/' + id), get(API + '/state/nfl')]).then(function (r) {
      var L = r[0], state = r[1];
      if (!L || !L.league_id) { var e = new Error('No Sleeper league has that ID.'); e.code = 'notfound'; throw e; }
      if (L.sport && L.sport !== 'nfl') { var e2 = new Error('This is a ' + String(L.sport).toUpperCase() + ' league. Only NFL leagues work here.'); e2.code = 'sport'; throw e2; }
      step('league');
      var s = L.settings || {}, first = s.start_week || 1, lastWeek = 18;
      var weeks = []; for (var w = first; w <= lastWeek; w++) weeks.push(w);
      var jobs = [get(API + '/league/' + id + '/users'), get(API + '/league/' + id + '/rosters'), get(API + '/league/' + id + '/winners_bracket'),
        get(API + '/league/' + id + '/losers_bracket'), get(API + '/league/' + id + '/traded_picks'), get(API + '/league/' + id + '/drafts')];
      return Promise.all(jobs.concat(weeks.map(function (wk) { return get(API + '/league/' + id + '/matchups/' + wk); }))).then(function (x) {
        step('weeks');
        var matchups = {}; weeks.forEach(function (wk, i) { matchups[wk] = x[6 + i] || []; });
        return { league: L, state: state, users: x[0] || [], rosters: x[1] || [], winners: x[2] || [], losers: x[3] || [], traded: x[4] || [], drafts: x[5] || [], matchups: matchups };
      });
    });
  }

  // One finished earlier season, cut down to what the draft-order check needs.
  function loadPast(id, get) {
    return get(API + '/league/' + id).then(function (L) {
      if (!L) return null;
      return Promise.all([get(API + '/league/' + id + '/rosters'), get(API + '/league/' + id + '/winners_bracket'), get(API + '/league/' + id + '/drafts')]).then(function (x) {
        var drafts = x[2] || [];
        return (drafts[0] ? get(API + '/draft/' + drafts[0].draft_id) : Promise.resolve(null)).then(function (d) {
          return { league: L, rosters: x[0] || [], winners: x[1] || [], draft: d };
        });
      });
    });
  }

  // Earlier seasons paired with the draft that followed each one (the next season's own draft).
  // Returns [{ league, rosters, winners, draft }], most recent first.
  function loadHistory(raw, get, depth) {
    var out = [], drafts = (raw.drafts || []).slice().sort(function (x, y) { return (y.start_time || y.created || 0) - (x.start_time || x.created || 0); });
    var prev = raw.league.previous_league_id, first = drafts[0] ? get(API + '/draft/' + drafts[0].draft_id) : Promise.resolve(null);
    function stepBack(id, followingDraft, left) {
      if (!id || id === '0' || left <= 0) return Promise.resolve(out);
      return loadPast(id, get).then(function (p) {
        if (!p) return out;
        out.push({ league: p.league, rosters: p.rosters, winners: p.winners, draft: followingDraft });
        return stepBack(p.league.previous_league_id, p.draft, left - 1);
      }, function () { return out; });
    }
    return first.then(function (d) { return stepBack(prev, d, depth || 3); }, function () { return out; });
  }

  function shortName(name) {
    var s = String(name || '').replace(/^(the|team)\s+/i, '');
    if (s.length <= 16) return s;
    var words = s.split(/\s+/), out = '';
    for (var i = 0; i < words.length; i++) { if ((out + ' ' + words[i]).trim().length > 16) break; out = (out + ' ' + words[i]).trim(); }
    return out || s.slice(0, 15) + '…';
  }

  /* Turn the raw pull into the plain league description:
   * { id, name, season, phase, why, teams[], n, set{}, through, results{}, schedule{}, rec{}, bracket, fixed, rosters[], traded[], draft{} } */
  function normalize(raw) {
    var L = raw.league, s = L.settings || {}, st = raw.state || {}, D = { platform: 'sleeper', id: L.league_id, name: titleCase(L.name), season: String(L.season), status: L.status, warnings: [] };
    var rosters = (raw.rosters || []).slice().sort(function (a, b) { return a.roster_id - b.roster_id; });
    var n = rosters.length, idx = {}, i;
    rosters.forEach(function (r, k) { idx[r.roster_id] = k; });
    var users = {}; (raw.users || []).forEach(function (u) { users[u.user_id] = u; });
    D.n = n;
    D.teams = rosters.map(function (r, k) {
      var u = users[r.owner_id] || {}, nm = (u.metadata && u.metadata.team_name) || (u.display_name ? 'Team ' + u.display_name : 'Team ' + r.roster_id);
      nm = String(nm).trim() || 'Team ' + r.roster_id;
      return { rid: r.roster_id, name: nm, short: shortName(nm), mgr: u.display_name || '', div: (r.settings && r.settings.division) || null };
    });
    var P = s.playoff_teams, pws = s.playoff_week_start, first = s.start_week || 1;
    var slots = C.starterSlots(L.roster_positions);
    D.set = { P: P, first: first, regEnd: (pws || 15) - 1, reseed: s.playoff_seed_type === 1, median: s.league_average_match === 1, nDiv: s.divisions > 1 ? s.divisions : 0,
      type: s.type === 2 ? 'dynasty' : s.type === 1 ? 'keeper' : 'redraft', bestBall: s.best_ball === 1, slots: slots, scoring: L.scoring_settings || {}, draftRounds: s.draft_rounds || 0,
      roundType: s.playoff_round_type || 0, lowerType: s.playoff_type || 0, overridden: !!L.bracket_overrides_id, taxi: s.taxi_slots || 0 };
    // formats this can't do
    if (n < 2) { D.phase = 'unsupported'; D.why = 'This league has no teams yet.'; return D; }
    if (!P || !pws || s.type === 3) { D.phase = 'unsupported'; D.why = 'This league has no head-to-head playoffs (a guillotine or points-only format), so there are no playoff odds to work out.'; return D; }
    if (P > n) P = D.set.P = n;
    if (D.set.nDiv) { var seenDiv = {}; D.teams.forEach(function (t) { if (t.div != null) seenDiv[t.div] = 1; }); if (Object.keys(seenDiv).length < 2) D.set.nDiv = 0; }

    // bracket shape and playoff weeks
    var std = C.standardBracket(P), nRounds = 0; std.forEach(function (g) { if (g.r > nRounds) nRounds = g.r; });
    (raw.winners || []).forEach(function (g) { if (g.r > nRounds) nRounds = g.r; });
    D.set.rounds = C.roundWeeks(pws, nRounds, D.set.roundType, 18);
    var lastPlayoffWeek = pws; D.set.rounds.forEach(function (wk) { wk.forEach(function (w) { if (w > lastPlayoffWeek) lastPlayoffWeek = w; }); });
    D.set.lastWeek = lastPlayoffWeek;

    // weekly results
    var lsl = s.last_scored_leg || 0, results = {}, schedule = {}, scores = {}, anyGame = false, w;
    var pts = function (m) { return m.custom_points != null ? m.custom_points : (m.points || 0); };
    for (w = first; w <= 18; w++) {
      var rows = raw.matchups[w] || [], by = {}, sc = new Array(n).fill(null), pairs = [];
      rows.forEach(function (m) { var k = idx[m.roster_id]; if (k == null) return; sc[k] = pts(m); if (m.matchup_id != null) (by[m.matchup_id] = by[m.matchup_id] || []).push(k); });
      Object.keys(by).forEach(function (mid) { var p = by[mid]; if (p.length === 2) pairs.push(p[0] < p[1] ? [p[0], p[1]] : [p[1], p[0]]); });
      scores[w] = sc;
      if (w > D.set.regEnd) continue;
      if (!pairs.length) continue;
      anyGame = true;
      if (w <= lsl) results[w] = pairs.map(function (p) { return [p[0], p[1], sc[p[0]] || 0, sc[p[1]] || 0]; });
      else schedule[w] = pairs;
    }
    // if Sleeper has no "last scored week", fall back to weeks before the current one that have points
    if (!lsl && st.week) for (w = first; w < Math.min(st.week, D.set.regEnd + 1); w++) if (schedule[w] && scores[w].some(function (x) { return x > 0; })) { results[w] = schedule[w].map(function (p) { return [p[0], p[1], scores[w][p[0]] || 0, scores[w][p[1]] || 0]; }); delete schedule[w]; lsl = w; }
    D.through = Math.min(lsl, D.set.regEnd); D.scored = lsl; D.results = results; D.schedule = schedule; D.scores = scores; D.nflWeek = st.week || null;

    // standings: Sleeper's own totals when it has them, else rebuilt from the weeks
    var rec = { wins: [], losses: [], ties: [], pf: [], pa: [], pp: [] }, have = 0;
    rosters.forEach(function (r) { var x = r.settings || {}; rec.wins.push(x.wins || 0); rec.losses.push(x.losses || 0); rec.ties.push(x.ties || 0); rec.pf.push(num(x.fpts, x.fpts_decimal)); rec.pa.push(num(x.fpts_against, x.fpts_against_decimal)); rec.pp.push(num(x.ppts, x.ppts_decimal)); have += (x.wins || 0) + (x.losses || 0) + (x.ties || 0); });
    var mine = rebuild(n, results, D.set.median);
    if (!have && Object.keys(results).length) { rec.wins = mine.wins; rec.losses = mine.losses; rec.ties = mine.ties; rec.pf = mine.pf; rec.pa = mine.pa; D.warnings.push('standings rebuilt from weekly scores'); }
    else if (have) { for (i = 0; i < n; i++) if (mine.wins[i] !== rec.wins[i] || mine.losses[i] !== rec.losses[i]) { D.recordsDiffer = true; break; } }
    D.rec = rec; D.rebuilt = mine;

    // rosters
    D.rosters = rosters.map(function (r) { var tx = {}; (r.taxi || []).forEach(function (p) { tx[p] = 1; }); return { players: (r.players || []).filter(function (p) { return !tx[p]; }), all: r.players || [], starters: r.starters || [], taxi: r.taxi || [], reserve: r.reserve || [] }; });

    // phase
    var regLeft = Object.keys(schedule).length;
    if (L.status === 'complete') D.phase = 'done';
    else if (L.status === 'pre_draft' || L.status === 'drafting' || !anyGame) { D.phase = 'pre'; D.why = L.status === 'in_season' ? 'This league has no schedule yet.' : 'This league hasn’t drafted yet. Come back once the season starts.'; }
    else if (regLeft) D.phase = 'regular';
    else D.phase = 'playoffs';

    // seeding and the bracket
    var div = D.set.nDiv ? D.teams.map(function (t) { return t.div; }) : null;
    var order = C.seedOrder(rec, div, D.set.nDiv), seedOf = {}, seedByRid = {};
    order.forEach(function (t, sd) { seedOf[t] = sd; if (sd < P) seedByRid[rosters[t].roster_id] = sd; });
    D.order = order;
    var fromSleeper = C.bracketFromSleeper(raw.winners, seedByRid), stdKey = C.bracketKey(std);
    D.bracket = std; D.bracketSource = 'standard';
    if (fromSleeper && !D.set.reseed) {
      if (C.bracketKey(fromSleeper) === stdKey) D.bracketSource = 'sleeper';
      else if (validBracket(fromSleeper, P)) { D.bracket = fromSleeper; D.bracketSource = 'sleeper-custom'; }
    }
    D.seedsMatch = !!fromSleeper || !(raw.winners && raw.winners.length) || firstRoundMatches(raw.winners, seedByRid, std);

    if (D.phase === 'playoffs' || D.phase === 'done') D.fixed = fixedFromBracket(raw, D, idx, order, P, lsl);

    // traded picks and drafts
    D.traded = (raw.traded || []).map(function (x) { return { season: String(x.season), round: x.round, orig: idx[x.roster_id], owner: idx[x.owner_id] }; }).filter(function (x) { return x.orig != null && x.owner != null; });
    var drafts = (raw.drafts || []).slice().sort(function (a, b) { return (b.start_time || b.created || 0) - (a.start_time || a.created || 0); });
    D.draftType = drafts[0] ? drafts[0].type : null;
    D.prevId = L.previous_league_id && L.previous_league_id !== '0' ? L.previous_league_id : null;
    return D;
  }

  function validBracket(br, P) {
    var seen = {}, ok = true, finals = 0;
    br.forEach(function (g) { [g.a, g.b].forEach(function (x) { if (x.s != null) { if (x.s >= P || seen[x.s]) ok = false; seen[x.s] = 1; } }); if (g.p === 1) finals++; });
    return ok && finals === 1 && Object.keys(seen).length === P;
  }
  function firstRoundMatches(rows, seedByRid, std) {
    var want = std.filter(function (g) { return g.r === 1; }).map(function (g) { return [g.a.s, g.b.s].sort().join('v'); }).sort().join(' ');
    var got = rows.filter(function (x) { return x.r === 1; }).map(function (x) { return [seedByRid[x.t1], seedByRid[x.t2]].sort().join('v'); }).sort().join(' ');
    return want === got;
  }
  // records from weekly results, with the median game when the league plays one
  function rebuild(n, results, median) {
    var o = { wins: new Array(n).fill(0), losses: new Array(n).fill(0), ties: new Array(n).fill(0), pf: new Array(n).fill(0), pa: new Array(n).fill(0), games: new Array(n).fill(0) };
    Object.keys(results).forEach(function (w) {
      var g = results[w], vals = [];
      g.forEach(function (x) {
        var a = x[0], b = x[1]; o.pf[a] += x[2]; o.pf[b] += x[3]; o.pa[a] += x[3]; o.pa[b] += x[2]; o.games[a]++; o.games[b]++;
        if (x[2] > x[3]) { o.wins[a]++; o.losses[b]++; } else if (x[3] > x[2]) { o.wins[b]++; o.losses[a]++; } else { o.ties[a]++; o.ties[b]++; }
        vals.push([a, x[2]], [b, x[3]]);
      });
      if (median && vals.length) {
        var sorted = vals.map(function (v) { return v[1]; }).sort(function (p, q) { return p - q; }), m = sorted.length;
        var med = m % 2 ? sorted[(m - 1) / 2] : (sorted[m / 2 - 1] + sorted[m / 2]) / 2;
        vals.forEach(function (v) { if (v[1] > med) o.wins[v[0]]++; else if (v[1] < med) o.losses[v[0]]++; else o.ties[v[0]]++; });
      }
    });
    return o;
  }

  // Playoffs under way or over: who is in, which games are done, and points banked in a two-week game.
  function fixedFromBracket(raw, D, idx, order, P, lsl) {
    var rows = raw.winners || [], f = { seeds: order.slice(0, P), rest: order.slice(P), teams: {}, done: {}, partial: {} };
    if (!rows.length) return f;
    // trust Sleeper's first-round teams: when they differ from our seeding (commissioner edits), re-seat the seeds
    var byM = {}; rows.forEach(function (x) { byM[x.m] = x; });
    var seat = {}, clash = false;
    D.bracket.forEach(function (g) {
      var x = byM[g.m]; if (!x) return;
      [['a', 't1'], ['b', 't2']].forEach(function (pr) {
        var side = g[pr[0]], rid = x[pr[1]];
        if (side.s != null && typeof rid === 'number' && !x[pr[1] + '_from'] && idx[rid] != null) seat[side.s] = idx[rid];
      });
    });
    // seats can be listed in either order inside a game; accept Sleeper's teams when the set of playoff teams differs
    var seated = Object.keys(seat).map(function (k) { return seat[k]; }), mineSet = {}; f.seeds.forEach(function (t) { mineSet[t] = 1; });
    if (seated.length === P && seated.some(function (t) { return !mineSet[t]; })) clash = true;
    if (clash) {
      var inSet = {}; seated.forEach(function (t) { inSet[t] = 1; });
      f.seeds = order.filter(function (t) { return inSet[t]; }); f.rest = order.filter(function (t) { return !inSet[t]; });
      D.warnings.push('playoff teams taken from Sleeper’s bracket (edited by the commissioner)');
    }
    var roundOf = {}; D.bracket.forEach(function (g) { roundOf[g.m] = g.r; });
    rows.forEach(function (x) {
      var a = typeof x.t1 === 'number' ? idx[x.t1] : null, b = typeof x.t2 === 'number' ? idx[x.t2] : null;
      if (a != null && b != null) f.teams[x.m] = [a, b];
      if (x.w != null && x.l != null && idx[x.w] != null && idx[x.l] != null) { f.done[x.m] = [idx[x.w], idx[x.l]]; return; }
      if (a == null || b == null) return;
      var weeks = D.set.rounds[(x.r || roundOf[x.m] || 1) - 1] || [], pa = 0, pb = 0, left = [];
      weeks.forEach(function (w) { if (w <= lsl) { pa += (D.scores[w] && D.scores[w][a]) || 0; pb += (D.scores[w] && D.scores[w][b]) || 0; } else left.push(w); });
      if (!left.length && weeks.length) { var sa = f.seeds.indexOf(a), sb = f.seeds.indexOf(b), win = pa > pb || (pa === pb && sa < sb) ? a : b; f.done[x.m] = [win, win === a ? b : a]; }
      else if (left.length < weeks.length) f.partial[x.m] = { a: pa, b: pb, weeks: left };
    });
    return f;
  }

  return { API: API, parseId: parseId, titleCase: titleCase, load: load, loadPast: loadPast, loadHistory: loadHistory, normalize: normalize, rebuild: rebuild, shortName: shortName };
});
