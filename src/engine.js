/* League playoff and draft simulator - core engine.
 * No DOM. Runs unchanged in Node (tests, backtests) and in the browser (the page).
 *
 * Model, in one paragraph:
 *   score(team, week) = league average + rel(team, week) + skillError(team) + weekNoise
 *   weekNoise  ~ Normal(0, sigma^2)   independent for every team-week
 *   skillError ~ Normal(0, v)         drawn once per simulated season, so a team that is
 *                                     better than we think is better in every remaining week
 *   Standings: wins, then points for, then points against (Sleeper's rule).
 *   Six-team bracket, top two seeds get byes, no reseeding, two-week final.
 *   Next year's draft order (checked against this league's last three drafts): picks 1-6 go to
 *   the non-playoff teams, worst regular-season finish first; 7-8 to the first-round losers,
 *   lower seed first; 9 to the semifinal loser from the 2-seed's half, 10 to the other;
 *   11 to the runner-up; 12 to the champion.
 * Forced game outcomes are sampled exactly (truncated normals + importance weights),
 * never by nudging probabilities.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CPEngine = factory();
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

  /* ---------- standings from results ---------- */
  // results: { "1": [[a,b,pa,pb],...], ... } with team ids; ids: array of team ids.
  function standings(results, ids, throughWeek) {
    var idx = {}, n = ids.length, i;
    for (i = 0; i < n; i++) idx[ids[i]] = i;
    var s = { wins: new Array(n).fill(0), losses: new Array(n).fill(0), ties: new Array(n).fill(0), pf: new Array(n).fill(0), pa: new Array(n).fill(0), games: new Array(n).fill(0) };
    for (var w = 1; w <= throughWeek; w++) {
      var g = results[w]; if (!g) continue;
      for (i = 0; i < g.length; i++) {
        var a = idx[g[i][0]], b = idx[g[i][1]], pa = g[i][2], pb = g[i][3];
        s.pf[a] += pa; s.pf[b] += pb; s.pa[a] += pb; s.pa[b] += pa; s.games[a]++; s.games[b]++;
        if (pa > pb) { s.wins[a]++; s.losses[b]++; }
        else if (pb > pa) { s.wins[b]++; s.losses[a]++; }
        else { s.ties[a]++; s.ties[b]++; }
      }
    }
    return s;
  }
  // Seeding order (best first): record, then points for, then points against.
  function seedOrder(wins, ties, pf, pa) {
    var n = wins.length, order = [];
    for (var i = 0; i < n; i++) order.push(i);
    order.sort(function (x, y) {
      var kx = wins[x] + 0.5 * ties[x], ky = wins[y] + 0.5 * ties[y];
      if (kx !== ky) return ky - kx;
      if (pf[x] !== pf[y]) return pf[y] - pf[x];
      return pa[y] - pa[x];
    });
    return order;
  }

  /* ---------- next year's draft slots from a finished season ---------- */
  // order: team indexes by final regular-season seed (best first); seedOf[team] = seed index.
  // l1/l2: losers of the 4v5 and 3v6 games; x1/x2: semifinal losers from the 1-seed and 2-seed halves.
  function draftSlots(order, seedOf, P, l1, l2, x1, x2, ru, ch, slot) {
    var n = order.length, b0 = n - P, i;
    slot = slot || new Int32Array(n);
    for (i = P; i < n; i++) slot[order[i]] = n - i;       // worst record picks first
    if (P === 6) {
      if (seedOf[l1] > seedOf[l2]) { slot[l1] = b0 + 1; slot[l2] = b0 + 2; } else { slot[l2] = b0 + 1; slot[l1] = b0 + 2; }
      slot[x2] = b0 + 3; slot[x1] = b0 + 4; slot[ru] = b0 + 5; slot[ch] = b0 + 6;
    } else {                                                // four-team bracket: semifinal losers, lower seed first
      if (seedOf[x1] > seedOf[x2]) { slot[x1] = b0 + 1; slot[x2] = b0 + 2; } else { slot[x2] = b0 + 1; slot[x1] = b0 + 2; }
      slot[ru] = b0 + 3; slot[ch] = b0 + 4;
    }
    return slot;
  }

  /* ---------- season-form strength with shrinkage ---------- */
  // Each team's average margin over the league-average score, shrunk toward zero by
  // k = tau^2 / (tau^2 + sigma^2 / n). Optional halfLife (weeks) down-weights older games.
  function seasonForm(results, ids, throughWeek, hyper, halfLife) {
    var idx = {}, n = ids.length, i;
    for (i = 0; i < n; i++) idx[ids[i]] = i;
    var sw = new Array(n).fill(0), swx = new Array(n).fill(0), sw2 = new Array(n).fill(0), cnt = new Array(n).fill(0);
    var tot = 0, totN = 0;
    for (var w = 1; w <= throughWeek; w++) {
      var g = results[w]; if (!g) continue;
      var sum = 0, m = 0;
      for (i = 0; i < g.length; i++) { sum += g[i][2] + g[i][3]; m += 2; }
      var mean = sum / m; tot += sum; totN += m;
      var wt = halfLife ? Math.pow(0.5, (throughWeek - w) / halfLife) : 1;
      for (i = 0; i < g.length; i++) {
        var a = idx[g[i][0]], b = idx[g[i][1]];
        sw[a] += wt; swx[a] += wt * (g[i][2] - mean); sw2[a] += wt * wt; cnt[a]++;
        sw[b] += wt; swx[b] += wt * (g[i][3] - mean); sw2[b] += wt * wt; cnt[b]++;
      }
    }
    var s2 = hyper.sigma * hyper.sigma, t2 = hyper.tau * hyper.tau;
    var raw = new Array(n), shrunk = new Array(n), k = new Array(n), v = new Array(n), nEff = new Array(n);
    for (i = 0; i < n; i++) {
      if (sw[i] > 0) {
        raw[i] = swx[i] / sw[i];
        nEff[i] = sw[i] * sw[i] / sw2[i];           // effective number of games
        k[i] = t2 / (t2 + s2 / nEff[i]);
        shrunk[i] = k[i] * raw[i];
        v[i] = k[i] * s2 / nEff[i];                   // posterior variance of true strength
      } else { raw[i] = 0; nEff[i] = 0; k[i] = 0; shrunk[i] = 0; v[i] = t2; }
    }
    return { raw: raw, shrunk: shrunk, k: k, v: v, nEff: nEff, leagueMean: totN ? tot / totN : 0, games: cnt };
  }
  function winProb(relA, relB, sigma, vA, vB) {
    return normCdf((relA - relB) / Math.sqrt(2 * sigma * sigma + vA + vB));
  }

  /* ---------- the simulation ---------- */
  /* cfg = {
   *   n: number of teams,
   *   wins, ties, pf, pa: arrays of current totals (length n),
   *   games: [{week, a, b}] remaining regular-season games (team indexes),
   *   rel: { week: [..n] } expected margin over league average for each remaining week,
   *   base: league-average score, sigma: weekly noise sd, v: [..n] strength-uncertainty variance,
   *   playoffTeams: 6, playoffWeeks: { r1: 14, r2: 15, final: [16, 17] }
   * }
   * picks: array aligned with cfg.games: 0 = open, 1 = team a wins, 2 = team b wins.
   */
  function simulate(cfg, picks, nSims, seed) {
    var n = cfg.n, G = cfg.games.length, P = cfg.playoffTeams || 6;
    var rng = sfc32(seed == null ? 20261124 : seed), norm = makeNormal(rng);
    var sigma = cfg.sigma, sD = sigma * Math.SQRT2, base = cfg.base;
    var sdV = cfg.v.map(function (x) { return Math.sqrt(x); });
    var pw = cfg.playoffWeeks || { r1: 14, r2: 15, final: [16, 17] };
    picks = picks || [];
    var out = {
      nSims: nSims, wsum: 0, w2sum: 0,
      playoff: new Float64Array(n), bye: new Float64Array(n), semi: new Float64Array(n),
      fin: new Float64Array(n), champ: new Float64Array(n),
      seedDist: [], winsDist: [], pfSum: new Float64Array(n),
      gameA: new Float64Array(G), gameW: new Float64Array(G),
      levPA: [], levPB: [], levCA: [], levCB: [], levBA: [], levBB: [], levWA: new Float64Array(G), levWB: new Float64Array(G),
      ownW: [], ownP: [], ownC: [], ownS: [], ownT: [],
      slotDist: [], slotSum: new Float64Array(n), levSA: [], levSB: [], levTA: [], levTB: []
    };
    var i, g, maxLeft = 0, left = new Int32Array(n);
    for (g = 0; g < G; g++) { left[cfg.games[g].a]++; left[cfg.games[g].b]++; }
    for (i = 0; i < n; i++) if (left[i] > maxLeft) maxLeft = left[i];
    var maxWins = 0;
    for (i = 0; i < n; i++) maxWins = Math.max(maxWins, cfg.wins[i] + left[i]);
    for (i = 0; i < n; i++) {
      out.seedDist.push(new Float64Array(n));
      out.winsDist.push(new Float64Array(maxWins + 2));
      out.ownW.push(new Float64Array(maxLeft + 1)); out.ownP.push(new Float64Array(maxLeft + 1)); out.ownC.push(new Float64Array(maxLeft + 1));
      out.ownS.push(new Float64Array(maxLeft + 1)); out.ownT.push(new Float64Array(maxLeft + 1)); out.slotDist.push(new Float64Array(n));
    }
    for (g = 0; g < G; g++) {
      out.levPA.push(new Float64Array(n)); out.levPB.push(new Float64Array(n));
      out.levCA.push(new Float64Array(n)); out.levCB.push(new Float64Array(n));
      out.levBA.push(new Float64Array(n)); out.levBB.push(new Float64Array(n));
      out.levSA.push(new Float64Array(n)); out.levSB.push(new Float64Array(n)); out.levTA.push(new Float64Array(n)); out.levTB.push(new Float64Array(n));
    }
    var e = new Float64Array(n), wins = new Float64Array(n), pf = new Float64Array(n), pa = new Float64Array(n);
    var key = new Float64Array(n), order = new Int32Array(n), aWon = new Uint8Array(G), own = new Int32Array(n);
    var inP = new Uint8Array(n), seedOf = new Int32Array(n), slot = new Int32Array(n);
    var relR1 = cfg.rel[pw.r1], relR2 = cfg.rel[pw.r2], relF = pw.final.map(function (w) { return cfg.rel[w]; });

    function score(t, rel) { return base + rel[t] + e[t] + sigma * norm(); }
    function play(x, y, rel) {            // one-week playoff game; x is the higher seed (wins exact ties)
      return score(x, rel) >= score(y, rel) ? x : y;
    }

    for (var s = 0; s < nSims; s++) {
      var w = 1;
      for (i = 0; i < n; i++) { e[i] = sdV[i] * norm(); wins[i] = cfg.wins[i] + 0.5 * cfg.ties[i]; pf[i] = cfg.pf[i]; pa[i] = cfg.pa[i]; own[i] = 0; }
      for (g = 0; g < G; g++) {
        var gm = cfg.games[g], a = gm.a, b = gm.b, rel = cfg.rel[gm.week];
        var muA = base + rel[a] + e[a], muB = base + rel[b] + e[b], sa, sb, pick = picks[g] | 0;
        if (pick === 0) {
          sa = muA + sigma * norm(); sb = muB + sigma * norm();
        } else {
          var a0 = -(muA - muB) / sD, z, pr;
          if (pick === 1) { pr = normCdf(-a0); z = -normInv(Math.max(rng() * pr, 1e-300)); }
          else { pr = normCdf(a0); z = normInv(Math.max(rng() * pr, 1e-300)); }
          w *= pr;
          var D = (muA - muB) + sD * z, T = muA + muB + sD * norm();
          sa = (T + D) / 2; sb = (T - D) / 2;
        }
        pf[a] += sa; pf[b] += sb; pa[a] += sb; pa[b] += sa;
        if (sa > sb) { wins[a] += 1; aWon[g] = 1; own[a]++; }
        else if (sb > sa) { wins[b] += 1; aWon[g] = 0; own[b]++; }
        else { wins[a] += 0.5; wins[b] += 0.5; aWon[g] = 2; }
      }
      // seed: record, then points for (points against only matters on exact PF ties)
      for (i = 0; i < n; i++) { key[i] = wins[i] * 1e7 + pf[i] + pa[i] * 1e-7; order[i] = i; }
      for (i = 1; i < n; i++) { var oi = order[i], kk = key[oi], j = i - 1; while (j >= 0 && key[order[j]] < kk) { order[j + 1] = order[j]; j--; } order[j + 1] = oi; }
      for (i = 0; i < n; i++) { seedOf[order[i]] = i; inP[order[i]] = i < P ? 1 : 0; }
      // bracket (six teams): 4v5 and 3v6, then 1 v winner(4/5), 2 v winner(3/6), two-week final
      var s1 = order[0], s2 = order[1], q1, q2, f1, f2, ch;
      if (P === 6) {
        q1 = play(order[3], order[4], relR1); q2 = play(order[2], order[5], relR1);
        f1 = play(s1, q1, relR2); f2 = play(s2, q2, relR2);
      } else if (P === 4) {
        q1 = s1; q2 = s2;                       // no first round
        f1 = play(order[0], order[3], relR2); f2 = play(order[1], order[2], relR2);
      } else { throw new Error('bracket size not implemented: ' + P); }
      var t1 = 0, t2 = 0;
      for (i = 0; i < relF.length; i++) { t1 += score(f1, relF[i]); t2 += score(f2, relF[i]); }
      if (t1 === t2) ch = seedOf[f1] < seedOf[f2] ? f1 : f2; else ch = t1 > t2 ? f1 : f2;
      // next year's draft slots
      if (P === 6) draftSlots(order, seedOf, P, q1 === order[3] ? order[4] : order[3], q2 === order[2] ? order[5] : order[2], f1 === s1 ? q1 : s1, f2 === s2 ? q2 : s2, ch === f1 ? f2 : f1, ch, slot);
      else draftSlots(order, seedOf, P, -1, -1, f1 === order[0] ? order[3] : order[0], f2 === order[1] ? order[2] : order[1], ch === f1 ? f2 : f1, ch, slot);

      out.wsum += w; out.w2sum += w * w;
      for (i = 0; i < n; i++) {
        out.seedDist[i][seedOf[i]] += w;
        out.winsDist[i][Math.floor(wins[i])] += w;
        out.pfSum[i] += w * pf[i];
        out.ownW[i][own[i]] += w;
        if (inP[i]) { out.playoff[i] += w; out.ownP[i][own[i]] += w; }
        out.slotDist[i][slot[i] - 1] += w; out.slotSum[i] += w * slot[i]; out.ownS[i][own[i]] += w * slot[i];
        if (slot[i] <= 3) out.ownT[i][own[i]] += w;
      }
      out.bye[s1] += w; out.bye[s2] += w;
      out.semi[s1] += w; out.semi[s2] += w; out.semi[q1] += (P === 6 ? w : 0); out.semi[q2] += (P === 6 ? w : 0);
      if (P === 4) { out.semi[order[2]] += w; out.semi[order[3]] += w; }
      out.fin[f1] += w; out.fin[f2] += w; out.champ[ch] += w; out.ownC[ch][own[ch]] += w;
      for (g = 0; g < G; g++) {
        if (aWon[g] === 1) {
          out.gameA[g] += w; out.levWA[g] += w;
          for (i = 0; i < P; i++) out.levPA[g][order[i]] += w;
          out.levBA[g][s1] += w; out.levBA[g][s2] += w; out.levCA[g][ch] += w;
          for (i = 0; i < n; i++) { out.levSA[g][i] += w * slot[i]; if (slot[i] <= 3) out.levTA[g][i] += w; }
        } else if (aWon[g] === 0) {
          out.levWB[g] += w;
          for (i = 0; i < P; i++) out.levPB[g][order[i]] += w;
          out.levBB[g][s1] += w; out.levBB[g][s2] += w; out.levCB[g][ch] += w;
          for (i = 0; i < n; i++) { out.levSB[g][i] += w * slot[i]; if (slot[i] <= 3) out.levTB[g][i] += w; }
        }
        out.gameW[g] += w;
      }
    }
    out.ess = out.wsum * out.wsum / out.w2sum;   // effective sample size after importance weighting
    return out;
  }

  /* ---------- exact clinch / elimination by win-loss arithmetic ---------- */
  // Enumerates every win-loss combination of the open games. A team has clinched a top-K
  // place if, in every combination, fewer than K other teams can match or beat its record
  // (so no points tiebreak is needed). It is eliminated if, in every combination, at least
  // K other teams finish with strictly more wins. Sufficient conditions, never guesses.
  function clinch(cfg, picks, K) {
    var n = cfg.n, G = cfg.games.length, open = [], i, g;
    var baseW = new Float64Array(n);
    for (i = 0; i < n; i++) baseW[i] = cfg.wins[i] + 0.5 * cfg.ties[i];
    picks = picks || [];
    for (g = 0; g < G; g++) {
      if ((picks[g] | 0) === 1) baseW[cfg.games[g].a] += 1;
      else if ((picks[g] | 0) === 2) baseW[cfg.games[g].b] += 1;
      else open.push(g);
    }
    var clinched = new Array(n).fill(true), eliminated = new Array(n).fill(true);
    if (open.length > 20) return { clinched: new Array(n).fill(false), eliminated: new Array(n).fill(false), exact: false };
    var combos = 1 << open.length, wv = new Float64Array(n);
    for (var m = 0; m < combos; m++) {
      for (i = 0; i < n; i++) wv[i] = baseW[i];
      for (var j = 0; j < open.length; j++) { var gm = cfg.games[open[j]]; wv[(m >> j) & 1 ? gm.a : gm.b] += 1; }
      for (i = 0; i < n; i++) {
        var ge = 0, gt = 0;
        for (var t = 0; t < n; t++) if (t !== i) { if (wv[t] >= wv[i]) ge++; if (wv[t] > wv[i]) gt++; }
        if (ge >= K) clinched[i] = false;
        if (gt < K) eliminated[i] = false;
      }
    }
    return { clinched: clinched, eliminated: eliminated, exact: true };
  }

  return { sfc32: sfc32, makeNormal: makeNormal, normCdf: normCdf, normInv: normInv, standings: standings, seedOrder: seedOrder, seasonForm: seasonForm, winProb: winProb, draftSlots: draftSlots, simulate: simulate, clinch: clinch };
});
