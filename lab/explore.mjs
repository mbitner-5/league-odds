// Phase A: what do the public APIs allow, what do real leagues look like, and raw fixtures for one public league.
import { getJSON, anon, S, tally, shape, writeOut, pool, calls, hits } from './lib.mjs';

const SEED = '1313270302943223808';     // the repo's own league (already public here)
const out = { when: new Date().toISOString() };

// ---- 1. Can a web page on another site read these APIs? (the Access-Control-Allow-Origin header decides)
async function cors(url, extra = {}) {
  try {
    const r = await fetch(url, { headers: { Origin: 'https://mbitner-5.github.io', 'User-Agent': 'Mozilla/5.0', ...extra } });
    const text = await r.text();
    return { status: r.status, acao: r.headers.get('access-control-allow-origin'), type: r.headers.get('content-type'), bytes: text.length, head: text.slice(0, 120) };
  } catch (e) { return { error: String(e.message || e) }; }
}
out.cors = {
  sleeper_league: await cors(`${S}/league/${SEED}`),
  sleeper_user: await cors(`${S}/user/sleeper`),
  sleeper_state: await cors(`${S}/state/nfl`),
  sleeper_projections: await cors('https://api.sleeper.app/projections/nfl/2026/12?season_type=regular&position[]=QB&order_by=pts_ppr'),
  sleeper_projections_com: await cors('https://api.sleeper.com/projections/nfl/2026/12?season_type=regular&position[]=QB&order_by=pts_ppr'),
  sleeper_stats: await cors('https://api.sleeper.app/stats/nfl/2025/5?season_type=regular&position[]=QB&order_by=pts_ppr'),
  sleeper_schedule: await cors('https://api.sleeper.app/schedule/nfl/regular/2026'),
  sleeper_players: await (async () => { const r = await cors(`${S}/players/nfl`); delete r.head; return r; })(),
  espn_league: await cors('https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/1?view=mSettings'),
  espn_league_old: await cors('https://fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/1?view=mSettings'),
  mfl_league: await cors('https://api.myfantasyleague.com/2025/export?TYPE=league&L=10000&JSON=1'),
  mfl_players: await (async () => { const r = await cors('https://api.myfantasyleague.com/2025/export?TYPE=players&DETAILS=1&JSON=1'); return r; })(),
  fleaflicker: await cors('https://www.fleaflicker.com/api/FetchLeagueStandings?sport=NFL&league_id=1'),
  yahoo: await cors('https://fantasysports.yahooapis.com/fantasy/v2/league/nfl.l.1?format=json'),
};

// ---- 2. Raw fixtures for the seed league and its earlier seasons (public already), for local tests
const fx = {};
async function dumpLeague(id, tag) {
  const L = await getJSON(`${S}/league/${id}`, { ttlHours: 1 }); if (!L) return null;
  const last = Math.max(17, (L.settings.playoff_week_start || 15) + 3);
  const pack = { league: L, users: await getJSON(`${S}/league/${id}/users`, { ttlHours: 1 }), rosters: await getJSON(`${S}/league/${id}/rosters`, { ttlHours: 1 }),
    winners_bracket: await getJSON(`${S}/league/${id}/winners_bracket`, { ttlHours: 1 }), losers_bracket: await getJSON(`${S}/league/${id}/losers_bracket`, { ttlHours: 1 }),
    traded_picks: await getJSON(`${S}/league/${id}/traded_picks`, { ttlHours: 1 }), drafts: await getJSON(`${S}/league/${id}/drafts`, { ttlHours: 1 }), matchups: {} };
  for (let w = 1; w <= Math.min(18, last); w++) pack.matchups[w] = await getJSON(`${S}/league/${id}/matchups/${w}`, { ttlHours: 1 });
  if (pack.drafts && pack.drafts[0]) pack.draft0 = await getJSON(`${S}/draft/${pack.drafts[0].draft_id}`, { ttlHours: 1 });
  writeOut(`fixtures/${tag}.json`, JSON.stringify(pack));
  return pack;
}
let id = SEED, chainIds = [];
for (let k = 0; k < 5 && id; k++) { const p = await dumpLeague(id, 'seed_' + k); if (!p) break; chainIds.push([p.league.season, p.league.status]); fx[k] = p; id = p.league.previous_league_id; }
out.seedChain = chainIds;
out.state = await getJSON(`${S}/state/nfl`, { ttlHours: 1 });
writeOut('fixtures/state.json', JSON.stringify(out.state));
const sched = await getJSON('https://api.sleeper.app/schedule/nfl/regular/2026', { ttlHours: 1 });
writeOut('fixtures/schedule_2026.json', JSON.stringify(sched));
out.schedule = { n: sched && sched.length, shape: shape(sched || []), statuses: (sched || []).reduce((m, g) => (tally(m, g.status), m), {}) };

// ---- 3. Shapes: which keys exist on each object
const p0 = fx[0];
out.shapes = {
  league: Object.keys(p0.league), league_settings: p0.league.settings, league_metadata: p0.league.metadata,
  roster: shape(p0.rosters), roster_settings: shape(p0.rosters.map(r => r.settings)), roster_metadata_keys: [...new Set(p0.rosters.flatMap(r => Object.keys(r.metadata || {}).filter(k => !k.startsWith('p_nick'))))],
  user: shape(p0.users), user_metadata: shape(p0.users.map(u => u.metadata)),
  matchup: shape(p0.matchups[11] || []), bracket: shape([...(p0.winners_bracket || []), ...(p0.losers_bracket || [])]),
  traded_pick: shape(p0.traded_picks || []), draft: shape(p0.drafts || []), draft_settings: (p0.drafts || [])[0] && p0.drafts[0].settings, draft_full_keys: p0.draft0 && Object.keys(p0.draft0),
  draft_order_sample: p0.draft0 && { type: p0.draft0.type, status: p0.draft0.status, season: p0.draft0.season, has_order: !!p0.draft0.draft_order, slot_to_roster_id: p0.draft0.slot_to_roster_id },
  prev_draft: fx[1] && fx[1].draft0 && { type: fx[1].draft0.type, settings: fx[1].draft0.settings, slot_to_roster_id: fx[1].draft0.slot_to_roster_id, season: fx[1].draft0.season },
  seed_roster0_settings: p0.rosters[0].settings, seed_roster0_meta: Object.fromEntries(Object.entries(p0.rosters[0].metadata || {}).filter(([k]) => !k.startsWith('p_nick'))),
};

// ---- 4. Projections and actual stats: keys by position, and whether a plain dot product reproduces Sleeper's own totals
const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
async function statFeed(kind, season, week) {
  const q = POS.map(p => 'position[]=' + p).join('&');
  return await getJSON(`https://api.sleeper.app/${kind}/nfl/${season}/${week}?season_type=regular&${q}&order_by=pts_ppr`, { ttlHours: season < 2026 ? 0 : 3 });
}
function feedSummary(list) {
  const by = {};
  for (const e of list || []) {
    const pos = (e.player && e.player.position) || '?'; const b = by[pos] = by[pos] || { n: 0, withPts: 0, keys: {}, example: null, fpos: {} };
    b.n++; const st = e.stats || {}; if (st.pts_ppr > 0 || st.pts_std > 0 || st.pts_idp > 0) b.withPts++;
    for (const k in st) tally(b.keys, k);
    for (const f of (e.player && e.player.fantasy_positions) || []) tally(b.fpos, f);
    if (!b.example && (st.pts_ppr > 5 || st.pts_idp > 5 || pos === 'DEF')) b.example = { stats: st, player: e.player, top: Object.keys(e).filter(k => k !== 'stats' && k !== 'player').reduce((m, k) => (m[k] = e[k], m), {}) };
  }
  return by;
}
const proj12 = await statFeed('projections', 2026, 12), proj17 = await statFeed('projections', 2026, 17), proj25 = await statFeed('projections', 2025, 5), stats25 = await statFeed('stats', 2025, 5);
out.feeds = { proj_2026_12: feedSummary(proj12), proj_2026_17_counts: Object.fromEntries(Object.entries(feedSummary(proj17)).map(([k, v]) => [k, [v.n, v.withPts]])),
  proj_2025_5_counts: Object.fromEntries(Object.entries(feedSummary(proj25)).map(([k, v]) => [k, [v.n, v.withPts]])), stats_2025_5: feedSummary(stats25), totals: { proj12: (proj12 || []).length, proj25: (proj25 || []).length, stats25: (stats25 || []).length } };

// ---- 5. Crawl: leagues of the seed league's members and of their league-mates. Only anonymous settings are kept.
const users = new Map(), leagues = new Map();
for (const u of p0.users) users.set(u.user_id, 0);
async function leaguesOf(uid) { const a = [], b = []; for (const season of [2026, 2025]) { const l = await getJSON(`${S}/user/${uid}/leagues/nfl/${season}`, { ttlHours: 24 }); for (const x of l || []) (season === 2026 ? a : b).push(x); } return [...a, ...b]; }
async function hop(depth, maxUsers) {
  const ids = [...users.entries()].filter(([, d]) => d === depth).map(([u]) => u).slice(0, maxUsers);
  const res = await pool(ids, 6, leaguesOf);
  for (const list of res) for (const L of Array.isArray(list) ? list : []) if (!leagues.has(L.league_id)) leagues.set(L.league_id, L);
}
await hop(0, 20);
// second hop: members of a sample of those leagues
const sample = [...leagues.values()].filter(L => L.season === '2026').slice(0, 40);
const mem = await pool(sample, 6, L => getJSON(`${S}/league/${L.league_id}/users`, { ttlHours: 24 }));
for (const list of mem) for (const u of Array.isArray(list) ? list : []) if (!users.has(u.user_id)) users.set(u.user_id, 1);
await hop(1, 150);

const agg = { n: leagues.size, users: users.size, bySeason: {}, status: {}, num_teams: {}, playoff_teams: {}, playoff_week_start: {}, playoff_round_type: {}, playoff_seed_type: {}, playoff_type: {}, league_average_match: {}, divisions: {}, type: {}, best_ball: {}, start_week: {}, draft_rounds: {}, slots: {}, lineup: {}, settingsKeys: {}, scoringNonZero: {}, sport: {}, season_type: {}, combos: {}, metaKeys: {} };
const anonLeagues = [];
for (const L of leagues.values()) {
  const s = L.settings || {};
  tally(agg.bySeason, L.season); tally(agg.status, L.season + ':' + L.status); tally(agg.sport, L.sport); tally(agg.season_type, L.season_type);
  for (const k of ['num_teams', 'playoff_teams', 'playoff_week_start', 'playoff_round_type', 'playoff_seed_type', 'playoff_type', 'league_average_match', 'divisions', 'type', 'best_ball', 'start_week', 'draft_rounds']) tally(agg[k], s[k]);
  for (const k in s) tally(agg.settingsKeys, k);
  for (const k in (L.metadata || {})) tally(agg.metaKeys, k.replace(/\d+/g, '#'));
  const starters = (L.roster_positions || []).filter(p => p !== 'BN'); for (const p of new Set(starters)) tally(agg.slots, p);
  tally(agg.lineup, starters.slice().sort().join(','));
  for (const k in (L.scoring_settings || {})) if (L.scoring_settings[k]) tally(agg.scoringNonZero, k);
  tally(agg.combos, `P${s.playoff_teams}/N${s.num_teams}/rt${s.playoff_round_type}/st${s.playoff_seed_type}/pt${s.playoff_type}/med${s.league_average_match}/div${s.divisions || 0}`);
  anonLeagues.push({ h: anon(L.league_id), season: L.season, status: L.status, s: { n: s.num_teams, P: s.playoff_teams, pws: s.playoff_week_start, rt: s.playoff_round_type, st: s.playoff_seed_type, pt: s.playoff_type, med: s.league_average_match, div: s.divisions, type: s.type, bb: s.best_ball, sw: s.start_week, leg: s.leg, lsl: s.last_scored_leg, dr: s.draft_rounds }, slots: starters.length, prev: !!L.previous_league_id });
}
agg.lineup = Object.fromEntries(Object.entries(agg.lineup).sort((a, b) => b[1] - a[1]).slice(0, 40));
agg.combos = Object.fromEntries(Object.entries(agg.combos).sort((a, b) => b[1] - a[1]).slice(0, 60));
out.crawl = agg;
writeOut('crawl_leagues.json', JSON.stringify(anonLeagues));
out.http = { calls, cacheHits: hits };
writeOut('explore.json', out);
console.log('explore done:', agg.n, 'leagues,', users.size, 'users, calls', calls, 'cache hits', hits);
