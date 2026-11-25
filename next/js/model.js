/* League Odds - turns a league description plus player projections into the simulator's inputs.
 * Shared by the page, the tests and the research scripts.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./engine.js'));
  else root.LOModel = factory(root.LOCore, root.LOEngine);
})(typeof self !== 'undefined' ? self : this, function (C, E) {
  'use strict';

  /* Fitted on real leagues (see next/research.md). Scores are in each league's own points.
   *   sigma0: typical week-to-week noise for a league whose average score is `base`
   *   tau0:   typical spread of true team strength
   *   c, kappa: how far projected lineups can be trusted (slope, and what they miss) */
  var PRIOR = { sigmaAt100: 20.1, sigmaPow: 0.71, sigmaDf: 40, tauShare: 0.14, tauDf: 8, c: 0.9, kappaShare: 0.085 };

  function mean(a) { var s = 0, k = 0; for (var i = 0; i < a.length; i++) if (a[i] != null && !isNaN(a[i])) { s += a[i]; k++; } return k ? s / k : 0; }

  // League average, noise and talent spread from this league's own weeks, pulled toward what leagues usually look like.
  function hyper(D, prior) {
    prior = prior || PRIOR;
    var n = D.n, weeks = Object.keys(D.results), i, tot = 0, cnt = 0, rel = [], games = new Array(n).fill(0), sum = new Array(n).fill(0);
    for (i = 0; i < n; i++) rel.push([]);
    weeks.forEach(function (w) {
      var g = D.results[w], s = 0, m = 0;
      g.forEach(function (x) { s += x[2] + x[3]; m += 2; });
      if (!m) return;
      var mu = s / m; tot += s; cnt += m;
      g.forEach(function (x) { rel[x[0]].push(x[2] - mu); rel[x[1]].push(x[3] - mu); });
    });
    var base = cnt ? tot / cnt : 0, ss = 0, df = 0, means = [];
    for (i = 0; i < n; i++) { games[i] = rel[i].length; var mi = mean(rel[i]); sum[i] = mi; if (games[i]) means.push(mi); rel[i].forEach(function (x) { ss += (x - mi) * (x - mi); }); df += Math.max(0, games[i] - 1); }
    return { base: base, ss: ss, df: df, games: games, formRaw: sum, means: means, prior: prior };
  }
  function finishHyper(h, base) {
    var p = h.prior, sigma0 = p.sigmaAt100 * Math.pow(Math.max(base, 20) / 100, p.sigmaPow), tau0 = p.tauShare * base;
    var sigma2 = (p.sigmaDf * sigma0 * sigma0 + h.ss) / (p.sigmaDf + h.df);
    var m = h.means.length, tau2 = tau0 * tau0;
    if (m >= 4) {
      var mu = mean(h.means), v = 0, g = mean(h.games.filter(function (x) { return x > 0; }));
      h.means.forEach(function (x) { v += (x - mu) * (x - mu); }); v /= (m - 1);
      var est = Math.max(0, v - sigma2 / g);
      tau2 = (p.tauDf * tau0 * tau0 + (m - 1) * est) / (p.tauDf + m - 1);
    }
    return { base: base, sigma: Math.sqrt(sigma2), tau: Math.sqrt(tau2), sigma0: sigma0, tau0: tau0, kappa: p.kappaShare * base, c: p.c };
  }

  /* Projected best lineup for every team in every week still to play.
   * shared = { players: {id: [name, pos, team, [positions]]}, weeks: {w: {keys: [], p: {id: [keyIndex, value, ...]}}} }
   * Returns { week: { totals: [n], lineups: [[{slot, id, pts, fa}]] } } */
  function projectWeeks(D, shared, weeks) {
    var out = {}, slots = D.set.slots, sc = D.set.scoring, rostered = {};
    D.rosters.forEach(function (r) { r.all.forEach(function (p) { rostered[p] = 1; }); });
    weeks.forEach(function (w) {
      var wk = shared.weeks && shared.weeks[w]; if (!wk) return;
      var pts = {}, id, keys = wk.keys;
      var score = function (pid) {
        if (pts[pid] !== undefined) return pts[pid];
        var row = wk.p[pid]; if (!row) return (pts[pid] = 0);
        var st = {}; for (var k = 0; k < row.length; k += 2) st[keys[row[k]]] = row[k + 1];
        var info = shared.players[pid];
        return (pts[pid] = Math.max(0, C.projectPoints(st, sc, info ? info[3] : null)));
      };
      // the best unrostered players, for slots a team can't fill from its own roster
      var pool = [];
      for (id in wk.p) if (!rostered[id] && shared.players[id]) { var v = score(id); if (v > 0) pool.push({ id: id, pos: shared.players[id][3] || [shared.players[id][1]], pts: v, fa: true }); }
      pool.sort(function (a, b) { return b.pts - a.pts; });
      var totals = [], lineups = [], taken = {};
      D.rosters.forEach(function (r) {
        var cand = [];
        r.players.forEach(function (pid) { var info = shared.players[pid]; if (!info) return; var v = score(pid); if (v > 0) cand.push({ id: pid, pos: info[3] || [info[1]], pts: v }); });
        var best = C.bestLineup(slots, cand);
        best.starters.forEach(function (s) {
          if (s.id != null) return;
          for (var k = 0; k < pool.length; k++) { var f = pool[k]; if (!taken[f.id] && C.slotAccepts(s.slot, f.pos)) { taken[f.id] = 1; s.id = f.id; s.pts = f.pts; s.fa = true; best.total += f.pts; break; } }
        });
        totals.push(best.total); lineups.push(best.starters);
      });
      out[w] = { totals: totals, lineups: lineups };
    });
    return out;
  }

  // weeks the simulator needs a strength number for
  function weeksNeeded(D) {
    var need = {}, w;
    Object.keys(D.schedule).forEach(function (x) { need[x] = 1; });
    (D.set.rounds || []).forEach(function (wk) { wk.forEach(function (x) { if (x > D.scored) need[x] = 1; }); });
    return Object.keys(need).map(Number).sort(function (a, b) { return a - b; });
  }

  /* The simulator's inputs.
   * mode: 'blend' (default) starts from projected lineups and moves toward season scoring as games pile up;
   *       'season' uses scoring only; 'proj' uses projections only. */
  function buildConfig(D, proj, opts) {
    opts = opts || {};
    var mode = opts.mode || 'blend', n = D.n, i, h0 = hyper(D, opts.prior), weeks = weeksNeeded(D);
    var haveProj = proj && weeks.some(function (w) { return proj[w]; });
    if (!haveProj && mode !== 'season') mode = 'season';
    // projected margin over the league's average projected lineup, per week; weeks without data use the team's average
    var projRel = {}, avgRel = new Array(n).fill(0), cntW = 0, projMean = 0;
    weeks.forEach(function (w) { if (!haveProj || !proj[w]) return; var t = proj[w].totals, m = mean(t); projRel[w] = t.map(function (x) { return x - m; }); projMean += m; cntW++; for (i = 0; i < n; i++) avgRel[i] += t[i] - m; });
    if (cntW) { for (i = 0; i < n; i++) avgRel[i] /= cntW; projMean /= cntW; }
    weeks.forEach(function (w) { if (!projRel[w]) projRel[w] = avgRel.slice(); });
    var base = h0.base || projMean || 100, hy = finishHyper(h0, base);
    if (!h0.base && mode === 'season') mode = haveProj ? 'proj' : 'season';
    var s2 = hy.sigma * hy.sigma, form = { raw: h0.formRaw, games: h0.games, k: [], shrunk: [] }, rel = {}, v = new Array(n), lean = new Array(n);
    for (i = 0; i < n; i++) {
      var g = h0.games[i], prior2 = mode === 'blend' ? hy.kappa * hy.kappa : hy.tau * hy.tau;
      var k = g ? prior2 / (prior2 + s2 / g) : 0;
      if (mode === 'proj') k = 0;
      form.k.push(k); form.shrunk.push((g ? hy.tau * hy.tau / (hy.tau * hy.tau + s2 / g) : 0) * h0.formRaw[i]);
      lean[i] = mode === 'season' ? k * h0.formRaw[i] : k * (h0.formRaw[i] - hy.c * avgRel[i]);     // what results add on top of projections
      v[i] = g && mode !== 'proj' ? k * s2 / g : (mode === 'proj' ? hy.kappa * hy.kappa : hy.tau * hy.tau);
    }
    weeks.forEach(function (w) { rel[w] = projRel[w].map(function (p, t) { return mode === 'season' ? lean[t] : hy.c * p + lean[t]; }); });
    var games = [];
    Object.keys(D.schedule).map(Number).sort(function (a, b) { return a - b; }).forEach(function (w) { D.schedule[w].forEach(function (g2) { games.push({ week: w, a: g2[0], b: g2[1] }); }); });
    var ppRatio = D.rec.pp.map(function (pp, t) { var r = D.rec.pf[t] > 0 && pp > 0 ? pp / D.rec.pf[t] : 1.15; return Math.min(1.5, Math.max(1, r)); });
    var cfg = {
      n: n, wins: D.rec.wins, losses: D.rec.losses, ties: D.rec.ties, pf: D.rec.pf, pa: D.rec.pa,
      div: D.set.nDiv ? D.teams.map(function (t) { return t.div; }) : null, nDiv: D.set.nDiv, median: D.set.median,
      games: games, rel: rel, base: base, sigma: hy.sigma, v: v,
      playoff: { teams: D.set.P, bracket: D.bracket, rounds: D.set.rounds, reseed: D.set.reseed, fixed: D.fixed || null },
      draft: opts.draft ? { nonPlayoff: opts.draft.nonPlayoff, playoff: opts.draft.playoff, byRound: opts.draft.byRound || null, pp: D.rec.pp.map(function (x, t) { return x > 0 ? x : D.rec.pf[t] * ppRatio[t]; }), ppRatio: ppRatio } : null,
      hyper: hy, form: form, projRel: projRel, mode: mode, weeks: weeks, haveProj: !!haveProj
    };
    return cfg;
  }

  /* Which draft-order rule does this league follow? Checked against its own finished seasons:
   * past = [{ league, rosters, winners, draft }] where `draft` is the draft that FOLLOWED that season (may be null).
   * Returns the rule that reproduced the most picks, with how many it got right. */
  var NP_RULES = ['maxpf', 'record', 'pf'], PO_RULES = ['place', 'seed', 'bracket', 'record'];
  function seasonFacts(p) {
    var L = p.league, s = L.settings || {}, rosters = p.rosters.slice().sort(function (a, b) { return a.roster_id - b.roster_id; }), n = rosters.length, idx = {};
    rosters.forEach(function (r, k) { idx[r.roster_id] = k; });
    var rec = { wins: [], losses: [], ties: [], pf: [], pa: [], pp: [] };
    rosters.forEach(function (r) { var x = r.settings || {}; rec.wins.push(x.wins || 0); rec.losses.push(x.losses || 0); rec.ties.push(x.ties || 0); rec.pf.push((x.fpts || 0) + (x.fpts_decimal || 0) / 100); rec.pa.push((x.fpts_against || 0) + (x.fpts_against_decimal || 0) / 100); rec.pp.push((x.ppts || 0) + (x.ppts_decimal || 0) / 100); });
    var nDiv = s.divisions > 1 ? s.divisions : 0, div = nDiv ? rosters.map(function (r) { return (r.settings && r.settings.division) || null; }) : null;
    var order = C.seedOrder(rec, div, nDiv), P = Math.min(s.playoff_teams || 0, n), seedOf = new Int32Array(n);
    order.forEach(function (t, sd) { seedOf[t] = sd; });
    // bracket finish
    var alive = {}, elim = new Int32Array(n), place = new Int32Array(n), lostIn = new Int32Array(n), R = 0, k;
    for (k = 0; k < P; k++) alive[order[k]] = 1;
    var rows = (p.winners || []).slice().sort(function (a, b) { return a.r - b.r || a.m - b.m; });
    rows.forEach(function (g) {
      if (g.r > R) R = g.r;
      var w = idx[g.w], l = idx[g.l]; if (w == null || l == null) return;
      if (alive[w] && alive[l]) { elim[l] = g.r; lostIn[l] = g.m; delete alive[l]; }
      if (g.p) { place[w] = g.p; place[l] = g.p + 1; }
    });
    var left = Object.keys(alive);
    if (left.length !== 1) return null;                       // bracket never finished
    elim[Number(left[0])] = R + 1;
    return { n: n, P: P, R: R, idx: idx, order: order, seedOf: seedOf, elim: elim, place: place, lostIn: lostIn, pp: rec.pp, pf: rec.pf, rosters: rosters };
  }
  function inferDraftRule(past) {
    var score = {}, checked = 0, seasons = 0, np, po;
    NP_RULES.forEach(function (a) { score['np:' + a] = 0; }); PO_RULES.forEach(function (a) { score['po:' + a] = 0; });
    var npSlots = 0, poSlots = 0;
    (past || []).forEach(function (p) {
      if (!p || !p.draft || !p.draft.slot_to_roster_id) return;
      var f = seasonFacts(p); if (!f || !f.P) return;
      var actual = [], ok = true, k;
      for (k = 1; k <= f.n; k++) { var rid = p.draft.slot_to_roster_id[k]; if (rid == null || f.idx[rid] == null) { ok = false; break; } actual.push(f.idx[rid]); }
      if (!ok) return;
      seasons++;
      var slot = new Int32Array(f.n), tmp = new Int32Array(f.n), key = new Float64Array(f.n);
      NP_RULES.forEach(function (a) {
        E.draftSlots({ nonPlayoff: a, playoff: 'seed' }, f.n, f.P, f.R, f.order, f.seedOf, f.elim, f.place, f.lostIn, f.pp, f.pf, slot, tmp, key);
        for (var q = 0; q < f.n - f.P; q++) if (slot[actual[q]] === q + 1) score['np:' + a]++;
      });
      PO_RULES.forEach(function (a) {
        E.draftSlots({ nonPlayoff: 'record', playoff: a }, f.n, f.P, f.R, f.order, f.seedOf, f.elim, f.place, f.lostIn, f.pp, f.pf, slot, tmp, key);
        for (var q = f.n - f.P; q < f.n; q++) if (slot[actual[q]] === q + 1) score['po:' + a]++;
      });
      npSlots += f.n - f.P; poSlots += f.P;
    });
    // same-round ties can follow a different habit in each round, so pick the best per round too
    var byRound = [null], TIE = ['place', 'seed', 'bracket'], maxR = 0, rs = {}, tot = 0, hit = 0;
    (past || []).forEach(function (p) {
      if (!p || !p.draft || !p.draft.slot_to_roster_id) return;
      var f = seasonFacts(p); if (!f || !f.P) return;
      var actual = {}, ok = true, k; for (k = 1; k <= f.n; k++) { var rid = p.draft.slot_to_roster_id[k]; if (rid == null || f.idx[rid] == null) ok = false; else actual[f.idx[rid]] = k; }
      if (!ok) return;
      var slot = new Int32Array(f.n), tmp = new Int32Array(f.n), key = new Float64Array(f.n);
      TIE.forEach(function (a) {
        E.draftSlots({ nonPlayoff: 'record', playoff: a }, f.n, f.P, f.R, f.order, f.seedOf, f.elim, f.place, f.lostIn, f.pp, f.pf, slot, tmp, key);
        for (var t = 0; t < f.n; t++) { var er = f.elim[t]; if (!er || er > f.R) continue; if (er > maxR) maxR = er; var id = er + ':' + a; rs[id] = rs[id] || [0, 0]; rs[id][1]++; if (slot[t] === actual[t]) rs[id][0]++; }
      });
    });
    for (var er = 1; er <= maxR; er++) { var bestT = TIE[0]; TIE.forEach(function (a) { if (rs[er + ':' + a] && rs[er + ':' + a][0] > (rs[er + ':' + bestT] || [0])[0]) bestT = a; }); byRound[er] = bestT; if (rs[er + ':' + bestT]) { hit += rs[er + ':' + bestT][0]; tot += rs[er + ':' + bestT][1]; } }
    np = NP_RULES[0]; po = PO_RULES[0];
    NP_RULES.forEach(function (a) { if (score['np:' + a] > score['np:' + np]) np = a; });
    PO_RULES.forEach(function (a) { if (score['po:' + a] > score['po:' + po]) po = a; });
    if (seasons && tot && score['po:record'] <= hit + seasons) { return { nonPlayoff: np, playoff: 'place', byRound: byRound, seasons: seasons, npHit: score['np:' + np], npSlots: npSlots, poHit: hit + seasons, poSlots: poSlots,
      known: npSlots > 0 && score['np:' + np] / npSlots >= 0.8, scores: score }; }
    return { nonPlayoff: np, playoff: po, seasons: seasons, npHit: score['np:' + np], npSlots: npSlots, poHit: score['po:' + po], poSlots: poSlots,
      known: seasons > 0 && npSlots > 0 && score['np:' + np] / npSlots >= 0.8, scores: score };
  }

  return { PRIOR: PRIOR, hyper: hyper, finishHyper: finishHyper, projectWeeks: projectWeeks, weeksNeeded: weeksNeeded, buildConfig: buildConfig, inferDraftRule: inferDraftRule, seasonFacts: seasonFacts };
});
