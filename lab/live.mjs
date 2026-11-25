// Checks the "week under way" logic on real finished weeks: freeze each week after each day of games,
// work out every matchup's win chance from points banked plus what is still projected, and compare with how it ended.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { getJSON, writeOut, pool } from './lib.mjs';
import { feedUrl, packWeek } from '../scripts/build_shared.mjs';
const require = createRequire(import.meta.url);
const C = require('../next/js/core.js'), S = require('../next/js/sleeper.js'), M = require('../next/js/model.js');
const ids = JSON.parse(fs.readFileSync('.labcache/survey_ids.json', 'utf8')), season = 2026, WEEKS = [6, 7, 8, 9, 10, 11];
const sched = await getJSON(`https://api.sleeper.app/schedule/nfl/regular/${season}`, { ttlHours: 6 });
const players = {}, packs = {}, days = {};
for (const w of WEEKS) { packs[w] = packWeek(await getJSON(feedUrl('projections', season, w), { ttlHours: 6 }), players); days[w] = [...new Set(sched.filter(g => g.week === w).map(g => g.date))].sort(); }
const dateOf = {}; sched.forEach(g => { dateOf[g.week + ':' + g.home] = g.date; dateOf[g.week + ':' + g.away] = g.date; });
const rows = [];     // [stage (share of the week's game days done), p, outcome, pNoLive]
await pool(ids.live26.slice(0, 200), 5, async id => {
  const L = await getJSON(`${S.API}/league/${id}`, { ttlHours: 72 }); if (!L || !L.settings || !L.settings.playoff_teams || L.settings.type === 3 || L.settings.best_ball === 1) return;
  const rosters = await getJSON(`${S.API}/league/${id}/rosters`, { ttlHours: 6 }); if (!rosters) return;
  const D = { n: rosters.length, teams: rosters.map(r => ({ rid: r.roster_id })), set: { scoring: L.scoring_settings || {} } }, idx = {}; D.teams.forEach((t, k) => { idx[t.rid] = k; });
  const hist = [];
  for (let w = 1; w <= 11; w++) {
    const m = await getJSON(`${S.API}/league/${id}/matchups/${w}`, { ttlHours: 6 }); if (!m || !m.length) continue;
    const final = new Array(D.n).fill(0), by = {}; m.forEach(x => { final[idx[x.roster_id]] = x.custom_points != null ? x.custom_points : x.points || 0; if (x.matchup_id != null) (by[x.matchup_id] = by[x.matchup_id] || []).push(idx[x.roster_id]); });
    if (WEEKS.includes(w) && hist.length >= 4) {
      const base = hist.flat().reduce((a, b) => a + b, 0) / hist.flat().length, sigma = 20.1 * Math.pow(Math.max(base, 20) / 100, 0.71);
      for (let k = 0; k < days[w].length; k++) {
        const cut = days[w][k], statusOf = team => { const d = dateOf[w + ':' + team]; return d == null ? null : d <= cut ? 'done' : 'pre'; };
        const live = M.liveWeek(D, m, packs[w], players, statusOf, w); if (!live) continue;
        const meanFull = live.full.reduce((a, b) => a + b, 0) / D.n;
        for (const pair of Object.values(by)) {
          if (pair.length !== 2) continue; const [a, b] = pair; if (final[a] === final[b]) continue;
          const fullA = base + 0.97 * (live.full[a] - meanFull), fullB = base + 0.97 * (live.full[b] - meanFull);
          const mA = live.banked[a] + live.share[a] * fullA, mB = live.banked[b] + live.share[b] * fullB, v = sigma * sigma * (live.share[a] + live.share[b]);
          const p = v > 0 ? C.normCdf((mA - mB) / Math.sqrt(v)) : mA > mB ? 1 : mA < mB ? 0 : 0.5;
          rows.push([k + 1 === days[w].length ? 'all games done' : k === 0 ? 'after the first day' : 'after day ' + (k + 1), p, final[a] > final[b] ? 1 : 0, C.normCdf((fullA - fullB) / Math.sqrt(2 * sigma * sigma))]);
        }
      }
    }
    hist.push(final.filter(x => x > 0));
  }
});
const out = {};
for (const stage of [...new Set(rows.map(r => r[0]))]) {
  const R = rows.filter(r => r[0] === stage), brier = R.reduce((s, r) => s + (r[1] - r[2]) ** 2, 0) / R.length, brier0 = R.reduce((s, r) => s + (r[3] - r[2]) ** 2, 0) / R.length;
  const bins = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 0.97], [0.97, 1.0001]].map(([lo, hi]) => { const sel = R.filter(r => Math.max(r[1], 1 - r[1]) >= lo && Math.max(r[1], 1 - r[1]) < hi); return { range: `${Math.round(lo * 100)}-${Math.round(Math.min(hi, 1) * 100)}%`, n: sel.length, said: sel.length ? Math.round(1000 * sel.reduce((s, r) => s + Math.max(r[1], 1 - r[1]), 0) / sel.length) / 10 : null, got: sel.length ? Math.round(1000 * sel.reduce((s, r) => s + (r[1] >= 0.5 ? r[2] : 1 - r[2]), 0) / sel.length) / 10 : null }; });
  out[stage] = { games: R.length, brier: Math.round(brier * 1e4) / 1e4, brierIgnoringLiveScores: Math.round(brier0 * 1e4) / 1e4, bins };
}
writeOut('live.json', out);
console.log('live check done:', rows.length, 'game snapshots', JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [v.games, v.brier, v.brierIgnoringLiveScores]]))));
