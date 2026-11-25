// Builds the shared player-projection files the page reads: one small file per NFL week still to play,
// plus a player directory. Source: Sleeper's projections feed. Usage: node scripts/build_shared.mjs <outDir> [season] [fromWeek]
import fs from 'node:fs';
import path from 'node:path';

const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
const DROP = /^(adp_|pos_adp_|pts_|gp$|gs$|gms_active$|cmp_pct$|pos_rank_|tm_|off_snp$|def_snp$|st_snp$)/;
export const feedUrl = (kind, season, week) => `https://api.sleeper.app/${kind}/nfl/${season}/${week}?season_type=regular&${POS.map(p => 'position[]=' + p).join('&')}&order_by=pts_ppr`;

async function getJSON(url, tries = 4) {
  for (let a = 0; ; a++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'league-odds (github.com/mbitner-5/league-odds)', Accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    catch (e) { if (a >= tries - 1) throw e; await new Promise(r => setTimeout(r, 1500 * (a + 1))); }
  }
}
// one week of the feed -> { keys: [...], p: { playerId: [keyIndex, value, ...] } }, and fills the player directory
export function packWeek(list, players) {
  const keys = [], keyIdx = {}, p = {};
  for (const e of list || []) {
    const st = e.stats || {}, row = [];
    for (const k in st) { const v = st[k]; if (!v || DROP.test(k) || typeof v !== 'number') continue; if (keyIdx[k] == null) { keyIdx[k] = keys.length; keys.push(k); } row.push(keyIdx[k], Math.round(v * 100) / 100); }
    if (!row.length) continue;
    p[e.player_id] = row;
    const pl = e.player || {};
    if (players && !players[e.player_id]) players[e.player_id] = [[pl.first_name, pl.last_name].filter(Boolean).join(' ') || String(e.player_id), pl.position || '', e.team || pl.team || '', pl.fantasy_positions || (pl.position ? [pl.position] : [])];
  }
  return { keys, p };
}
export async function build(outDir, season, fromWeek, toWeek = 18, fetcher = getJSON) {
  fs.mkdirSync(outDir, { recursive: true });
  const players = {}, weeks = [];
  for (let w = fromWeek; w <= toWeek; w++) {
    const list = await fetcher(feedUrl('projections', season, w));
    const packed = packWeek(list, players);
    if (Object.keys(packed.p).length < 50) continue;            // nothing useful published for this week yet
    fs.writeFileSync(path.join(outDir, `proj_${season}_${w}.json`), JSON.stringify(packed));
    weeks.push(w);
  }
  fs.writeFileSync(path.join(outDir, `players_${season}.json`), JSON.stringify(players));
  return { players, weeks };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] || 'dist/next/data';
  const state = await getJSON('https://api.sleeper.app/v1/state/nfl');
  const season = Number(process.argv[3] || state.league_season || state.season), from = Number(process.argv[4] || Math.max(1, state.week || 1));
  const { players, weeks } = await build(outDir, season, from);
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ season, week: state.week, seasonType: state.season_type, weeks, built: new Date().toISOString() }));
  const bytes = fs.readdirSync(outDir).reduce((s, f) => s + fs.statSync(path.join(outDir, f)).size, 0);
  console.log(`shared data: season ${season}, weeks ${weeks.join(',')}, ${Object.keys(players).length} players, ${(bytes / 1e6).toFixed(2)} MB`);
  if (!weeks.length) process.exit(1);
}
