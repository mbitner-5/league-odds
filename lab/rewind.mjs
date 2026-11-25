// Replays finished 2025 seasons from the middle of their playoffs, the way Sleeper would have shown them that week,
// and checks the page's playoff logic at every step. Anonymous output.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { getJSON, anon, writeOut, pool } from './lib.mjs';
const require = createRequire(import.meta.url);
const C = require('../next/js/core.js'), E = require('../next/js/engine.js'), S = require('../next/js/sleeper.js'), M = require('../next/js/model.js');
const ids = JSON.parse(fs.readFileSync('.labcache/survey_ids.json', 'utf8')), get = url => getJSON(url, { ttlHours: 0 });
const MAX = Number(process.env.REWIND || 140), out = [], errs = [];

// the bracket as Sleeper lists it once the playoffs have reached `week` (results after that week unknown)
export function rewind(raw, week) {
  const r = JSON.parse(JSON.stringify(raw)), s = r.league.settings, D0 = S.normalize(raw);
  r.league.status = 'in_season'; s.last_scored_leg = week; s.leg = week;
  const rounds = D0.set.rounds, doneRound = rr => rounds[rr - 1] && rounds[rr - 1].every(w => w <= week);
  const reseed = s.playoff_seed_type === 1;
  for (const br of [r.winners, r.losers]) for (const g of br || []) {
    if (doneRound(g.r)) continue;
    g.w = null; g.l = null;
    for (const side of ['t1', 't2']) {
      const from = g[side + '_from'];
      if (from) { const src = (br || []).find(x => x.m === (from.w != null ? from.w : from.l)); if (!src || !doneRound(src.r)) g[side] = null; }
      else if (g.r > 1 && reseed && !doneRound(g.r - 1)) { /* re-seeded later rounds list only the bye teams until the round before is done */ const bye = !(br || []).some(x => x.r < g.r && (x.t1 === g[side] || x.t2 === g[side])); if (!bye) g[side] = null; }
    }
  }
  for (let w = week + 1; w <= 18; w++) (r.matchups[w] || []).forEach(m => { m.points = 0; m.custom_points = null; m.players_points = {}; m.starters_points = []; });
  return r;
}

await pool(ids.fin25.slice(60, 60 + MAX), 5, async id => {
  const rec = { h: anon(id), steps: [] };
  try {
    const raw = await S.load(id, get), D = S.normalize(raw);
    if (D.phase !== 'done' || !raw.winners.length) { rec.skip = D.phase; out.push(rec); return; }
    const champRow = raw.winners.find(g => g.p === 1); if (!champRow || champRow.w == null) { rec.skip = 'no champion'; out.push(rec); return; }
    const idx = {}; D.teams.forEach((t, k) => { idx[t.rid] = k; });
    const champ = idx[champRow.w], weeks = D.set.rounds.flat();
    rec.set = { P: D.set.P, reseed: D.set.reseed, rt: D.set.roundType, div: D.set.nDiv, med: D.set.median, ovr: D.set.overridden, n: D.n };
    // final answer first: with everything known the champion must be certain
    const full = E.simulate(M.buildConfig(D, null, { draft: { nonPlayoff: 'maxpf', playoff: 'place' } }), [], 200, 1);
    if (Math.abs(full.champ[champ] / full.wsum - 1) > 1e-9) rec.steps.push({ week: 'final', bad: 'champion not certain: ' + full.champ[champ] / full.wsum });
    for (const week of [D.set.regEnd, ...weeks.slice(0, -1)]) {
      const r2 = rewind(raw, week), D2 = S.normalize(r2), step = { week: week - D.set.regEnd, phase: D2.phase };
      const cfg = M.buildConfig(D2, null, { draft: { nonPlayoff: 'maxpf', playoff: 'place' } }), res = E.simulate(cfg, [], 3000, 2);
      const sum = a => Array.from(a).reduce((x, y) => x + y, 0) / res.wsum, bad = [];
      if (Math.abs(sum(res.champ) - 1) > 1e-9) bad.push('champ sum ' + sum(res.champ));
      if (Math.abs(sum(res.playoff) - Math.min(D.set.P, D.n)) > 1e-9) bad.push('playoff sum ' + sum(res.playoff));
      if (!(res.champ[champ] > 0)) bad.push('the real champion was given no chance');
      // teams that had really lost a title game by then must be at zero
      const alive = new Set((D.fixed.seeds || []).map(Number));
      for (const g of raw.winners.slice().sort((a, b) => a.r - b.r)) { const rw = D.set.rounds[g.r - 1] || []; if (rw.length && rw.every(w => w <= week) && g.l != null && alive.has(idx[g.w]) && alive.has(idx[g.l])) alive.delete(idx[g.l]); }
      for (let i = 0; i < D.n; i++) if (!alive.has(i) && res.champ[i] > 0) { bad.push('an eliminated team still has title odds'); break; }
      step.champP = Math.round(1000 * res.champ[champ] / res.wsum) / 10; step.alive = alive.size; step.partial = Object.keys((D2.fixed && D2.fixed.partial) || {}).length; step.done = Object.keys((D2.fixed && D2.fixed.done) || {}).length;
      if (bad.length) step.bad = bad;
      rec.steps.push(step);
    }
    out.push(rec);
  } catch (e) { rec.error = String(e && e.stack || e).slice(0, 500); errs.push(rec); out.push(rec); }
});
const steps = out.flatMap(r => r.steps || []), bad = out.filter(r => (r.steps || []).some(s => s.bad));
// how often did the eventual champion get what the model gave it? (average chance given, by stage)
const byStage = {}; steps.forEach(s => { if (typeof s.week !== 'number') return; (byStage[s.week] = byStage[s.week] || []).push(s.champP); });
writeOut('rewind.json', { leagues: out.length, errors: errs.length, withBad: bad.length, steps: steps.length, champChanceByStage: Object.fromEntries(Object.entries(byStage).map(([k, v]) => [k, { n: v.length, mean: Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 }])), errs, bad, sample: out.slice(0, 5) });
console.log('rewind done: leagues', out.length, 'errors', errs.length, 'bad', bad.length, 'steps', steps.length);
