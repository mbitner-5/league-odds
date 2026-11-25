// Research data for fitting the strength model: for real leagues, every team's weekly score next to the projected
// best lineup it could have fielded that week. Also checks the scoring code against Sleeper's own player points.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { getJSON, anon, writeOut, pool, calls, hits } from './lib.mjs';
import { feedUrl, packWeek } from '../scripts/build_shared.mjs';
const require = createRequire(import.meta.url);
const C = require('../next/js/core.js'), S = require('../next/js/sleeper.js');
const t0 = Date.now(), ids = JSON.parse(fs.readFileSync('.labcache/survey_ids.json', 'utf8'));
const MAX25 = Number(process.env.FIT_2025 || 230);

async function feed(kind, season, week) { return getJSON(feedUrl(kind, season, week), { ttlHours: season < 2026 ? 0 : 6 }); }
const projCache = {}, statCache = {}, playersBySeason = { 2025: {}, 2026: {} };
async function projWeek(season, w) { const k = season + ':' + w; if (!projCache[k]) projCache[k] = packWeek(await feed('projections', season, w), playersBySeason[season]); return projCache[k]; }
async function statWeek(season, w) { const k = season + ':' + w; if (!statCache[k]) { const m = {}; for (const e of (await feed('stats', season, w)) || []) m[e.player_id] = { stats: e.stats || {}, pos: (e.player && e.player.fantasy_positions) || [] }; statCache[k] = m; } return statCache[k]; }

const leagues = [], rows = [];
const check = { players: 0, exact: 0, byPos: {}, missKeys: {}, leaguesAllExact: 0, leagues: 0, examples: [] };
async function doLeague(id, season, lastWeek, checkWeek) {
  const L = await getJSON(`${S.API}/league/${id}`, { ttlHours: 72 }); if (!L || !L.settings) return;
  const s = L.settings, sc = L.scoring_settings || {}, slots = C.starterSlots(L.roster_positions);
  if (!s.playoff_teams || !s.playoff_week_start || s.type === 3) return;
  const regEnd = Math.min(lastWeek, s.playoff_week_start - 1), li = leagues.length;
  leagues.push({ h: anon(id), season, n: s.num_teams, med: s.league_average_match || 0, bb: s.best_ball || 0, type: s.type, nslots: slots.length, sf: slots.includes('SUPER_FLEX') || slots.filter(x => x === 'QB').length > 1 ? 1 : 0, idp: slots.some(x => /DL|LB|DB|IDP/.test(x)) ? 1 : 0, k: slots.includes('K') ? 1 : 0, def: slots.includes('DEF') ? 1 : 0 });
  for (let w = s.start_week || 1; w <= regEnd; w++) {
    const m = await getJSON(`${S.API}/league/${id}/matchups/${w}`, { ttlHours: season < 2026 ? 0 : 6 }); if (!m || !m.length) continue;
    const pk = await projWeek(season, w), dir = playersBySeason[season], pts = {};
    const score = pid => { if (pts[pid] !== undefined) return pts[pid]; const row = pk.p[pid]; if (!row) return (pts[pid] = 0); const st = {}; for (let k = 0; k < row.length; k += 2) st[pk.keys[row[k]]] = row[k + 1]; return (pts[pid] = Math.max(0, C.projectPoints(st, sc, dir[pid] ? dir[pid][3] : null))); };
    const byM = {}; m.forEach(x => { if (x.matchup_id != null) (byM[x.matchup_id] = byM[x.matchup_id] || []).push(x.roster_id); });
    const opp = {}; Object.values(byM).forEach(p => { if (p.length === 2) { opp[p[0]] = p[1]; opp[p[1]] = p[0]; } });
    for (const x of m) {
      if (opp[x.roster_id] == null) continue;
      const cand = (x.players || []).map(pid => ({ id: pid, pos: dir[pid] ? dir[pid][3] : [], pts: score(pid) })).filter(c => c.pts > 0 && c.pos.length);
      const best = C.bestLineup(slots, cand);
      const started = (x.starters || []).reduce((a, pid) => a + (pid && pid !== '0' ? score(pid) : 0), 0);
      rows.push([li, w, x.roster_id, Math.round((x.custom_points != null ? x.custom_points : x.points || 0) * 100) / 100, Math.round(best.total * 100) / 100, opp[x.roster_id], Math.round(started * 100) / 100]);
    }
    // scoring check: our points from the stat feed vs Sleeper's own player points
    if (w === checkWeek) {
      const stats = await statWeek(season, w); let all = true, any = false;
      for (const x of m) for (const pid in (x.players_points || {})) {
        const theirs = x.players_points[pid], st = stats[pid]; if (!st || theirs == null) continue;
        const mine = C.scoreStats(st.stats, sc), pos = st.pos[0] || '?', ok = Math.abs(mine - theirs) < 0.011; any = true;
        check.players++; check.byPos[pos] = check.byPos[pos] || [0, 0]; check.byPos[pos][1]++;
        if (ok) { check.exact++; check.byPos[pos][0]++; } else { all = false; for (const k in st.stats) if (sc[k]) check.missKeys[k] = (check.missKeys[k] || 0) + 1; if (check.examples.length < 25) check.examples.push({ pos, mine: Math.round(mine * 100) / 100, theirs, scored: Object.fromEntries(Object.entries(st.stats).filter(([k]) => sc[k]).map(([k, v]) => [k, [v, sc[k]]])) }); }
      }
      if (any) { check.leagues++; if (all) check.leaguesAllExact++; }
    }
  }
}
await pool(ids.live26, 5, id => doLeague(id, 2026, 11, 11));
console.log('2026 rows', rows.length, Math.round((Date.now() - t0) / 1000), 's');
await pool(ids.fin25.slice(0, MAX25), 5, id => doLeague(id, 2025, 14, 10));
writeOut('fit_rows.json', JSON.stringify({ leagues, rows }));
writeOut('scoring_check.json', check);
console.log('fit done: leagues', leagues.length, 'rows', rows.length, 'scoring exact', check.exact, '/', check.players, 'calls', calls, 'hits', hits, Math.round((Date.now() - t0) / 1000), 's');
