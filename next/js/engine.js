/* League Odds - season simulator for any head-to-head league. No DOM, no network.
 *
 * Model, in one paragraph:
 *   score(team, week) = league average + rel(team, week) + skillError(team) + weekNoise
 *   weekNoise  ~ Normal(0, sigma^2)   independent for every team-week
 *   skillError ~ Normal(0, v)         drawn once per simulated season, so a team that is
 *                                     better than we think is better in every remaining week
 * Handles: any number of teams, median games (a second result each week against the league median),
 * divisions, any bracket shape, re-seeding, two-week rounds, playoff games already played,
 * and several rules for next year's draft order.
 * Forced game outcomes are sampled exactly (truncated normals + importance weights),
 * never by nudging probabilities.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.LOEngine = factory(root.LOCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  var normCdf = C.normCdf, normInv = C.normInv;

  // Which bracket games lead to the title, and how many rounds there are.
  function bracketInfo(bracket) {
    var byId = {}, i, R = 0, finalGame = null;
    for (i = 0; i < bracket.length; i++) { byId[bracket[i].m] = bracket[i]; if (bracket[i].r > R) R = bracket[i].r; if (bracket[i].p === 1) finalGame = bracket[i]; }
    if (!finalGame) { for (i = 0; i < bracket.length; i++) if (bracket[i].r === R && !finalGame) finalGame = bracket[i]; }
    var title = {};
    (function walk(g) { if (!g || title[g.m]) return; title[g.m] = 1; if (g.a.w != null) walk(byId[g.a.w]); if (g.b.w != null) walk(byId[g.b.w]); })(finalGame);
    var byes = {}, firstRound = {};
    for (i = 0; i < bracket.length; i++) {
      var g = bracket[i]; if (!title[g.m]) continue;
      [g.a, g.b].forEach(function (x) { if (x.s != null) { if (firstRound[x.s] == null || g.r < firstRound[x.s]) firstRound[x.s] = g.r; } });
    }
    for (var s in firstRound) if (firstRound[s] > 1) byes[s] = 1;
    return { byId: byId, rounds: R, finalId: finalGame ? finalGame.m : null, title: title, byeSeeds: Object.keys(byes).map(Number), firstRound: firstRound };
  }

  /* cfg = {
   *   n, wins[], losses[], ties[], pf[], pa[]        current regular-season totals
   *   div[] (division number per team, or null), nDiv
   *   games: [{week, a, b}]                           remaining regular-season games (team indexes)
   *   median: true when each team also plays the league median every week
   *   rel: {week: [n]}, base, sigma, v[]              the strength model
   *   playoff: { teams, bracket, rounds: [[weeks]...], reseed,
   *              fixed: { seeds: [team by seed], teams: {m: [a, b]}, done: {m: [winner, loser]}, partial: {m: {a, b, weeks}} } }
   *   draft: { nonPlayoff: 'record' | 'maxpf' | 'pf', playoff: 'seed' | 'place' | 'bracket' | 'record', pp[], ppRatio[] } or null
   *   levGames: indexes of games to track swings for (default: all when small, else the first open week)
   *   live: { week, banked[], share[] }   a week under way: points already scored, and the share of each team's
   *                                        expected week still to come (0 = all its players are done)
   * }
   * picks: array aligned with cfg.games: 0 = open, 1 = team a wins, 2 = team b wins.
   */
  function simulate(cfg, picks, nSims, seed) {
    var n = cfg.n, G = cfg.games.length, po = cfg.playoff, P = Math.min(po.teams, n), bracket = po.bracket, info = bracketInfo(bracket), R = info.rounds;
    var rng = C.sfc32(seed == null ? 20261124 : seed), norm = C.makeNormal(rng);
    var sigma = cfg.sigma, sD = sigma * Math.SQRT2, base = cfg.base, i, g, r, k;
    var sdV = new Float64Array(n); for (i = 0; i < n; i++) sdV[i] = Math.sqrt(cfg.v[i] || 0);
    var div = cfg.div, nDiv = cfg.nDiv > 1 && div ? cfg.nDiv : 0, median = !!cfg.median, fixed = po.fixed || null;
    var live = cfg.live || null, liveWeek = live ? live.week : -1;
    picks = picks || [];

    // weeks of the regular season still to play, in order
    var weekList = [], weekGames = {}, weekTeams = {};
    for (g = 0; g < G; g++) { var wk = cfg.games[g].week; if (!weekGames[wk]) { weekGames[wk] = []; weekTeams[wk] = []; weekList.push(wk); } weekGames[wk].push(g); weekTeams[wk].push(cfg.games[g].a, cfg.games[g].b); }
    weekList.sort(function (x, y) { return x - y; });
    var left = new Int32Array(n), leftAll = new Int32Array(n);
    for (g = 0; g < G; g++) { left[cfg.games[g].a]++; left[cfg.games[g].b]++; }
    for (i = 0; i < n; i++) leftAll[i] = left[i] * (median ? 2 : 1);
    var maxLeft = 0, maxWins = 0, gTot = new Float64Array(n), sameGames = true;
    for (i = 0; i < n; i++) {
      if (left[i] > maxLeft) maxLeft = left[i];
      gTot[i] = cfg.wins[i] + cfg.losses[i] + cfg.ties[i] + leftAll[i];
      maxWins = Math.max(maxWins, cfg.wins[i] + cfg.ties[i] + leftAll[i]);
      if (gTot[i] !== gTot[0]) sameGames = false;
    }
    var lev = cfg.levGames;
    if (!lev) { lev = []; if (G * n <= 2400) for (g = 0; g < G; g++) lev.push(g); else if (weekList.length) lev = weekGames[weekList[0]].slice(); }
    var LG = lev.length, levPos = new Int32Array(G).fill(-1); for (k = 0; k < LG; k++) levPos[lev[k]] = k;

    var draft = cfg.draft || null, topN = Math.min(3, n);
    function arr(len) { return new Float64Array(len); }
    function arrs(count, len) { var o = []; for (var q = 0; q < count; q++) o.push(new Float64Array(len)); return o; }
    var out = {
      nSims: nSims, wsum: 0, w2sum: 0, rounds: R, playoffTeams: P, byeSeeds: info.byeSeeds,
      playoff: arr(n), bye: arr(n), reach: arrs(R + 1, n), fin: arr(n), champ: arr(n), divWin: arr(n),
      seedDist: arrs(n, n), winsDist: arrs(n, maxWins + 2), pfSum: arr(n), placeDist: arrs(n, P + 1),
      gameA: arr(G), gameW: arr(G), levGames: lev,
      levWA: arr(LG), levWB: arr(LG), levPA: arrs(LG, n), levPB: arrs(LG, n), levBA: arrs(LG, n), levBB: arrs(LG, n), levCA: arrs(LG, n), levCB: arrs(LG, n),
      levSA: arrs(LG, n), levSB: arrs(LG, n), levTA: arrs(LG, n), levTB: arrs(LG, n),
      ownW: arrs(n, maxLeft + 1), ownP: arrs(n, maxLeft + 1), ownC: arrs(n, maxLeft + 1), ownS: arrs(n, maxLeft + 1), ownT: arrs(n, maxLeft + 1),
      slotDist: draft ? arrs(n, n) : null, slotSum: arr(n)
    };
    var e = arr(n), wins = arr(n), pf = arr(n), pa = arr(n), pp = arr(n), key = arr(n), sc = arr(n);
    var order = new Int32Array(n), tmp = new Int32Array(n), aWon = new Uint8Array(G), own = new Int32Array(n);
    var seedOf = new Int32Array(n), slot = new Int32Array(n), isDivW = new Uint8Array(n), divBest = new Int32Array(Math.max(1, nDiv + 2));
    var maxM = 0; for (i = 0; i < bracket.length; i++) if (bracket[i].m > maxM) maxM = bracket[i].m;
    var winner = new Int32Array(maxM + 1), loser = new Int32Array(maxM + 1), elim = new Int32Array(n), place = new Int32Array(n), lostIn = new Int32Array(n), alive = new Uint8Array(n);
    var sorted = bracket.slice().sort(function (x, y) { return x.r - y.r || x.m - y.m; });
    var roundWeeks = po.rounds || [], byeSeeds = info.byeSeeds;
    var ppRatio = draft && draft.ppRatio ? draft.ppRatio : null, needPP = draft && draft.nonPlayoff === 'maxpf';

    function ref(x) { return x.s != null ? order[x.s] : x.w != null ? winner[x.w] : loser[x.l]; }
    function roundScore(t, weeks) {
      var tot = 0;
      for (var q = 0; q < weeks.length; q++) {
        var rl = cfg.rel[weeks[q]], full = base + (rl ? rl[t] : 0) + e[t];
        if (weeks[q] === liveWeek) { var sh = live.share[t]; tot += live.banked[t] + sh * full + (sh > 0 ? Math.sqrt(sh) * sigma * norm() : 0); }
        else tot += full + sigma * norm();
      }
      return tot;
    }
    function sortByKey() {             // insertion sort, best first
      for (var a = 0; a < n; a++) order[a] = a;
      for (a = 1; a < n; a++) { var oa = order[a], kk = key[oa], j = a - 1; while (j >= 0 && key[order[j]] < kk) { order[j + 1] = order[j]; j--; } order[j + 1] = oa; }
    }

    for (var s = 0; s < nSims; s++) {
      var w = 1;
      for (i = 0; i < n; i++) { e[i] = sdV[i] * norm(); wins[i] = cfg.wins[i] + 0.5 * cfg.ties[i]; pf[i] = cfg.pf[i]; pa[i] = cfg.pa[i]; own[i] = 0; if (needPP) pp[i] = draft.pp ? draft.pp[i] : cfg.pf[i]; }

      /* ----- the rest of the regular season, week by week ----- */
      for (var wi = 0; wi < weekList.length; wi++) {
        var week = weekList[wi], gl = weekGames[week], rel = cfg.rel[week];
        for (k = 0; k < gl.length; k++) {
          g = gl[k];
          var gm = cfg.games[g], a = gm.a, b = gm.b;
          var muA = base + rel[a] + e[a], muB = base + rel[b] + e[b], sa, sb, pick = picks[g] | 0;
          if (week === liveWeek) {
            // part of this week is already on the board: bank it and play out only what is left
            var shA = live.share[a], shB = live.share[b], vA = sigma * sigma * shA, vB = sigma * sigma * shB, vD = vA + vB;
            muA = live.banked[a] + shA * muA; muB = live.banked[b] + shB * muB;
            if (pick === 0 || !(vD > 0)) {
              sa = muA + (shA > 0 ? Math.sqrt(vA) * norm() : 0); sb = muB + (shB > 0 ? Math.sqrt(vB) * norm() : 0);
              if (pick !== 0 && ((pick === 1) !== (sa > sb))) w = 0;           // a pick against a finished game can't happen
            } else {
              var sdD = Math.sqrt(vD), l0 = -(muA - muB) / sdD, zl, prl;
              if (pick === 1) { prl = normCdf(-l0); zl = -normInv(Math.max(rng() * prl, 1e-300)); } else { prl = normCdf(l0); zl = normInv(Math.max(rng() * prl, 1e-300)); }
              w *= prl;
              var dev = sdD * zl;                                               // how far the margin lands from its mean
              sa = muA + (vA / vD) * dev + Math.sqrt(vA * vB / vD) * norm(); sb = sa - (muA - muB + dev);
            }
          }
          else if (pick === 0) { sa = muA + sigma * norm(); sb = muB + sigma * norm(); }
          else {
            var a0 = -(muA - muB) / sD, z, pr;
            if (pick === 1) { pr = normCdf(-a0); z = -normInv(Math.max(rng() * pr, 1e-300)); }
            else { pr = normCdf(a0); z = normInv(Math.max(rng() * pr, 1e-300)); }
            w *= pr;
            var D = (muA - muB) + sD * z, T = muA + muB + sD * norm();
            sa = (T + D) / 2; sb = (T - D) / 2;
          }
          sc[a] = sa; sc[b] = sb;
          pf[a] += sa; pf[b] += sb; pa[a] += sb; pa[b] += sa;
          if (needPP) { pp[a] += sa * (ppRatio ? ppRatio[a] : 1); pp[b] += sb * (ppRatio ? ppRatio[b] : 1); }
          if (sa > sb) { wins[a] += 1; aWon[g] = 1; own[a]++; }
          else if (sb > sa) { wins[b] += 1; aWon[g] = 0; own[b]++; }
          else { wins[a] += 0.5; wins[b] += 0.5; aWon[g] = 2; }
        }
        if (median) {                    // top half of the week's scores also beat the median
          var wt = weekTeams[week], m = wt.length;
          for (k = 0; k < m; k++) tmp[k] = wt[k];
          for (k = 1; k < m; k++) { var tk = tmp[k], sk = sc[tk], j2 = k - 1; while (j2 >= 0 && sc[tmp[j2]] < sk) { tmp[j2 + 1] = tmp[j2]; j2--; } tmp[j2 + 1] = tk; }
          var half = m >> 1;
          for (k = 0; k < half; k++) wins[tmp[k]] += 1;
          if (m & 1) wins[tmp[half]] += 0.5;       // odd count: the middle team ties the median
        }
      }

      /* ----- seeding ----- */
      if (fixed && fixed.seeds) {
        for (i = 0; i < n; i++) seedOf[i] = n;
        for (i = 0; i < fixed.seeds.length; i++) { order[i] = fixed.seeds[i]; seedOf[fixed.seeds[i]] = i; }
        if (fixed.rest) for (i = 0; i < fixed.rest.length; i++) { order[fixed.seeds.length + i] = fixed.rest[i]; seedOf[fixed.rest[i]] = fixed.seeds.length + i; }
      } else {
        for (i = 0; i < n; i++) key[i] = (sameGames ? wins[i] : wins[i] / (gTot[i] || 1) * 64) * 1e7 + pf[i] + pa[i] * 1e-7;
        sortByKey();
        if (nDiv) {                      // division winners take the top seeds, in standings order
          for (i = 0; i <= nDiv + 1; i++) divBest[i] = -1;
          var nw = 0, nr = 0;
          for (i = 0; i < n; i++) { var t0 = order[i], d0 = div[t0]; if (d0 != null && d0 >= 0 && d0 <= nDiv && divBest[d0] < 0) { divBest[d0] = t0; isDivW[t0] = 1; } else isDivW[t0] = 0; }
          for (i = 0; i < n; i++) if (isDivW[order[i]]) tmp[nw++] = order[i];
          for (i = 0; i < n; i++) if (!isDivW[order[i]]) tmp[nw + nr++] = order[i];
          for (i = 0; i < n; i++) order[i] = tmp[i];
        }
        for (i = 0; i < n; i++) seedOf[order[i]] = i;
      }

      /* ----- playoffs ----- */
      for (i = 0; i < n; i++) { elim[i] = 0; place[i] = 0; lostIn[i] = 0; alive[i] = seedOf[i] < P ? 1 : 0; }
      var champ = -1, runner = -1;
      for (r = 1; r <= R; r++) {
        var weeks = roundWeeks[r - 1] || [];
        var pairs = null;
        if (po.reseed && r > 1) {       // best seed left plays the worst seed left
          var cnt = 0;
          for (k = 0; k < sorted.length; k++) { var gq = sorted[k]; if (gq.r !== r || !info.title[gq.m]) continue; tmp[cnt++] = ref(gq.a); tmp[cnt++] = ref(gq.b); }
          for (k = 1; k < cnt; k++) { var tq = tmp[k], sq = seedOf[tq], j3 = k - 1; while (j3 >= 0 && seedOf[tmp[j3]] > sq) { tmp[j3 + 1] = tmp[j3]; j3--; } tmp[j3 + 1] = tq; }
          pairs = []; for (k = 0; k < cnt / 2; k++) pairs.push([tmp[k], tmp[cnt - 1 - k]]);
        }
        var pi = 0;
        for (k = 0; k < sorted.length; k++) {
          var gb = sorted[k]; if (gb.r !== r) continue;
          var x, y, isTitle = !!info.title[gb.m], kn = fixed && fixed.teams && fixed.teams[gb.m];
          if (kn) { x = kn[0]; y = kn[1]; if (pairs && isTitle) pi++; }
          else if (pairs && isTitle) { x = pairs[pi][0]; y = pairs[pi][1]; pi++; }
          else { x = ref(gb.a); y = ref(gb.b); }
          var wn, ls, dn = fixed && fixed.done && fixed.done[gb.m];
          if (dn) { wn = dn[0]; ls = dn[1]; }
          else {
            var part = fixed && fixed.partial && fixed.partial[gb.m];
            var sx = part ? part.a + roundScore(x, part.weeks) : roundScore(x, weeks), sy = part ? part.b + roundScore(y, part.weeks) : roundScore(y, weeks);
            if (sx === sy) wn = seedOf[x] < seedOf[y] ? x : y; else wn = sx > sy ? x : y;
            ls = wn === x ? y : x;
          }
          winner[gb.m] = wn; loser[gb.m] = ls;
          if (isTitle) { elim[ls] = r; lostIn[ls] = gb.m; alive[ls] = 0; if (gb.m === info.finalId) { champ = wn; runner = ls; } }
          if (gb.p) { place[wn] = gb.p; place[ls] = gb.p + 1; }
        }
      }
      if (champ >= 0) elim[champ] = R + 1;

      /* ----- next year's draft order ----- */
      if (draft) draftSlots(draft, n, P, R, order, seedOf, elim, place, lostIn, pp, pf, slot, tmp, key);

      /* ----- tally ----- */
      out.wsum += w; out.w2sum += w * w;
      for (i = 0; i < n; i++) {
        var sd = seedOf[i];
        out.seedDist[i][sd] += w;
        out.winsDist[i][Math.floor(wins[i])] += w;
        out.pfSum[i] += w * pf[i];
        out.ownW[i][own[i]] += w;
        if (sd < P) {
          out.playoff[i] += w; out.ownP[i][own[i]] += w;
          var last = Math.max(1, Math.min(elim[i], R));               // still in the title hunt when round r starts
          for (r = 1; r <= last; r++) out.reach[r][i] += w;
          if (info.firstRound[sd] > 1) out.bye[i] += w;
          if (place[i]) out.placeDist[i][place[i]] += w;
        }
        if (nDiv && isDivW[i] && !(fixed && fixed.seeds)) out.divWin[i] += w;
        if (draft) { out.slotDist[i][slot[i] - 1] += w; out.slotSum[i] += w * slot[i]; out.ownS[i][own[i]] += w * slot[i]; if (slot[i] <= topN) out.ownT[i][own[i]] += w; }
      }
      if (champ >= 0) { out.champ[champ] += w; out.ownC[champ][own[champ]] += w; out.fin[champ] += w; out.fin[runner] += w; }
      for (g = 0; g < G; g++) {
        var aw = aWon[g];
        if (aw === 1) out.gameA[g] += w;
        out.gameW[g] += w;
        var lp = levPos[g];
        if (lp < 0 || aw === 2) continue;
        var LP = aw === 1 ? out.levPA[lp] : out.levPB[lp], LB = aw === 1 ? out.levBA[lp] : out.levBB[lp], LC = aw === 1 ? out.levCA[lp] : out.levCB[lp];
        if (aw === 1) out.levWA[lp] += w; else out.levWB[lp] += w;
        for (i = 0; i < P; i++) LP[order[i]] += w;
        for (i = 0; i < byeSeeds.length; i++) LB[order[byeSeeds[i]]] += w;
        if (champ >= 0) LC[champ] += w;
        if (draft) { var LS = aw === 1 ? out.levSA[lp] : out.levSB[lp], LT = aw === 1 ? out.levTA[lp] : out.levTB[lp]; for (i = 0; i < n; i++) { LS[i] += w * slot[i]; if (slot[i] <= topN) LT[i] += w; } }
      }
    }
    out.ess = out.wsum * out.wsum / out.w2sum;   // effective sample size after importance weighting
    return out;
  }

  /* Next year's draft slots (1 = first pick) from one finished season.
   * Teams that miss the playoffs pick first: by reverse standings ('record'), fewest potential points ('maxpf')
   * or fewest points ('pf'). Playoff teams follow, earliest exit first. Among teams out in the same round:
   *   'seed'    the lower seed picks first
   *   'place'   the loser of the placement game picks first (falls back to seed)
   *   'bracket' the team from the later bracket game picks first
   * byRound (optional) picks one of those three separately for each round of elimination.
   * 'record' ignores the bracket: every team in reverse standings order. */
  function draftSlots(rule, n, P, R, order, seedOf, elim, place, lostIn, pp, pf, slot, tmp, key) {
    var i, k, np = n - P;
    if (rule.playoff === 'record' && rule.nonPlayoff === 'record') { for (i = 0; i < n; i++) slot[order[i]] = n - i; return slot; }
    // non-playoff teams
    if (rule.nonPlayoff === 'maxpf' || rule.nonPlayoff === 'pf') {
      var src = rule.nonPlayoff === 'maxpf' ? pp : pf;
      for (i = 0; i < np; i++) tmp[i] = order[P + i];
      for (i = 1; i < np; i++) { var t = tmp[i], v = src[t], j = i - 1; while (j >= 0 && src[tmp[j]] > v) { tmp[j + 1] = tmp[j]; j--; } tmp[j + 1] = t; }
      for (i = 0; i < np; i++) slot[tmp[i]] = i + 1;
    } else for (i = P; i < n; i++) slot[order[i]] = n - i;
    // playoff teams: sort ascending by finish (worst finish picks first)
    if (rule.playoff === 'record') { for (i = 0; i < P; i++) slot[order[i]] = n - i; return slot; }
    for (i = 0; i < P; i++) {
      var tm = order[i], e = elim[tm] || 1, tie, how = rule.byRound && rule.byRound[e] ? rule.byRound[e] : rule.playoff;
      if (how === 'place') tie = place[tm] ? (2 * P - place[tm]) / (2 * P + 1) : (P - 1 - seedOf[tm]) / (4 * P + 2);   // better place = later pick
      else if (how === 'bracket') tie = lostIn[tm] ? 1 - lostIn[tm] / 1000 : 0.999;                            // earlier game = later pick
      else tie = (P - 1 - seedOf[tm]) / (P + 1);                                                                          // better seed = later pick
      key[tm] = e + tie * 0.9; tmp[i] = tm;
    }
    for (i = 1; i < P; i++) { var t2 = tmp[i], k2 = key[t2], j2 = i - 1; while (j2 >= 0 && key[tmp[j2]] > k2) { tmp[j2 + 1] = tmp[j2]; j2--; } tmp[j2 + 1] = t2; }
    for (k = 0; k < P; k++) slot[tmp[k]] = np + k + 1;
    return slot;
  }

  /* ---------- sure things: clinched and eliminated ---------- */
  // A team has clinched a top-K place when no way of finishing the schedule leaves K teams able to match or
  // beat its record (so no points tiebreak is needed). It is eliminated when every finish leaves K teams
  // strictly ahead. Division winners are counted as ahead of everyone who isn't one.
  // Every win-loss combination is checked when there are few enough games left; otherwise only the
  // best-case / worst-case records are compared, which can miss a sure thing but never invents one.
  function clinch(cfg, picks, K, opts) {
    var n = cfg.n, G = cfg.games.length, open = [], i, g, t, div = cfg.div, nDiv = cfg.nDiv > 1 && div ? cfg.nDiv : 0;
    var maxOpen = opts && opts.maxOpen != null ? opts.maxOpen : 18;
    var baseW = new Float64Array(n), games = new Float64Array(n), left = new Int32Array(n);
    for (i = 0; i < n; i++) { baseW[i] = cfg.wins[i] + 0.5 * cfg.ties[i]; games[i] = cfg.wins[i] + cfg.losses[i] + cfg.ties[i]; }
    picks = picks || [];
    for (g = 0; g < G; g++) {
      var gm = cfg.games[g]; games[gm.a] += cfg.median ? 2 : 1; games[gm.b] += cfg.median ? 2 : 1;
      if ((picks[g] | 0) === 1) baseW[gm.a] += 1; else if ((picks[g] | 0) === 2) baseW[gm.b] += 1; else { open.push(g); left[gm.a]++; left[gm.b]++; }
    }
    var no = function () { return new Array(n).fill(false); };
    if (nDiv && K < nDiv) return { clinched: no(), eliminated: no(), exact: false, method: 'none' };
    var rate = new Float64Array(n), divOf = function (x) { return nDiv ? div[x] : -1; };
    function judge(lo, hi, clinched, eliminated) {      // lo/hi: each team's worst and best possible rate in this scenario
      for (var x = 0; x < n; x++) {
        if (clinched[x]) {
          var ahead = 0, seen = {};
          for (t = 0; t < n; t++) if (t !== x && hi[t] >= lo[x] - 1e-12) { ahead++; if (nDiv) seen[div[t]] = 1; }
          if (nDiv) for (var d = 1; d <= nDiv; d++) if (d !== divOf(x) && !seen[d]) ahead++;
          var outright = false;
          if (nDiv) { outright = true; for (t = 0; t < n; t++) if (t !== x && div[t] === div[x] && hi[t] >= lo[x] - 1e-12) { outright = false; break; } }
          if (ahead >= K && !outright) clinched[x] = false;
        }
        if (eliminated[x]) {
          var sure = 0, seen2 = {}, canWinDiv = !!nDiv;
          for (t = 0; t < n; t++) if (t !== x && lo[t] > hi[x] + 1e-12) { sure++; if (nDiv) { seen2[div[t]] = 1; if (div[t] === div[x]) canWinDiv = false; } }
          if (nDiv) for (var d2 = 1; d2 <= nDiv; d2++) if (d2 !== divOf(x) && !seen2[d2]) sure++;
          if (canWinDiv || sure < K) eliminated[x] = false;
        }
      }
    }
    var clinched = new Array(n).fill(true), eliminated = new Array(n).fill(true);
    if (!cfg.median && open.length <= maxOpen) {
      var combos = Math.pow(2, open.length), wv = new Float64Array(n);
      for (var m = 0; m < combos; m++) {
        for (i = 0; i < n; i++) wv[i] = baseW[i];
        for (var j = 0; j < open.length; j++) { var og = cfg.games[open[j]]; wv[(m >>> j) & 1 ? og.a : og.b] += 1; }
        for (i = 0; i < n; i++) rate[i] = games[i] ? wv[i] / games[i] : 0;
        judge(rate, rate, clinched, eliminated);
      }
      return { clinched: clinched, eliminated: eliminated, exact: true, method: 'all outcomes' };
    }
    var lo = new Float64Array(n), hi = new Float64Array(n), medLeft = new Int32Array(n);
    if (cfg.median) for (g = 0; g < G; g++) { medLeft[cfg.games[g].a]++; medLeft[cfg.games[g].b]++; }
    for (i = 0; i < n; i++) { lo[i] = games[i] ? baseW[i] / games[i] : 0; hi[i] = games[i] ? (baseW[i] + left[i] + medLeft[i]) / games[i] : 0; }
    judge(lo, hi, clinched, eliminated);
    return { clinched: clinched, eliminated: eliminated, exact: false, method: 'best and worst case' };
  }

  // chance team a beats team b in one game
  function winProb(relA, relB, sigma, vA, vB) { return normCdf((relA - relB) / Math.sqrt(2 * sigma * sigma + vA + vB)); }

  return { simulate: simulate, clinch: clinch, draftSlots: draftSlots, bracketInfo: bracketInfo, winProb: winProb };
});
