/* League Odds - shared building blocks. No DOM, no network.
 * Runs the same in Node (tests, research) and in the browser (the page).
 *   random numbers and the normal curve
 *   fantasy scoring from a stat line under any league's scoring settings
 *   best lineup for any set of starting slots
 *   standings order, division winners, playoff bracket shapes
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LOCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- random numbers ---------- */
  function sfc32(seed) {
    var a = 0x9e3779b9 ^ seed, b = 0x243f6a88 + seed | 0, c = 0xb7e15162 ^ (seed << 7), d = 1;
    function next() {
      a |= 0; b |= 0; c |= 0; d |= 0;
      var t = (a + b | 0) + d | 0;
      d = d + 1 | 0;
      a = b ^ b >>> 9;
      b = c + (c << 3) | 0;
      c = c << 21 | c >>> 11;
      c = c + t | 0;
      return (t >>> 0) / 4294967296;
    }
    for (var i = 0; i < 20; i++) next();
    return next;
  }
  function makeNormal(rng) {
    var spare = 0, has = false;
    return function () {
      if (has) { has = false; return spare; }
      var u, v, s;
      do { u = 2 * rng() - 1; v = 2 * rng() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
      var m = Math.sqrt(-2 * Math.log(s) / s);
      spare = v * m; has = true;
      return u * m;
    };
  }

  /* ---------- normal distribution ---------- */
  // Cumulative normal, double precision (Hart 1968 as given by West 2005).
  function normCdf(x) {
    var ax = Math.abs(x), c;
    if (ax > 37) c = 0;
    else {
      var e = Math.exp(-ax * ax / 2), b;
      if (ax < 7.07106781186547) {
        b = 3.52624965998911e-2 * ax + 0.700383064443688;
        b = b * ax + 6.37396220353165;
        b = b * ax + 33.912866078383;
        b = b * ax + 112.079291497871;
        b = b * ax + 221.213596169931;
        b = b * ax + 220.206867912376;
        c = e * b;
        b = 8.83883476483184e-2 * ax + 1.75566716318264;
        b = b * ax + 16.064177579207;
        b = b * ax + 86.7807322029461;
        b = b * ax + 296.564248779674;
        b = b * ax + 637.333633378831;
        b = b * ax + 793.826512519948;
        b = b * ax + 440.413735824752;
        c = c / b;
      } else {
        b = ax + 0.65;
        b = ax + 4 / b;
        b = ax + 3 / b;
        b = ax + 2 / b;
        b = ax + 1 / b;
        c = e / b / 2.506628274631;
      }
    }
    return x > 0 ? 1 - c : c;
  }
  // Inverse cumulative normal (Acklam) with one Halley refinement step.
  function normInv(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var q, r, x;
    if (p < 0.02425) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= 1 - 0.02425) {
      q = p - 0.5; r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (Math.abs(x) < 8) {
      var e = normCdf(x) - p;
      var u = e * 2.5066282746310002 * Math.exp(x * x / 2);
      x = x - u / (1 + x * u / 2);
    }
    return x;
  }

  /* ---------- scoring ---------- */
  // Points for a stat line that really happened: every stat times the league's value for it.
  // Sleeper's stat feed already carries the derived counts (distance buckets, bonuses), so this is exact.
  function scoreStats(stats, scoring) {
    var t = 0;
    for (var k in stats) { var w = scoring[k]; if (w) t += w * stats[k]; }
    return t;
  }

  // Chance a right-skewed total with the given mean and spread (sd / mean) reaches a threshold.
  function tailProb(mean, cv, threshold) {
    if (!(mean > 0)) return 0;
    var s2 = Math.log(1 + cv * cv), s = Math.sqrt(s2), m = Math.log(mean) - s2 / 2;
    return 1 - normCdf((Math.log(threshold) - m) / s);
  }
  var PTS_BUCKETS = [['pts_allow_0', -1e9, 0.5], ['pts_allow_1_6', 0.5, 6.5], ['pts_allow_7_13', 6.5, 13.5], ['pts_allow_14_20', 13.5, 20.5], ['pts_allow_21_27', 20.5, 27.5], ['pts_allow_28_34', 27.5, 34.5], ['pts_allow_35p', 34.5, 1e9]];
  var YDS_BUCKETS = [['yds_allow_0_100', -1e9, 99.5], ['yds_allow_100_199', 99.5, 199.5], ['yds_allow_200_299', 199.5, 299.5], ['yds_allow_300_349', 299.5, 349.5], ['yds_allow_350_399', 349.5, 399.5], ['yds_allow_400_449', 399.5, 449.5], ['yds_allow_450_499', 449.5, 499.5], ['yds_allow_500_549', 499.5, 549.5], ['yds_allow_550p', 549.5, 1e9]];
  // threshold bonuses: [scoring key, stat (or sum of stats), threshold, spread]
  var BONUS = [
    ['bonus_pass_yd_300', ['pass_yd'], 300, 0.30], ['bonus_pass_yd_400', ['pass_yd'], 400, 0.30],
    ['bonus_rush_yd_100', ['rush_yd'], 100, 0.55], ['bonus_rush_yd_200', ['rush_yd'], 200, 0.55],
    ['bonus_rec_yd_100', ['rec_yd'], 100, 0.62], ['bonus_rec_yd_200', ['rec_yd'], 200, 0.62],
    ['bonus_rush_rec_yd_100', ['rush_yd', 'rec_yd'], 100, 0.52], ['bonus_rush_rec_yd_200', ['rush_yd', 'rec_yd'], 200, 0.52],
    ['bonus_pass_cmp_25', ['pass_cmp'], 25, 0.24], ['bonus_rush_att_20', ['rush_att'], 20, 0.35],
    ['bonus_tkl_10p', ['idp_tkl'], 10, 0.45], ['bonus_sack_2p', ['idp_sack'], 2, 1.3]
  ];
  // share of touchdowns that are long ones, league-wide
  var LONG_TD = [['pass_td_40p', 'pass_td', 0.13], ['pass_td_50p', 'pass_td', 0.08], ['rush_td_40p', 'rush_td', 0.05], ['rush_td_50p', 'rush_td', 0.035], ['rec_td_40p', 'rec_td', 0.13], ['rec_td_50p', 'rec_td', 0.08]];

  // Expected points for a projected stat line. The plain sum of stat x value, plus the expected value
  // of the things a projection can't hold as a single number: defense points/yards-allowed tiers,
  // yardage bonuses, long-touchdown bonuses, and kick-distance splits the feed leaves out.
  function projectPoints(stats, scoring, positions) {
    var t = 0, k, i, has = function (key) { return stats[key] != null; };
    for (k in stats) {
      var w = scoring[k];
      if (!w) continue;
      if (k.charCodeAt(0) === 112 /* p */ && k.lastIndexOf('pts_allow_', 0) === 0) continue;   // tiers handled below
      if (k.charCodeAt(0) === 121 /* y */ && k.lastIndexOf('yds_allow_', 0) === 0) continue;
      t += w * stats[k];
    }
    if (has('pts_allow')) {
      var mu = stats.pts_allow, sd = 9.5;
      for (i = 0; i < PTS_BUCKETS.length; i++) { var b = PTS_BUCKETS[i], wv = scoring[b[0]]; if (wv) t += wv * (normCdf((b[2] - mu) / sd) - normCdf((b[1] - mu) / sd)); }
    }
    if (has('yds_allow')) {
      var my = stats.yds_allow, sy = 78;
      for (i = 0; i < YDS_BUCKETS.length; i++) { var by = YDS_BUCKETS[i], wy = scoring[by[0]]; if (wy) t += wy * (normCdf((by[2] - my) / sy) - normCdf((by[1] - my) / sy)); }
    }
    for (i = 0; i < BONUS.length; i++) {
      var bn = BONUS[i], wb = scoring[bn[0]];
      if (!wb || has(bn[0])) continue;
      var m = 0; for (var j = 0; j < bn[1].length; j++) m += stats[bn[1][j]] || 0;
      if (m > 0) t += wb * tailProb(m, bn[3], bn[2]);
    }
    for (i = 0; i < LONG_TD.length; i++) {
      var lt = LONG_TD[i], wl = scoring[lt[0]];
      if (wl && !has(lt[0]) && stats[lt[1]]) t += wl * lt[2] * stats[lt[1]];
    }
    // kicks
    if (has('fgm')) {
      if (scoring.fgm_50_59 && !has('fgm_50_59') && stats.fgm_50p) t += scoring.fgm_50_59 * 0.93 * stats.fgm_50p;
      if (scoring.fgm_60p && !has('fgm_60p') && stats.fgm_50p) t += scoring.fgm_60p * 0.07 * stats.fgm_50p;
      if (scoring.fgmiss && !has('fgmiss') && has('fga')) t += scoring.fgmiss * Math.max(0, stats.fga - stats.fgm);
      if (scoring.fgm_yds_over_30 && !has('fgm_yds_over_30') && has('fgm_yds')) t += scoring.fgm_yds_over_30 * Math.max(0, stats.fgm_yds - 30 * stats.fgm);
    }
    // first-down bonuses by position
    if (positions) {
      var fd = (stats.rush_fd || 0) + (stats.rec_fd || 0);
      for (i = 0; i < positions.length; i++) {
        var key = 'bonus_fd_' + String(positions[i]).toLowerCase();
        if (scoring[key] && !has(key) && fd) { t += scoring[key] * fd; break; }
      }
    }
    return t;
  }

  /* ---------- lineups ---------- */
  var SLOT_ELIG = {
    QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'], DL: ['DL'], LB: ['LB'], DB: ['DB'],
    FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
    IDP_FLEX: ['DL', 'LB', 'DB'], WRRBTE_FLEX: ['RB', 'WR', 'TE'], RBWR_FLEX: ['RB', 'WR'], WRTE_FLEX: ['WR', 'TE'], QBRBWRTE_FLEX: ['QB', 'RB', 'WR', 'TE'], OP: ['QB', 'RB', 'WR', 'TE'],
    DE: ['DE', 'DL'], DT: ['DT', 'DL'], CB: ['CB', 'DB'], S: ['S', 'DB'], P: ['P']
  };
  var BENCH = { BN: 1, IR: 1, TAXI: 1, RES: 1 };
  function starterSlots(rosterPositions) { return (rosterPositions || []).filter(function (p) { return !BENCH[p]; }); }
  function slotAccepts(slot, positions) {
    var el = SLOT_ELIG[slot] || [slot];
    for (var i = 0; i < positions.length; i++) if (el.indexOf(positions[i]) >= 0) return true;
    return false;
  }
  // Best assignment of players to slots (Hungarian method). value[i][j] = points if slot i takes player j,
  // or null when that player can't fill that slot. A slot may stay empty (worth 0).
  function assign(value, nSlots, nPlayers) {
    var n = nSlots, m = nPlayers + nSlots, INF = 1e15, i, j;
    var u = new Float64Array(n + 1), v = new Float64Array(m + 1), p = new Int32Array(m + 1), way = new Int32Array(m + 1);
    var minv = new Float64Array(m + 1), used = new Uint8Array(m + 1);
    function cost(r, c) {            // r, c are 1-based; columns past nPlayers are "leave empty"
      if (c > nPlayers) return 0;
      var x = value[r - 1][c - 1];
      return x == null ? INF : -x;
    }
    for (i = 1; i <= n; i++) {
      p[0] = i; var j0 = 0;
      for (j = 0; j <= m; j++) { minv[j] = INF * 10; used[j] = 0; }
      do {
        used[j0] = 1; var i0 = p[j0], delta = INF * 10, j1 = 0;
        for (j = 1; j <= m; j++) if (!used[j]) {
          var cur = cost(i0, j) - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (p[j0] !== 0);
      do { var j2 = way[j0]; p[j0] = p[j2]; j0 = j2; } while (j0);
    }
    var pick = new Int32Array(n).fill(-1);
    for (j = 1; j <= nPlayers; j++) if (p[j] > 0 && value[p[j] - 1][j - 1] != null) pick[p[j] - 1] = j - 1;
    return pick;
  }
  // slots: ['QB','RB',...]; players: [{id, pos:['RB'], pts}]. Returns the best lineup and its total.
  function bestLineup(slots, players) {
    // only players who could matter: the top few at each slot type keep the problem small
    var cand = players.filter(function (pl) { return pl.pts > 0; });
    var value = [], i, j;
    for (i = 0; i < slots.length; i++) {
      var row = new Array(cand.length);
      for (j = 0; j < cand.length; j++) row[j] = slotAccepts(slots[i], cand[j].pos) ? cand[j].pts : null;
      value.push(row);
    }
    var pick = assign(value, slots.length, cand.length), total = 0, out = [];
    for (i = 0; i < slots.length; i++) {
      var pl = pick[i] >= 0 ? cand[pick[i]] : null;
      out.push({ slot: slots[i], id: pl ? pl.id : null, pts: pl ? pl.pts : 0 });
      if (pl) total += pl.pts;
    }
    return { total: total, starters: out };
  }

  /* ---------- standings ---------- */
  // Order teams best first: win rate, then points for, then points against (Sleeper's rule).
  // t = { wins, losses, ties, pf, pa } arrays. Returns team indexes.
  function winRate(w, l, t) { var g = w + l + t; return g > 0 ? (w + 0.5 * t) / g : 0; }
  function standingsOrder(t) {
    var n = t.wins.length, order = [], i, rate = new Array(n);
    for (i = 0; i < n; i++) { order.push(i); rate[i] = winRate(t.wins[i], t.losses[i], t.ties[i]); }
    order.sort(function (x, y) {
      if (Math.abs(rate[x] - rate[y]) > 1e-12) return rate[y] - rate[x];
      if (t.pf[x] !== t.pf[y]) return t.pf[y] - t.pf[x];
      if (t.pa[x] !== t.pa[y]) return t.pa[y] - t.pa[x];
      return x - y;
    });
    return order;
  }
  // Playoff seeds: with divisions, each division's best team is seeded first (best record among them on top),
  // then everyone else in standings order. div[i] = division number or null.
  function seedOrder(t, div, nDiv) {
    var order = standingsOrder(t);
    if (!div || !(nDiv > 1)) return order;
    var seen = {}, winners = [], rest = [];
    for (var i = 0; i < order.length; i++) {
      var d = div[order[i]];
      if (d != null && !seen[d]) { seen[d] = 1; winners.push(order[i]); } else rest.push(order[i]);
    }
    return winners.concat(rest);
  }

  /* ---------- playoff brackets ---------- */
  // A bracket is a list of games. Each side is a seed ({s: 0} is the top seed), the winner of an earlier
  // game ({w: id}) or its loser ({l: id}). p marks the game that decides a final place (1 = title game).
  // These are the shapes Sleeper uses for each playoff size.
  function standardBracket(P) {
    var S = function (k) { return { s: k - 1 }; }, W = function (m) { return { w: m }; }, L = function (m) { return { l: m }; };
    if (P === 2) return [{ m: 1, r: 1, a: S(1), b: S(2), p: 1 }];
    if (P === 3) return [{ m: 1, r: 1, a: S(2), b: S(3) }, { m: 2, r: 2, a: S(1), b: W(1), p: 1 }];
    if (P === 4) return [{ m: 1, r: 1, a: S(1), b: S(4) }, { m: 2, r: 1, a: S(2), b: S(3) }, { m: 3, r: 2, a: W(1), b: W(2), p: 1 }, { m: 4, r: 2, a: L(1), b: L(2), p: 3 }];
    if (P === 5) return [{ m: 1, r: 1, a: S(4), b: S(5) }, { m: 2, r: 2, a: S(1), b: W(1) }, { m: 3, r: 2, a: S(2), b: S(3) }, { m: 4, r: 3, a: W(2), b: W(3), p: 1 }, { m: 5, r: 3, a: L(2), b: L(3), p: 3 }];
    if (P === 6) return [{ m: 1, r: 1, a: S(4), b: S(5) }, { m: 2, r: 1, a: S(3), b: S(6) }, { m: 3, r: 2, a: S(1), b: W(1) }, { m: 4, r: 2, a: S(2), b: W(2) }, { m: 5, r: 2, a: L(1), b: L(2), p: 5 },
      { m: 6, r: 3, a: W(3), b: W(4), p: 1 }, { m: 7, r: 3, a: L(3), b: L(4), p: 3 }];
    if (P === 7) return [{ m: 1, r: 1, a: S(4), b: S(5) }, { m: 2, r: 1, a: S(2), b: S(7) }, { m: 3, r: 1, a: S(3), b: S(6) }, { m: 4, r: 2, a: S(1), b: W(1) }, { m: 5, r: 2, a: W(2), b: W(3) },
      { m: 6, r: 2, a: L(2), b: L(3) }, { m: 7, r: 3, a: W(4), b: W(5), p: 1 }, { m: 8, r: 3, a: L(4), b: L(5), p: 3 }, { m: 9, r: 3, a: L(1), b: W(6), p: 5 }];
    if (P === 8) return [{ m: 1, r: 1, a: S(1), b: S(8) }, { m: 2, r: 1, a: S(4), b: S(5) }, { m: 3, r: 1, a: S(2), b: S(7) }, { m: 4, r: 1, a: S(3), b: S(6) },
      { m: 5, r: 2, a: W(1), b: W(2) }, { m: 6, r: 2, a: W(3), b: W(4) }, { m: 7, r: 2, a: L(1), b: L(2) }, { m: 8, r: 2, a: L(3), b: L(4) },
      { m: 9, r: 3, a: W(5), b: W(6), p: 1 }, { m: 10, r: 3, a: L(5), b: L(6), p: 3 }, { m: 11, r: 3, a: W(7), b: W(8), p: 5 }, { m: 12, r: 3, a: L(7), b: L(8), p: 7 }];
    // any other size: a plain single-elimination tree with byes for the top seeds
    return treeBracket(P);
  }
  function treeBracket(P) {
    var size = 1; while (size < P) size *= 2;
    var order = [1]; while (order.length < size) { var nx = [], len = order.length * 2 + 1; for (var i = 0; i < order.length; i++) { nx.push(order[i]); nx.push(len - order[i]); } order = nx; }
    var games = [], id = 0, cur = order.map(function (s) { return s <= P ? { s: s - 1 } : null; }), r = 1;
    while (cur.length > 1) {
      var nextRound = [];
      for (var k = 0; k < cur.length; k += 2) {
        var a = cur[k], b = cur[k + 1];
        if (a && b) { id++; games.push({ m: id, r: r, a: a, b: b }); nextRound.push({ w: id }); }
        else nextRound.push(a || b);
      }
      cur = nextRound; r++;
    }
    if (games.length) games[games.length - 1].p = 1;
    // byes shouldn't leave a round empty: renumber rounds so the first real game is round 1
    return games;
  }
  // Read the shape out of a Sleeper bracket. seedOf maps roster id -> seed index (0 = top seed).
  // Returns null when a listed team isn't one of the seeds we expect.
  function bracketFromSleeper(rows, seedOf) {
    if (!rows || !rows.length) return null;
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var x = rows[i], g = { m: x.m, r: x.r };
      var sides = [['t1', 'a'], ['t2', 'b']];
      for (var k = 0; k < 2; k++) {
        var from = x[sides[k][0] + '_from'], t = x[sides[k][0]];
        if (from && from.w != null) g[sides[k][1]] = { w: from.w };
        else if (from && from.l != null) g[sides[k][1]] = { l: from.l };
        else if (t != null && typeof t !== 'object') { if (seedOf[t] == null) return null; g[sides[k][1]] = { s: seedOf[t] }; }
        else return null;
      }
      if (x.p != null) g.p = x.p;
      out.push(g);
    }
    out.sort(function (a, b) { return a.r - b.r || a.m - b.m; });
    return out;
  }
  // canonical text form, for comparing two bracket shapes
  function bracketKey(games) {
    var ref = function (x) { return x.s != null ? 's' + (x.s + 1) : x.w != null ? 'w' + x.w : 'l' + x.l; };
    return games.map(function (g) { var a = ref(g.a), b = ref(g.b); if (a > b) { var t = a; a = b; b = t; } return 'r' + g.r + 'm' + g.m + ':' + a + '-' + b + (g.p ? 'p' + g.p : ''); }).join(' ');
  }
  // Weeks of each playoff round. roundType: 0 = one week each, 1 = two-week title game, 2 = two weeks each.
  function roundWeeks(startWeek, nRounds, roundType, lastWeek) {
    var out = [], w = startWeek;
    for (var r = 1; r <= nRounds; r++) {
      var len = roundType === 2 || (roundType === 1 && r === nRounds) ? 2 : 1, wk = [];
      for (var k = 0; k < len; k++) if (!lastWeek || w <= lastWeek) wk.push(w++); else w++;
      out.push(wk);
    }
    return out;
  }

  return {
    sfc32: sfc32, makeNormal: makeNormal, normCdf: normCdf, normInv: normInv,
    scoreStats: scoreStats, projectPoints: projectPoints, tailProb: tailProb,
    SLOT_ELIG: SLOT_ELIG, starterSlots: starterSlots, slotAccepts: slotAccepts, assign: assign, bestLineup: bestLineup,
    winRate: winRate, standingsOrder: standingsOrder, seedOrder: seedOrder,
    standardBracket: standardBracket, treeBracket: treeBracket, bracketFromSleeper: bracketFromSleeper, bracketKey: bracketKey, roundWeeks: roundWeeks
  };
});
