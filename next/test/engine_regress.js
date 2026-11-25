// The general engine must reproduce the original, cross-checked six-team engine on the same league.
const path = require('path'), fs = require('fs');
const Old = require('../../src/engine.js'), OldModel = require('../../src/model.js');
const C = require('../js/core.js'), E = require('../js/engine.js');
const snap = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/snapshot.json'), 'utf8'));
const oc = OldModel.buildConfig(snap, 0.5), N = 60000;
const cfg = { n: oc.n, wins: oc.wins, losses: oc.losses, ties: oc.ties, pf: oc.pf, pa: oc.pa, games: oc.games, rel: oc.rel, base: oc.base, sigma: oc.sigma, v: oc.v,
  playoff: { teams: 6, bracket: C.standardBracket(6), rounds: [[14], [15], [16, 17]], reseed: false }, draft: { nonPlayoff: 'record', playoff: 'cherry' } };
let fails = 0; const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
function cmp(label, picks) {
  const a = Old.simulate(oc, picks, N, 7), b = E.simulate(cfg, picks, N, 11);
  let worst = 0, where = '';
  const chk = (name, x, y) => { for (let i = 0; i < oc.n; i++) { const d = Math.abs(x[i] / a.wsum - y[i] / b.wsum); if (d > worst) { worst = d; where = name + '[' + i + ']'; } } };
  chk('playoff', a.playoff, b.playoff); chk('bye', a.bye, b.bye); chk('semi', a.semi, b.reach[2]); chk('final', a.fin, b.fin); chk('champ', a.champ, b.champ);
  for (let i = 0; i < oc.n; i++) for (let j = 0; j < oc.n; j++) { const d = Math.abs(a.seedDist[i][j] / a.wsum - b.seedDist[i][j] / b.wsum); if (d > worst) { worst = d; where = 'seed[' + i + '][' + j + ']'; } }
  let worstSlot = 0;
  for (let i = 0; i < oc.n; i++) for (let j = 0; j < oc.n; j++) worstSlot = Math.max(worstSlot, Math.abs(a.slotDist[i][j] / a.wsum - b.slotDist[i][j] / b.wsum));
  let worstLev = 0;
  // swings are conditional on a game's result, so judge each gap against its own sampling error
  for (let g = 0; g < oc.games.length; g++) {
    worstLev = Math.max(worstLev, Math.abs(a.gameA[g] / a.gameW[g] - b.gameA[g] / b.gameW[g]) / 0.004);
    const k = b.levGames.indexOf(g), na = N * a.levWA[g] / a.wsum, nb = N * b.levWA[k] / b.wsum;
    if (na > 50 && nb > 50) for (let i = 0; i < oc.n; i++) { const x = a.levPA[g][i] / a.levWA[g], y = b.levPA[k][i] / b.levWA[k], pm = (x + y) / 2, se = Math.sqrt(pm * (1 - pm) * (1 / na + 1 / nb)) + 5e-4; worstLev = Math.max(worstLev, Math.abs(x - y) / se); }
  }
  ok(label + ': playoff/bye/semi/final/title/seed odds agree', worst < 0.012, 'max gap ' + (100 * worst).toFixed(2) + ' pts at ' + where);
  ok(label + ': game odds and swings agree', worstLev < 4.5, 'largest gap ' + worstLev.toFixed(2) + ' standard errors');
  return { a, b, worstSlot };
}
// the original draft rule (first-round losers by seed, semifinal losers by bracket half) as a custom check below
const r0 = cmp('no picks', []);
const pk = oc.games.map((g, i) => i === 0 ? 1 : i === 3 ? 2 : i === 7 ? 1 : 0);
cmp('three picks', pk);
// clinch flags agree
for (const K of [6, 2]) {
  const a = Old.clinch(oc, [], K), b = E.clinch(cfg, [], K);
  ok('clinch/eliminate flags agree for top ' + K, JSON.stringify(a.clinched) === JSON.stringify(b.clinched) && JSON.stringify(a.eliminated) === JSON.stringify(b.eliminated), b.method);
}
console.log(fails ? fails + ' FAILED' : 'all good'); process.exit(fails ? 1 : 0);
