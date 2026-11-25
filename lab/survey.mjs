// Phase B survey: a wider sample of real leagues, reduced to anonymous numbers, for checking
// seeding, brackets, median games, records and draft-order rules. No names or ids are written out.
import fs from 'node:fs';
import { getJSON, anon, S, writeOut, pool, calls, hits } from './lib.mjs';

const SEED = '1313270302943223808';
const MAX_USERS = Number(process.env.SURVEY_USERS || 600), MAX_2025 = 520, MAX_2026 = 230;
const t0 = Date.now();

// ---- crawl outward from the seed league's members
const users = new Map(), leagues = new Map();
for (const u of await getJSON(`${S}/league/${SEED}/users`, { ttlHours: 24 })) users.set(u.user_id, 0);
async function leaguesOf(uid) {
  const out = [];
  for (const season of [2026, 2025]) for (const x of (await getJSON(`${S}/user/${uid}/leagues/nfl/${season}`, { ttlHours: 72 })) || []) out.push(x);
  return out;
}
let done = new Set();
for (let depth = 0; depth < 4 && done.size < MAX_USERS; depth++) {
  const ids = [...users.entries()].filter(([u, d]) => d === depth && !done.has(u)).map(([u]) => u).slice(0, MAX_USERS - done.size);
  if (!ids.length) break;
  const res = await pool(ids, 8, leaguesOf);
  ids.forEach(u => done.add(u));
  for (const list of res) for (const L of Array.isArray(list) ? list : []) if (L && L.sport === 'nfl' && !leagues.has(L.league_id)) leagues.set(L.league_id, L);
  if (done.size >= MAX_USERS) break;
  // next ring: members of a spread of the leagues found so far
  const pick = [...leagues.values()].filter(L => L.season === '2026' && !L._seen);
  const stride = Math.max(1, Math.floor(pick.length / 60));
  const sample = pick.filter((_, i) => i % stride === 0).slice(0, 60);
  sample.forEach(L => { L._seen = 1; });
  const mem = await pool(sample, 8, L => getJSON(`${S}/league/${L.league_id}/users`, { ttlHours: 72 }));
  for (const list of mem) for (const u of Array.isArray(list) ? list : []) if (!users.has(u.user_id)) users.set(u.user_id, depth + 1);
}
const all = [...leagues.values()];
const byPrev = new Map(); for (const L of all) if (L.previous_league_id) byPrev.set(L.previous_league_id, L);
console.log('crawl:', all.length, 'leagues from', done.size, 'users,', Math.round((Date.now() - t0) / 1000), 's');

const setOf = L => { const s = L.settings || {}; return { n: s.num_teams, P: s.playoff_teams, pws: s.playoff_week_start, rt: s.playoff_round_type, st: s.playoff_seed_type, pt: s.playoff_type, med: s.league_average_match, div: s.divisions || 0, type: s.type, bb: s.best_ball || 0, sw: s.start_week, dr: s.draft_rounds, leg: s.leg, lsl: s.last_scored_leg, squads: s.squads, tr: L.total_rosters,
  ovr: L.bracket_overrides_id ? 1 : 0, lovr: L.loser_bracket_overrides_id ? 1 : 0, slots: (L.roster_positions || []).filter(p => p !== 'BN').join(',') }; };
const rosterOf = r => { const s = r.settings || {}; return { rid: r.roster_id, w: s.wins, l: s.losses, t: s.ties, pf: (s.fpts || 0) + (s.fpts_decimal || 0) / 100, pa: (s.fpts_against || 0) + (s.fpts_against_decimal || 0) / 100, pp: (s.ppts || 0) + (s.ppts_decimal || 0) / 100, div: s.division, rec: (r.metadata && r.metadata.record) || null, own: r.owner_id ? 1 : 0, np: (r.players || []).length }; };
const draftOf = d => d && { type: d.type, status: d.status, season: d.season, rounds: d.settings && d.settings.rounds, teams: d.settings && d.settings.teams, rev: d.settings && d.settings.reversal_round, ptype: d.settings && d.settings.player_type, slots: d.slot_to_roster_id || null, nOrder: d.draft_order ? Object.keys(d.draft_order).length : 0, start: d.start_time ? new Date(d.start_time).toISOString().slice(0, 10) : null };
async function draftsFor(id) {
  const list = (await getJSON(`${S}/league/${id}/drafts`, { ttlHours: 72 })) || [];
  const out = [];
  for (const d of list.slice(0, 3)) out.push(draftOf(await getJSON(`${S}/draft/${d.draft_id}`, { ttlHours: 72 })));
  return out;
}

// ---- finished 2025 seasons: final standings, both brackets, and the draft order that followed
const fin = all.filter(L => L.season === '2025' && L.status === 'complete');
const stride25 = Math.max(1, fin.length / MAX_2025);
const fin25 = fin.filter((_, i) => Math.floor(i / stride25) !== Math.floor((i - 1) / stride25) || i === 0).slice(0, MAX_2025);
const out25 = await pool(fin25, 8, async L => {
  const id = L.league_id, next = byPrev.get(id);
  const [rosters, wb, lb] = await Promise.all([getJSON(`${S}/league/${id}/rosters`), getJSON(`${S}/league/${id}/winners_bracket`), getJSON(`${S}/league/${id}/losers_bracket`)]);
  return { h: anon(id), s: setOf(L), rosters: (rosters || []).map(rosterOf), wb, lb, drafts: await draftsFor(id), next: next ? { status: next.status, s: setOf(next), drafts: await draftsFor(next.league_id) } : null };
});
writeOut('survey_2025.json', JSON.stringify(out25));
console.log('2025 done:', out25.length, 'calls', calls, Math.round((Date.now() - t0) / 1000), 's');

// ---- seasons in progress: standings, the bracket as Sleeper shows it now, and every week's pairings and points
const live = all.filter(L => L.season === '2026' && L.status === 'in_season');
const stride26 = Math.max(1, live.length / MAX_2026);
const live26 = live.filter((_, i) => Math.floor(i / stride26) !== Math.floor((i - 1) / stride26) || i === 0).slice(0, MAX_2026);
const out26 = await pool(live26, 8, async L => {
  const id = L.league_id, s = L.settings || {};
  const [rosters, wb, lb] = await Promise.all([getJSON(`${S}/league/${id}/rosters`, { ttlHours: 6 }), getJSON(`${S}/league/${id}/winners_bracket`, { ttlHours: 6 }), getJSON(`${S}/league/${id}/losers_bracket`, { ttlHours: 6 })]);
  const lastReg = (s.playoff_week_start || 15) - 1, weeks = {};
  for (let w = s.start_week || 1; w <= Math.min(18, Math.max(lastReg, 1)); w++) {
    const m = await getJSON(`${S}/league/${id}/matchups/${w}`, { ttlHours: 6 });
    weeks[w] = (m || []).map(x => [x.roster_id, x.matchup_id, x.points, x.custom_points == null ? null : x.custom_points, (x.starters || []).length, (x.players || []).length]);
  }
  return { h: anon(id), s: setOf(L), rosters: (rosters || []).map(rosterOf), wb, lb, weeks };
});
writeOut('survey_2026.json', JSON.stringify(out26));
writeOut('survey.json', { when: new Date().toISOString(), leagues: all.length, users: done.size, fin25: out25.length, live26: out26.length, calls, hits, secs: Math.round((Date.now() - t0) / 1000),
  status: all.reduce((m, L) => { const k = L.season + ':' + L.status; m[k] = (m[k] || 0) + 1; return m; }, {}) });
// the league ids stay in the private cache only, for later lab tasks
fs.mkdirSync('.labcache', { recursive: true });
fs.writeFileSync('.labcache/survey_ids.json', JSON.stringify({ fin25: fin25.map(L => L.league_id), live26: live26.map(L => L.league_id), next: Object.fromEntries(fin25.map(L => [L.league_id, (byPrev.get(L.league_id) || {}).league_id || null])) }));
console.log('survey done:', all.length, 'leagues,', out25.length, 'finished,', out26.length, 'live, calls', calls, 'hits', hits);
