// End-to-end run of the real page code (next/js) against every surveyed live league, plus the shared projection files.
// Output is anonymous: settings, timings, invariant checks and error messages only.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { getJSON, anon, writeOut, pool, calls, hits } from './lib.mjs';
import { build, feedUrl, packWeek } from '../scripts/build_shared.mjs';
const require = createRequire(import.meta.url);
const C = require('../next/js/core.js'), E = require('../next/js/engine.js'), S = require('../next/js/sleeper.js'), M = require('../next/js/model.js');
const t0 = Date.now(), SEED = '1313270302943223808';
const ids = JSON.parse(fs.readFileSync('.labcache/survey_ids.json', 'utf8'));
const state = await getJSON(S.API + '/state/nfl', { ttlHours: 1 });
const season = Number(state.league_season || state.season), fromWeek = Math.max(1, state.week || 1);

// ---- shared projection files (public NFL data), also copied to the results for local work
const cached = url => getJSON(url, { ttlHours: 3 });
const { players, weeks } = await build('lab-out/shared', season, fromWeek, 18, cached);
fs.writeFileSync('lab-out/shared/meta.json', JSON.stringify({ season, week: state.week, seasonType: state.season_type, weeks, built: new Date().toISOString() }));
const shared = { players, weeks: {} };
for (const w of weeks) shared.weeks[w] = JSON.parse(fs.readFileSync(`lab-out/shared/proj_${season}_${w}.json`, 'utf8'));
const sizes = Object.fromEntries(fs.readdirSync('lab-out/shared').map(f => [f, fs.statSync('lab-out/shared/' + f).size]));
console.log('shared built', weeks.join(','), Object.keys(players).length, 'players', Math.round((Date.now() - t0) / 1000), 's');

// ---- the public seed league: a full raw pull for local page work (chat fields removed)
const get6 = url => getJSON(url, { ttlHours: 6 });
{
  const raw = await S.load(SEED, url => getJSON(url, { ttlHours: 1 }));
  for (const k of Object.keys(raw.league)) if (/^last_/.test(k)) delete raw.league[k];
  const hist = await S.loadHistory(raw, get6, 3);
  hist.forEach(h => { for (const k of Object.keys(h.league)) if (/^last_/.test(k)) delete h.league[k]; });
  writeOut('fixtures/seed_raw.json', JSON.stringify(raw)); writeOut('fixtures/seed_history.json', JSON.stringify(hist));
}

// ---- every live league through the real code
const live = ids.live26.concat(ids.fin25.slice(0, 60));       // finished seasons too: the "season over" path
const out = [], errs = [];
await pool(live, 6, async (id, k) => {
  const rec = { h: anon(id) }; let stage = 'load';
  try {
    const raw = await S.load(id, get6);
    stage = 'normalize'; const D = S.normalize(raw);
    rec.phase = D.phase; rec.n = D.n; rec.set = D.set && { P: D.set.P, med: D.set.median, div: D.set.nDiv, reseed: D.set.reseed, rt: D.set.roundType, type: D.set.type, bb: D.set.bestBall, slots: (D.set.slots || []).join(','), rounds: D.set.rounds, regEnd: D.set.regEnd, ovr: D.set.overridden };
    rec.bracket = D.bracketSource; rec.seedsMatch = D.seedsMatch; rec.recordsDiffer = !!D.recordsDiffer; rec.warn = D.warnings; rec.through = D.through; rec.scored = D.scored;
    if (D.phase === 'unsupported' || D.phase === 'pre') { rec.why = D.why; out.push(rec); return; }
    stage = 'history'; let rule = { nonPlayoff: 'maxpf', playoff: 'place' };
    if (D.set.type !== 'redraft' && k % 3 === 0) { const hist = await S.loadHistory(raw, get6, 2); const inf = M.inferDraftRule(hist); rec.rule = { np: inf.nonPlayoff, po: inf.playoff, br: inf.byRound, seasons: inf.seasons, npHit: inf.npHit, npSlots: inf.npSlots, poHit: inf.poHit, poSlots: inf.poSlots, known: inf.known }; if (inf.seasons) rule = inf; }
    stage = 'project'; const need = M.weeksNeeded(D); const t1 = Date.now(); const proj = M.projectWeeks(D, shared, need); rec.msProj = Date.now() - t1;
    stage = 'config'; const cfg = M.buildConfig(D, proj, { draft: rule });
    rec.mode = cfg.mode; rec.base = Math.round(cfg.base * 10) / 10; rec.sigma = Math.round(cfg.hyper.sigma * 10) / 10; rec.tau = Math.round(cfg.hyper.tau * 10) / 10; rec.games = cfg.games.length; rec.weeks = cfg.weeks.length;
    const w0 = need.find(w => proj[w]);
    if (w0 != null) { const tt = proj[w0].totals; rec.projMean = Math.round(tt.reduce((a, b) => a + b, 0) / tt.length * 10) / 10; rec.projMin = Math.round(Math.min(...tt) * 10) / 10; rec.projMax = Math.round(Math.max(...tt) * 10) / 10; rec.empty = proj[w0].lineups.reduce((a, l) => a + l.filter(s => s.id == null).length, 0); rec.fa = proj[w0].lineups.reduce((a, l) => a + l.filter(s => s.fa).length, 0); }
    stage = 'simulate'; const t2 = Date.now(); const N = 4000, res = E.simulate(cfg, [], N, 3); rec.msSim = Date.now() - t2; rec.msSim40k = Math.round(rec.msSim * 10);
    const sum = a => Array.from(a).reduce((x, y) => x + y, 0) / res.wsum, bad = [];
    const P = Math.min(D.set.P, D.n), nb = res.byeSeeds.length;
    if (Math.abs(sum(res.playoff) - P) > 1e-6) bad.push('playoff sum ' + sum(res.playoff));
    if (Math.abs(sum(res.champ) - 1) > 1e-6) bad.push('champ sum ' + sum(res.champ));
    if (Math.abs(sum(res.fin) - 2) > 1e-6 && P > 1) bad.push('final sum ' + sum(res.fin));
    if (Math.abs(sum(res.bye) - nb) > 1e-6) bad.push('bye sum ' + sum(res.bye));
    for (let i = 0; i < D.n; i++) { if (res.slotDist && Math.abs(Array.from(res.slotDist[i]).reduce((x, y) => x + y, 0) / res.wsum - 1) > 1e-6) bad.push('slot row ' + i); if ([res.playoff[i], res.champ[i], res.pfSum[i]].some(x => !isFinite(x))) bad.push('nan ' + i); }
    if (res.slotDist) for (let j = 0; j < D.n; j++) { let c = 0; for (let i = 0; i < D.n; i++) c += res.slotDist[i][j]; if (Math.abs(c / res.wsum - 1) > 1e-6) { bad.push('slot col ' + j); break; } }
    stage = 'picks'; if (cfg.games.length) { const pk = cfg.games.map((g, i) => i % 3 === 0 ? 1 : i % 5 === 0 ? 2 : 0); const r2 = E.simulate(cfg, pk, 1500, 4); if (!(r2.ess > 0) || !isFinite(r2.wsum)) bad.push('picks ess ' + r2.ess); rec.ess = Math.round(r2.ess); }
    stage = 'clinch'; const t3 = Date.now(); const cl = E.clinch(cfg, [], P); rec.msClinch = Date.now() - t3; rec.clinch = cl.method; rec.nClinched = cl.clinched.filter(Boolean).length; rec.nElim = cl.eliminated.filter(Boolean).length;
    // a sure thing must never disagree with the simulation
    for (let i = 0; i < D.n; i++) { if (cl.clinched[i] && res.playoff[i] / res.wsum < 0.999999) bad.push('clinched but sim ' + res.playoff[i] / res.wsum); if (cl.eliminated[i] && res.playoff[i] > 0) bad.push('eliminated but sim ' + res.playoff[i] / res.wsum); }
    rec.bad = bad; rec.top = Math.round(1000 * Math.max(...Array.from(res.champ)) / res.wsum) / 10;
    out.push(rec);
  } catch (e) { rec.stage = stage; rec.error = String(e && e.stack || e).slice(0, 600); errs.push(rec); out.push(rec); }
});
const tally = (f) => out.reduce((m, r) => { const k = String(f(r)); m[k] = (m[k] || 0) + 1; return m; }, {});
const ms = out.filter(r => r.msSim40k).map(r => r.msSim40k).sort((a, b) => a - b);
const summary = { when: new Date().toISOString(), leagues: out.length, errors: errs.length, withBad: out.filter(r => r.bad && r.bad.length).length, phase: tally(r => r.phase), mode: tally(r => r.mode), bracket: tally(r => r.bracket), seedsMatch: tally(r => r.seedsMatch), recordsDiffer: tally(r => r.recordsDiffer),
  clinch: tally(r => r.clinch), rule: tally(r => r.rule ? r.rule.np + '/' + r.rule.po + (r.rule.known ? '' : ' (unsure)') + ' s' + r.rule.seasons : '-'), sim40kMs: { median: ms[ms.length >> 1], p90: ms[Math.floor(ms.length * 0.9)], max: ms[ms.length - 1] }, sharedSizes: sizes, calls, hits, secs: Math.round((Date.now() - t0) / 1000) };
writeOut('e2e.json', { summary, errors: errs, bad: out.filter(r => r.bad && r.bad.length), leagues: out });
console.log('e2e done', JSON.stringify({ leagues: out.length, errors: errs.length, bad: summary.withBad, phase: summary.phase, sim: summary.sim40kMs }));
