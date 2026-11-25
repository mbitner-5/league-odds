/* League Odds - reads a public ESPN league into the same plain description the Sleeper reader produces.
 * ESPN only lets a browser read leagues whose commissioner has made them viewable to the public.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.LOEspn = factory(root.LOCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  var API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';
  var VIEWS = 'view=mSettings&view=mTeam&view=mMatchupScore&view=mStandings&view=mStatus';
  var SLOT = { 0: 'QB', 1: 'QB', 2: 'RB', 3: 'R/W', 4: 'WR', 5: 'W/T', 6: 'TE', 7: 'OP', 8: 'DT', 9: 'DE', 10: 'LB', 11: 'DL', 12: 'CB', 13: 'S', 14: 'DB', 15: 'DP', 16: 'DEF', 17: 'K', 18: 'P', 19: 'HC', 23: 'FLX' };
  var BENCH = { 20: 1, 21: 1 };
  var RULE = { H2H_RECORD: 'h2h', TOTAL_POINTS_SCORED: 'pf', INTRA_DIVISION_RECORD: 'div', TOTAL_POINTS_AGAINST: 'pa' };

  // an ESPN league out of a pasted link ("...leagueId=123&seasonId=2026") or "espn 123"
  function parse(text) {
    var t = String(text || ''), m = t.match(/leagueId=(\d{3,12})/i) || (/espn/i.test(t) ? t.match(/(\d{3,12})/) : null);
    if (!m) return null;
    var s = t.match(/seasonId=(\d{4})/i);
    return { id: m[1], season: s ? Number(s[1]) : null };
  }
  function url(id, season, q) { return API + '/' + season + '/segments/0/leagues/' + id + '?' + q; }

  function load(id, season, get) {
    return get(url(id, season, VIEWS)).then(function (L) {
      if (!L || !L.teams) { var e = new Error('ESPN won’t show this league. It has to be set to public: League, Settings, Basic Settings, “Make League Viewable to Public”.'); e.code = 'private'; throw e; }
      return { league: L, rosterWeeks: {} };
    });
  }
  // rosters with ESPN's own projected points for `week` and the week before it (one large download)
  function loadRosters(raw, id, season, week, get) {
    return get(url(id, season, 'view=mRoster&scoringPeriodId=' + week)).then(function (r) { if (r && r.teams) raw.rosterWeeks[week] = r.teams; return raw; }, function () { return raw; });
  }

  function normalize(raw, titleCase) {
    var L = raw.league, st = L.settings || {}, ss = st.scheduleSettings || {}, sc = st.scoringSettings || {}, status = L.status || {};
    var D = { platform: 'espn', id: 'espn-' + L.id, name: (titleCase || function (x) { return x; })(st.name || 'ESPN League'), season: String(L.seasonId), status: status.isActive === false ? 'complete' : 'in_season', warnings: [] };
    var teams = (L.teams || []).slice().sort(function (a, b) { return a.id - b.id; }), n = teams.length, idx = {}, i;
    teams.forEach(function (t, k) { idx[t.id] = k; });
    var members = {}; (L.members || []).forEach(function (m) { members[m.id] = m.displayName; });
    D.n = n;
    D.teams = teams.map(function (t) { var nm = String(t.name || ((t.location || '') + ' ' + (t.nickname || '')).trim() || 'Team ' + t.id).trim(); return { rid: t.id, name: nm, short: nm.length <= 16 ? nm : (t.abbrev || nm.slice(0, 15)), mgr: members[t.primaryOwner] || '', div: t.divisionId != null ? t.divisionId + 1 : null }; });
    var P = Math.min(ss.playoffTeamCount || 0, n), mpCount = ss.matchupPeriodCount || 0, periods = ss.matchupPeriods || {};
    var weekOf = function (mp) { return periods[mp] && periods[mp].length ? periods[mp][0] : mp; };
    var slots = []; Object.keys((st.rosterSettings || {}).lineupSlotCounts || {}).forEach(function (k) { if (!BENCH[k]) for (var c = 0; c < st.rosterSettings.lineupSlotCounts[k]; c++) slots.push(String(k)); });
    var nDiv = (ss.divisions || []).length > 1 ? ss.divisions.length : 0;
    D.set = { P: P, first: weekOf(1), regEnd: weekOf(mpCount), reseed: !!ss.playoffReseed, median: false, nDiv: nDiv, type: 'redraft', bestBall: false, slots: slots, scoring: {}, draftRounds: 0, roundType: 0, lowerType: 0,
      overridden: !!status.isPlayoffMatchupEdited, tiebreak: RULE[ss.playoffSeedingRule] || 'pf', slotNames: SLOT };
    if (n < 2 || !P || !mpCount) { D.phase = 'unsupported'; D.why = 'This league has no head-to-head playoffs to work out.'; return D; }
    if (sc.scoringType && sc.scoringType !== 'H2H_POINTS') { D.phase = 'unsupported'; D.why = 'This league uses category or roto scoring. Only head-to-head points leagues work here.'; return D; }
    var multi = false; for (var mp0 = 1; mp0 <= mpCount; mp0++) if (periods[mp0] && periods[mp0].length > 1) multi = true;
    if (multi) { D.phase = 'unsupported'; D.why = 'This league’s regular-season matchups run more than one week each, which isn’t supported yet.'; return D; }

    var std = C.standardBracket(P), R = 0; std.forEach(function (g) { if (g.r > R) R = g.r; });
    D.bracket = std; D.bracketSource = 'standard';
    D.set.rounds = []; for (var r = 1; r <= R; r++) D.set.rounds.push((periods[mpCount + r] || [weekOf(mpCount) + r]).slice());
    D.set.lastWeek = Math.max.apply(null, D.set.rounds.map(function (w) { return Math.max.apply(null, w); }));

    // schedule
    var results = {}, schedule = {}, scores = {}, lastDone = 0, H = new Float64Array(n * n), G = new Float64Array(n * n), po = [];
    (L.schedule || []).forEach(function (m) {
      if (!m.home || !m.away) return;
      var a = idx[m.home.teamId], b = idx[m.away.teamId]; if (a == null || b == null) return;
      var w = weekOf(m.matchupPeriodId), done = m.winner && m.winner !== 'UNDECIDED', pa = m.home.totalPoints || 0, pb = m.away.totalPoints || 0;
      (scores[w] = scores[w] || new Array(n).fill(null))[a] = pa; scores[w][b] = pb;
      if (m.matchupPeriodId > mpCount || (m.playoffTierType && m.playoffTierType !== 'NONE')) { po.push({ mp: m.matchupPeriodId, tier: m.playoffTierType, a: a, b: b, pa: pa, pb: pb, winner: m.winner }); return; }
      if (done) {
        (results[w] = results[w] || []).push([a, b, pa, pb, m.winner === 'HOME' ? 1 : m.winner === 'AWAY' ? 2 : 0]); if (w > lastDone) lastDone = w;
        G[a * n + b]++; G[b * n + a]++;
        if (m.winner === 'HOME') H[a * n + b]++; else if (m.winner === 'AWAY') H[b * n + a]++; else { H[a * n + b] += 0.5; H[b * n + a] += 0.5; }
      } else (schedule[w] = schedule[w] || []).push([a, b]);
    });
    // a week counts as played only when every one of its games is decided
    Object.keys(schedule).forEach(function (w) { if (results[w]) { results[w].forEach(function (g) { schedule[w].push([g[0], g[1]]); var a = g[0], b = g[1]; G[a * n + b]--; G[b * n + a]--; if (g[4] === 1) H[a * n + b]--; else if (g[4] === 2) H[b * n + a]--; else { H[a * n + b] -= 0.5; H[b * n + a] -= 0.5; } }); delete results[w]; } });
    lastDone = 0; Object.keys(results).forEach(function (w) { if (Number(w) > lastDone) lastDone = Number(w); });
    D.results = results; D.schedule = schedule; D.scores = scores; D.h2h = H; D.h2hGames = G;
    D.through = Math.min(lastDone, D.set.regEnd); D.scored = lastDone; D.nflWeek = L.scoringPeriodId || null;

    // standings: ESPN's totals, limited to the weeks counted above
    var mine = { wins: new Array(n).fill(0), losses: new Array(n).fill(0), ties: new Array(n).fill(0), pf: new Array(n).fill(0), pa: new Array(n).fill(0), pp: new Array(n).fill(0) };
    Object.keys(results).forEach(function (w) { results[w].forEach(function (g) { var a = g[0], b = g[1]; mine.pf[a] += g[2]; mine.pf[b] += g[3]; mine.pa[a] += g[3]; mine.pa[b] += g[2]; if (g[4] === 1) { mine.wins[a]++; mine.losses[b]++; } else if (g[4] === 2) { mine.wins[b]++; mine.losses[a]++; } else { mine.ties[a]++; mine.ties[b]++; } }); });
    var theirs = teams.map(function (t) { return (t.record && t.record.overall) || {}; }), same = teams.every(function (t, k) { return (theirs[k].wins || 0) === mine.wins[k] && (theirs[k].losses || 0) === mine.losses[k]; });
    D.rec = mine; D.recordsDiffer = !same && !Object.keys(schedule).some(function (w) { return (scores[w] || []).some(function (x) { return x > 0; }); });
    if (same) teams.forEach(function (t, k) { if (theirs[k].pointsFor) { mine.pf[k] = theirs[k].pointsFor; mine.pa[k] = theirs[k].pointsAgainst || mine.pa[k]; } });

    var regLeft = Object.keys(schedule).length, anyGame = regLeft || Object.keys(results).length;
    if (!anyGame) { D.phase = 'pre'; D.why = 'This league has no schedule yet. Come back once the season starts.'; return D; }
    var finalDone = po.some(function (m) { return m.tier === 'WINNERS_BRACKET' && m.mp === mpCount + R && m.winner && m.winner !== 'UNDECIDED'; });
    D.phase = regLeft ? 'regular' : (finalDone || status.isActive === false ? 'done' : 'playoffs');

    // seeds
    var div = nDiv ? D.teams.map(function (t) { return t.div; }) : null;
    var wr = mine.wins.map(function (w, k) { return C.winRate(w, mine.losses[k], mine.ties[k]); });
    D.order = C.orderWithRule(n, wr, mine.pf, mine.pa, div, nDiv, D.set.tiebreak, H, G);
    var espnSeed = teams.map(function (t) { return t.playoffSeed || 0; }), haveSeeds = espnSeed.every(function (s) { return s > 0; });
    D.seedsMatch = !haveSeeds || D.order.every(function (t, k) { return k >= P || espnSeed[t] === k + 1; });
    D.espnSeedOrder = haveSeeds ? teams.map(function (t, k) { return k; }).sort(function (a, b) { return espnSeed[a] - espnSeed[b]; }) : null;

    if (D.phase !== 'regular') {
      D.fixed = fixedFromSchedule(D, po, mpCount, P, R);
      // if ESPN's first-round games aren't the ones the seeds call for, don't guess
      var r1 = po.filter(function (m) { return m.mp === mpCount + 1 && m.tier === 'WINNERS_BRACKET'; }).length, got = D.bracket.filter(function (g) { return g.r === 1 && D.fixed.teams[g.m]; }).length;
      if (r1 && got < D.bracket.filter(function (g) { return g.r === 1; }).length) { D.phase = 'unsupported'; D.why = 'This league’s playoff bracket doesn’t follow the standard seeding, so its playoff odds can’t be worked out here yet.'; return D; }
    }
    D.rosters = []; D.traded = []; D.prevId = null;
    return D;
  }

  // playoff games already on ESPN's schedule, matched to the bracket by who is playing
  function fixedFromSchedule(D, po, mpCount, P, R) {
    var seeds = (D.espnSeedOrder || D.order).slice(0, P), rest = (D.espnSeedOrder || D.order).slice(P), f = { seeds: seeds, rest: rest, teams: {}, done: {}, partial: {} };
    var winner = {}, loser = {};
    var ref = function (x) { return x.s != null ? seeds[x.s] : x.w != null ? winner[x.w] : loser[x.l]; };
    for (var r = 1; r <= R; r++) {
      var games = po.filter(function (m) { return m.mp === mpCount + r && m.a != null && m.b != null; });
      D.bracket.forEach(function (g) {
        if (g.r !== r) return;
        var x = ref(g.a), y = ref(g.b); if (x == null || y == null) return;
        var hit = games.filter(function (m) { return (m.a === x && m.b === y) || (m.a === y && m.b === x); })[0];
        if (!hit) return;
        f.teams[g.m] = [x, y];
        if (hit.winner && hit.winner !== 'UNDECIDED') {
          var w = hit.winner === 'HOME' ? hit.a : hit.winner === 'AWAY' ? hit.b : (seeds.indexOf(x) < seeds.indexOf(y) ? x : y);
          winner[g.m] = w; loser[g.m] = w === x ? y : x; f.done[g.m] = [w, loser[g.m]];
        }
      });
    }
    return f;
  }

  /* Projected best lineup per team for each week ESPN gave projections for.
   * Returns { proj: { week: { totals, lineups } }, players: { id: [name, pos, team, []] } } */
  function project(raw, D, weeks) {
    var out = { proj: {}, players: {} }, idx = {}, slots = D.set.slots;
    D.teams.forEach(function (t, k) { idx[t.rid] = k; });
    var have = {};          // week -> team -> [{id, slots, pts}]
    Object.keys(raw.rosterWeeks).forEach(function (asked) {
      raw.rosterWeeks[asked].forEach(function (t) {
        var k = idx[t.id]; if (k == null) return;
        ((t.roster && t.roster.entries) || t.entries || []).forEach(function (e) {
          var p = (e.playerPoolEntry && e.playerPoolEntry.player) || e.player || {}, id = 'e' + e.playerId;
          out.players[id] = [p.fullName || 'Player ' + e.playerId, SLOT[p.defaultPositionId] || '', '', []];
          (p.stats || []).forEach(function (s) {
            if (s.statSourceId !== 1 || s.statSplitTypeId !== 1 || !(s.appliedTotal > 0) || String(s.seasonId) !== D.season) return;
            var w = s.scoringPeriodId; have[w] = have[w] || {}; (have[w][k] = have[w][k] || {})[id] = { id: id, slots: p.eligibleSlots || [], pts: s.appliedTotal };
          });
        });
      });
    });
    weeks.forEach(function (w) {
      if (!have[w]) return;
      var totals = [], lineups = [];
      for (var k = 0; k < D.n; k++) {
        var cand = Object.keys(have[w][k] || {}).map(function (id) { return have[w][k][id]; });
        var value = slots.map(function (s) { return cand.map(function (c) { return c.slots.indexOf(Number(s)) >= 0 ? c.pts : null; }); });
        var pick = C.assign(value, slots.length, cand.length), tot = 0, line = [];
        slots.forEach(function (s, q) { var c = pick[q] >= 0 ? cand[pick[q]] : null; line.push({ slot: SLOT[s] || s, id: c ? c.id : null, pts: c ? c.pts : 0 }); if (c) tot += c.pts; });
        totals.push(tot); lineups.push(line);
      }
      out.proj[w] = { totals: totals, lineups: lineups };
    });
    return out;
  }

  return { API: API, parse: parse, load: load, loadRosters: loadRosters, normalize: normalize, project: project, url: url, VIEWS: VIEWS };
});
