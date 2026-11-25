/* Turns the data snapshot into an engine config. Shared by the page and the tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.CPModel = factory(root.CPEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  function buildConfig(snap, blend) {
    var lam = blend == null ? snap.blend : blend;
    var ids = snap.teams.map(function (t) { return t.rid; }), n = ids.length, idx = {};
    ids.forEach(function (id, i) { idx[id] = i; });
    var st = E.standings(snap.results, ids, snap.throughWeek);
    var form = E.seasonForm(snap.results, ids, snap.throughWeek, snap.hyper);
    var rel = {}, projRel = {};
    Object.keys(snap.proj).forEach(function (w) {
      var tot = ids.map(function (id) { return snap.proj[w][id]; });
      var mean = tot.reduce(function (a, b) { return a + b; }, 0) / n;
      projRel[w] = tot.map(function (x) { return x - mean; });
      rel[w] = tot.map(function (x, i) { return (1 - lam) * form.shrunk[i] + lam * (x - mean); });
    });
    var games = [];
    Object.keys(snap.schedule).map(Number).sort(function (a, b) { return a - b; }).forEach(function (w) {
      snap.schedule[w].forEach(function (g) { games.push({ week: w, a: idx[g[0]], b: idx[g[1]] }); });
    });
    return {
      n: n, ids: ids, wins: st.wins, losses: st.losses, ties: st.ties, pf: st.pf, pa: st.pa, games: games, rel: rel,
      base: form.leagueMean, sigma: snap.hyper.sigma, v: form.v, playoffTeams: snap.league.playoffTeams,
      playoffWeeks: snap.league.playoffWeeks, form: form, projRel: projRel, blend: lam
    };
  }
  return { buildConfig: buildConfig };
});
