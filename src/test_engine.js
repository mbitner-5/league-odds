const E = require('./engine.js'), M = require('./model.js'), fs = require('fs');
const snap = JSON.parse(fs.readFileSync('data/snapshot.json'));
let pass = 0, fail = 0; const log = [];
function ok(name, cond, detail) { (cond ? pass++ : fail++); log.push({ name, ok: !!cond, detail: detail || '' }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '')); }
const ids = [1,2,3,4,5,6,7,8,9,10,11,12];
function load(y) { const raw = JSON.parse(fs.readFileSync(`data/weeks_${y}.json`)), d = {}; for (const w in raw) d[w] = raw[w].map(g => [g.a, g.b, g.pa, g.pb]); return d; }

// 1. Seeding rule reproduces Sleeper's real brackets
const brackets = { 2023: { s1: 2, s2: 8, m45: [10, 11], m36: [7, 4], thru: 13 }, 2024: { s1: 11, s2: 2, m45: [3, 6], m36: [7, 4], thru: 13 }, 2025: { s1: 8, s2: 3, m45: [4, 6], m36: [10, 7], thru: 13 }, 2026: { s1: 3, s2: 6, m45: [1, 9], m36: [11, 5], thru: 11 } };
for (const y in brackets) {
  const b = brackets[y], st = E.standings(load(y), ids, b.thru), o = E.seedOrder(st.wins, st.ties, st.pf, st.pa).map(i => ids[i]);
  const same = (a, c) => a.slice().sort().join() === c.slice().sort().join();
  ok(`seeding matches Sleeper's ${y} bracket`, o[0] === b.s1 && o[1] === b.s2 && same([o[3], o[4]], b.m45) && same([o[2], o[5]], b.m36), 'seeds 1-6: ' + o.slice(0, 6).join(','));
}

// 1b. Draft-order rule reproduces the league's last three rookie drafts (slot by roster id)
const drafts = {
  2023: { l1: 10, l2: 7, x1: 11, x2: 8, ru: 2, ch: 4, actual: { 12: 1, 9: 2, 6: 3, 5: 4, 1: 5, 3: 6, 7: 7, 10: 8, 8: 9, 11: 10, 2: 11, 4: 12 } },
  2024: { l1: 6, l2: 7, x1: 3, x2: 2, ru: 4, ch: 11, actual: { 5: 1, 12: 2, 1: 3, 9: 4, 8: 5, 10: 6, 7: 7, 6: 8, 2: 9, 3: 10, 4: 11, 11: 12 } },
  2025: { l1: 4, l2: 7, x1: 8, x2: 3, ru: 10, ch: 6, actual: { 2: 1, 12: 2, 9: 3, 5: 4, 1: 5, 11: 6, 4: 7, 7: 8, 3: 9, 8: 10, 10: 11, 6: 12 } } };
let slotHits = 0;
for (const y in drafts) {
  const d = drafts[y], st = E.standings(load(y), ids, 13), o = E.seedOrder(st.wins, st.ties, st.pf, st.pa), seedOf = []; o.forEach((t, i) => seedOf[t] = i);
  const ix = r => ids.indexOf(r), sl = E.draftSlots(o, seedOf, 6, ix(d.l1), ix(d.l2), ix(d.x1), ix(d.x2), ix(d.ru), ix(d.ch));
  let hit = 0; ids.forEach((r, i) => { if (sl[i] === d.actual[r]) hit++; }); slotHits += hit;
  ok(`draft rule reproduces the ${Number(y) + 1} rookie draft order from the ${y} season`, hit === 12, hit + ' of 12 slots');
}

// 2. Simulation invariants
const cfg = M.buildConfig(snap, 0.5), N = 200000;
const base = E.simulate(cfg, [], N, 7);
const P = k => Array.from(base[k]).map(x => x / base.wsum), sum = a => a.reduce((x, y) => x + y, 0);
const pl = P('playoff'), by = P('bye'), se = P('semi'), fi = P('fin'), ch = P('champ');
ok('playoff odds sum to 6 teams', Math.abs(sum(pl) - 6) < 1e-9, sum(pl).toFixed(6));
ok('bye odds sum to 2', Math.abs(sum(by) - 2) < 1e-9); ok('semifinal odds sum to 4', Math.abs(sum(se) - 4) < 1e-9);
ok('final odds sum to 2', Math.abs(sum(fi) - 2) < 1e-9); ok('title odds sum to 1', Math.abs(sum(ch) - 1) < 1e-9);
ok('every team: title <= final <= semis <= playoffs, bye <= semis', pl.every((p, i) => ch[i] <= fi[i] + 1e-12 && fi[i] <= se[i] + 1e-12 && se[i] <= p + 1e-12 && by[i] <= se[i] + 1e-12));
ok('each seed is handed out exactly once per simulation', base.seedDist[0].map((_, s) => sum(base.seedDist.map(r => r[s])) / base.wsum).every(x => Math.abs(x - 1) < 1e-9));
ok('every draft slot is handed out exactly once per simulation', base.slotDist[0].map((_, s) => sum(base.slotDist.map(r => r[s])) / base.wsum).every(x => Math.abs(x - 1) < 1e-9));
ok('non-playoff odds equal top-six pick odds for every team', pl.every((p, i) => Math.abs((1 - p) - sum(Array.from(base.slotDist[i]).slice(0, 6)) / base.wsum) < 1e-9));
const sd = (i, lo, hi) => sum(Array.from(base.slotDist[i]).slice(lo - 1, hi)) / base.wsum;
ok('back-half picks follow playoff finish for every team: 12 champion, 11 runner-up, 9-10 semifinal losers, 7-8 first-round losers',
  pl.every((p, i) => Math.abs(sd(i, 12, 12) - ch[i]) < 1e-9 && Math.abs(sd(i, 11, 11) - (fi[i] - ch[i])) < 1e-9 && Math.abs(sd(i, 9, 10) - (se[i] - fi[i])) < 1e-9 && Math.abs(sd(i, 7, 8) - (p - se[i])) < 1e-9));
const again = E.simulate(cfg, [], 20000, 7), again2 = E.simulate(cfg, [], 20000, 7);
ok('same seed gives identical output', Array.from(again.playoff).join() === Array.from(again2.playoff).join());

// 3. Simulated game results match the closed-form win probability
let worst = 0;
cfg.games.forEach((g, i) => { const a = E.winProb(cfg.rel[g.week][g.a], cfg.rel[g.week][g.b], cfg.sigma, cfg.v[g.a], cfg.v[g.b]); const s = base.gameA[i] / base.wsum; worst = Math.max(worst, Math.abs(a - s) / Math.sqrt(a * (1 - a) / N)); });
ok('simulated win rates match the formula in all 12 games', worst < 4, 'largest gap ' + worst.toFixed(2) + ' standard errors');

// 4. Forcing an outcome (exact conditional sampling) agrees with filtering free simulations
let worstZ = 0, cnt = 0, mono = true;
for (let g = 0; g < cfg.games.length; g++) for (const side of [1, 2]) {
  const picks = new Array(cfg.games.length).fill(0); picks[g] = side;
  const f = E.simulate(cfg, picks, 60000, 100 + g * 2 + side);
  const wb = side === 1 ? base.levWA[g] : base.levWB[g];
  for (const [fk, bk] of [['playoff', side === 1 ? 'levPA' : 'levPB'], ['champ', side === 1 ? 'levCA' : 'levCB'], ['bye', side === 1 ? 'levBA' : 'levBB']]) for (let i = 0; i < 12; i++) {
    const pf = f[fk][i] / f.wsum, pb = base[bk][g][i] / wb, pm = (pf + pb) / 2, se = Math.sqrt(pm * (1 - pm) * (1 / f.ess + 1 / (N * wb / base.wsum)) + 1e-12);
    worstZ = Math.max(worstZ, Math.abs(pf - pb) / se); cnt++;
  }
  const winner = side === 1 ? cfg.games[g].a : cfg.games[g].b, loser = side === 1 ? cfg.games[g].b : cfg.games[g].a;
  if (f.playoff[winner] / f.wsum < pl[winner] - 0.01 || f.playoff[loser] / f.wsum > pl[loser] + 0.01) mono = false;
}
ok(`forced outcomes match filtered simulations (${cnt} comparisons)`, worstZ < 4.5, 'largest gap ' + worstZ.toFixed(2) + ' standard errors');
ok('a forced win never lowers the winner\'s playoff odds or raises the loser\'s', mono);

// 5. Law of total probability across a forced game
(function () { const g = 0, pa = base.gameA[g] / base.wsum, A = E.simulate(cfg, [1], 100000, 31), B = E.simulate(cfg, [2], 100000, 32); let w = 0; for (let i = 0; i < 12; i++) w = Math.max(w, Math.abs(pa * A.playoff[i] / A.wsum + (1 - pa) * B.playoff[i] / B.wsum - pl[i])); ok('win and loss branches average back to the unconditional odds', w < 0.006, 'largest gap ' + (100 * w).toFixed(2) + ' points'); })();

// 6. Exact clinch / elimination logic
(function () {
  const c0 = E.clinch(cfg, [], 6);
  const done = Object.assign({}, cfg, { games: [] }), cd = E.clinch(done, [], 6), o = E.seedOrder(cfg.wins, cfg.ties, cfg.pf, cfg.pa);
  ok('clinch flags never contradict the simulation', c0.clinched.every((c, i) => !c || pl[i] > 0.999) && c0.eliminated.every((e, i) => !e || pl[i] < 0.001), 'clinched: ' + c0.clinched.map((c, i) => c ? snap.teams[i].name : '').filter(Boolean).join(', ') + ' | eliminated: ' + c0.eliminated.map((c, i) => c ? snap.teams[i].name : '').filter(Boolean).join(', '));
  ok('with no games left, elimination flags only teams outside the top six', cd.eliminated.every((e, i) => !e || o.indexOf(i) >= 6));
})();

// 7. Normal-distribution functions: dump values for an independent check against SciPy
const xs = []; for (let x = -8; x <= 8.0001; x += 0.25) xs.push(x);
const ps = [1e-12, 1e-9, 1e-6, 1e-4, 0.001, 0.01, 0.02425, 0.1, 0.25, 0.5, 0.75, 0.9, 0.97575, 0.99, 0.999, 1 - 1e-6, 1 - 1e-9];
fs.writeFileSync('data/js_out.json', JSON.stringify({ cdf: xs.map(x => [x, E.normCdf(x)]), inv: ps.map(p => [p, E.normInv(p)]),
  base: { playoff: pl, bye: by, semi: se, fin: fi, champ: ch, n: N, slotDist: base.slotDist.map(r => Array.from(r).map(x => x / base.wsum)) },
  forced: (function () { const picks = new Array(12).fill(0); picks[0] = 1; picks[4] = 2; picks[6] = 2; const f = E.simulate(cfg, picks, 200000, 99); return { picks, ess: f.ess, slotDist: f.slotDist.map(r => Array.from(r).map(x => x / f.wsum)), playoff: Array.from(f.playoff).map(x => x / f.wsum), champ: Array.from(f.champ).map(x => x / f.wsum) }; })(),
  cfg: { rel: cfg.rel, v: cfg.v, base: cfg.base, sigma: cfg.sigma, wins: cfg.wins, pf: cfg.pf, games: cfg.games } }));
console.log(`\n${pass} passed, ${fail} failed`);
fs.writeFileSync('data/test_log.json', JSON.stringify({ pass, fail, log }));
process.exit(fail ? 1 : 0);
