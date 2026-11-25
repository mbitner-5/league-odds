// Walk-forward backtest of the season-form model on Cherry Pie's own history.
// Every prediction uses only games played before it; spread and shrinkage come from other seasons.
const E = require('./engine.js'), fs = require('fs');
const ids = [1,2,3,4,5,6,7,8,9,10,11,12];
const last = {2023:13, 2024:13, 2025:13, 2026: Math.min(13, JSON.parse(fs.readFileSync('data/snapshot.json')).throughWeek)};
const data = {};
for (const y of Object.keys(last)) {
  const raw = JSON.parse(fs.readFileSync(`data/weeks_${y}.json`)); data[y] = {};
  for (const w in raw) data[y][w] = raw[w].map(g => [g.a, g.b, g.pa, g.pb]);
}
function estimate(years) {            // pooled two-way variance components
  let ssr = 0, df = 0, between = 0, nb = 0, all = [];
  for (const y of years) {
    const W = last[y], X = ids.map(() => []);
    for (let w = 1; w <= W; w++) for (const g of data[y][w]) { X[g[0]-1][w-1] = g[2]; X[g[1]-1][w-1] = g[3]; }
    const m = []; for (let w = 0; w < W; w++) m.push(X.reduce((s, r) => s + r[w], 0) / 12);
    const dbar = X.map(r => r.reduce((s, x, w) => s + (x - m[w]), 0) / W);
    for (let i = 0; i < 12; i++) for (let w = 0; w < W; w++) { const r = X[i][w] - m[w] - dbar[i]; ssr += r*r; all.push(r); }
    df += 11 * (W - 1);
    between += dbar.reduce((s, d) => s + d*d, 0) / 11; nb += 1 / W;
  }
  const s2 = ssr / df, t2 = Math.max(0, (between - s2 * nb) / years.length);
  return { sigma: Math.sqrt(s2), tau: Math.sqrt(t2), resid: all };
}
const Hall = estimate([2023, 2024, 2025]);
console.log('pooled 2023-25  sigma %s  tau %s', Hall.sigma.toFixed(2), Hall.tau.toFixed(2));
for (const y of [2023, 2024, 2025, 2026]) { const h = estimate([y]); console.log(' ', y, 'sigma', h.sigma.toFixed(2), 'tau', h.tau.toFixed(2)); }
// residual shape
(function(){ const r = Hall.resid, n = r.length, m = r.reduce((a,b)=>a+b,0)/n; let s2=0,s3=0,s4=0; for (const x of r){const d=x-m; s2+=d*d; s3+=d*d*d; s4+=d*d*d*d;} s2/=n; console.log('residuals n=%d skew %s excess kurtosis %s', n, (s3/n/Math.pow(s2,1.5)).toFixed(3), (s4/n/(s2*s2)-3).toFixed(3)); })();

// ---------- 1. game win probabilities, forward only ----------
const models = {
  'coin flip': null,
  'season average, no shrinkage': { raw: true },
  'shrunk season average': {},
  'shrunk, recent weeks weighted (half-life 6)': { hl: 6 },
  'shrunk, recent weeks weighted (half-life 3)': { hl: 3 },
};
const rows = {}; for (const k in models) rows[k] = [];
const zs = [];
for (const y of [2024, 2025, 2026]) {
  const hyper = estimate(Object.keys(last).map(Number).filter(v => v < y));
  for (let t = 2; t <= last[y]; t++) {
    for (const g of data[y][t]) {
      if (g[2] === g[3]) continue;
      const win = g[2] > g[3] ? 1 : 0;
      for (const k in models) {
        let p = 0.5; const m = models[k];
        if (m) {
          const h = m.raw ? { sigma: hyper.sigma, tau: 1e6 } : hyper;
          const f = E.seasonForm(data[y], ids, t - 1, h, m.hl);
          p = E.winProb(f.shrunk[g[0]-1], f.shrunk[g[1]-1], hyper.sigma, f.v[g[0]-1], f.v[g[1]-1]);
          if (k === 'shrunk season average') zs.push(((g[2]-g[3]) - (f.shrunk[g[0]-1]-f.shrunk[g[1]-1])) / Math.sqrt(2*hyper.sigma*hyper.sigma + f.v[g[0]-1] + f.v[g[1]-1]));
        }
        rows[k].push([p, win, y, t]);
      }
    }
  }
}
function score(r) { let b = 0, ll = 0, acc = 0; for (const [p, w] of r) { b += (p-w)*(p-w); ll += -Math.log(w ? p : 1-p); acc += (p === 0.5 ? 0.5 : ((p > 0.5) === (w === 1) ? 1 : 0)); } return { n: r.length, brier: b / r.length, logloss: ll / r.length, acc: acc / r.length }; }
const gameScores = {};
console.log('\nGAME WIN PROBABILITY, forward-only (2024, 2025, 2026 to date)');
for (const k in rows) { const s = score(rows[k]); gameScores[k] = s; console.log('  %s  n=%d  Brier %s  logloss %s  favourite won %s%%', k.padEnd(46), s.n, s.brier.toFixed(4), s.logloss.toFixed(4), (100*s.acc).toFixed(1)); }
// paired difference vs coin flip for the chosen model, with a standard error
(function(){ const a = rows['shrunk season average'], d = a.map(([p,w]) => 0.25 - (p-w)*(p-w)); const m = d.reduce((x,y)=>x+y,0)/d.length; const sd = Math.sqrt(d.reduce((x,y)=>x+(y-m)*(y-m),0)/(d.length-1)); console.log('  Brier gain over coin flip: %s +/- %s (1 s.e.)', m.toFixed(4), (sd/Math.sqrt(d.length)).toFixed(4)); gameScores.gain = { mean: m, se: sd/Math.sqrt(d.length) }; })();
// calibration: fold to the favourite's side
const bins = [[0.5,0.55],[0.55,0.6],[0.6,0.7],[0.7,1.01]], calib = [];
for (const [lo, hi] of bins) { let n = 0, sp = 0, sw = 0; for (const [p, w] of rows['shrunk season average']) { const pf = Math.max(p, 1-p), wf = p >= 0.5 ? w : 1-w; if (pf >= lo && pf < hi) { n++; sp += pf; sw += wf; } } calib.push({ lo, hi, n, predicted: n ? sp/n : null, actual: n ? sw/n : null }); }
console.log('  calibration (favourite): ', calib.map(c => `${Math.round(c.lo*100)}-${Math.round(Math.min(c.hi,1)*100)}%: n=${c.n} said ${(100*c.predicted).toFixed(0)}% got ${(100*c.actual).toFixed(0)}%`).join(' | '));
// margin calibration
(function(){ const n = zs.length, m = zs.reduce((a,b)=>a+b,0)/n, sd = Math.sqrt(zs.reduce((a,b)=>a+(b-m)*(b-m),0)/(n-1)); const cov = q => zs.filter(z => Math.abs(z) < q).length / n; console.log('  margin z-scores: mean %s sd %s | inside 50%% band %s%%, 80%% band %s%%, 95%% band %s%%', m.toFixed(3), sd.toFixed(3), (100*cov(0.6745)).toFixed(0), (100*cov(1.2816)).toFixed(0), (100*cov(1.96)).toFixed(0)); gameScores.margin = { n, mean: m, sd, c50: cov(0.6745), c80: cov(1.2816), c95: cov(1.96) }; })();

// ---------- 2. playoff odds at checkpoints, parameters from the other seasons ----------
const pk = [], checkpoints = [3, 5, 7, 9, 11];
const perCp = {};
for (const y of [2023, 2024, 2025]) {
  const hyper = estimate([2023, 2024, 2025].filter(v => v !== y));
  const fin = E.standings(data[y], ids, 13), ord = E.seedOrder(fin.wins, fin.ties, fin.pf, fin.pa), made = new Set(ord.slice(0, 6));
  for (const t of checkpoints) {
    const st = E.standings(data[y], ids, t), f = E.seasonForm(data[y], ids, t, hyper);
    const games = [], rel = {};
    for (let w = t + 1; w <= 13; w++) { rel[w] = f.shrunk; for (const g of data[y][w]) games.push({ week: w, a: g[0]-1, b: g[1]-1 }); }
    for (const w of [14, 15, 16, 17]) rel[w] = f.shrunk;
    const cfg = { n: 12, wins: st.wins, ties: st.ties, pf: st.pf, pa: st.pa, games, rel, base: f.leagueMean, sigma: hyper.sigma, v: f.v, playoffTeams: 6 };
    const out = E.simulate(cfg, [], 20000, 1000 + y + t);
    const now = E.seedOrder(st.wins, st.ties, st.pf, st.pa), top = new Set(now.slice(0, 6));
    for (let i = 0; i < 12; i++) { const r = { y, t, p: out.playoff[i] / out.wsum, made: made.has(i) ? 1 : 0, naive: top.has(i) ? 1 : 0 }; pk.push(r); (perCp[t] = perCp[t] || []).push(r); }
  }
}
function br(r, key) { return r.reduce((s, x) => s + Math.pow((key ? x[key] : 0.5) - x.made, 2), 0) / r.length; }
console.log('\nPLAYOFF ODDS at checkpoints (2023-25, 180 team forecasts)');
const poSummary = { overall: { n: pk.length, model: br(pk, 'p'), standingsNow: br(pk, 'naive'), half: 0.25 }, byWeek: {} };
console.log('  overall Brier: model %s | "top six today make it" %s | everyone 50%% 0.2500', br(pk,'p').toFixed(4), br(pk,'naive').toFixed(4));
for (const t of checkpoints) { poSummary.byWeek[t] = { model: br(perCp[t], 'p'), standingsNow: br(perCp[t], 'naive') }; console.log('  after week %d: model %s | standings-now %s', t, br(perCp[t],'p').toFixed(4), br(perCp[t],'naive').toFixed(4)); }
const pbins = [[0,0.1],[0.1,0.3],[0.3,0.5],[0.5,0.7],[0.7,0.9],[0.9,1.001]], pcal = [];
for (const [lo, hi] of pbins) { const r = pk.filter(x => x.p >= lo && x.p < hi); pcal.push({ lo, hi, n: r.length, predicted: r.length ? r.reduce((s,x)=>s+x.p,0)/r.length : null, actual: r.length ? r.reduce((s,x)=>s+x.made,0)/r.length : null }); }
console.log('  calibration: ' + pcal.map(c => `${Math.round(c.lo*100)}-${Math.round(Math.min(c.hi,1)*100)}%: n=${c.n} said ${(100*c.predicted).toFixed(0)}% got ${(100*c.actual).toFixed(0)}%`).join(' | '));
fs.writeFileSync('data/backtest.json', JSON.stringify({ hyper: { sigma: Hall.sigma, tau: Hall.tau }, games: gameScores, gameCalib: calib, playoff: poSummary, playoffCalib: pcal }, null, 1));
