// Can other platforms be read from a browser page? Checks cross-site headers, script-tag (JSONP) support,
// and the shape of ESPN's public-league data. League ids found here stay in the private cache.
import fs from 'node:fs';
import { writeOut, sleep } from './lib.mjs';

const ORIGIN = 'https://mbitner-5.github.io';
const out = { when: new Date().toISOString() };
async function raw(url, opt = {}) {
  try {
    const r = await fetch(url, { method: opt.method || 'GET', headers: { Origin: ORIGIN, 'User-Agent': 'Mozilla/5.0', ...(opt.headers || {}) } });
    const text = await r.text();
    const h = k => r.headers.get(k);
    return { status: r.status, acao: h('access-control-allow-origin'), acah: h('access-control-allow-headers'), acac: h('access-control-allow-credentials'), type: h('content-type'), bytes: text.length, head: opt.noHead ? undefined : text.slice(0, 160), text: opt.keep ? text : undefined };
  } catch (e) { return { error: String(e.message || e) }; }
}
const shapeOf = (v, d = 0) => v === null ? 'null' : Array.isArray(v) ? (v.length ? [shapeOf(v[0], d + 1)] : []) : typeof v === 'object' ? (d > 5 ? '{..}' : Object.fromEntries(Object.keys(v).slice(0, 80).map(k => [k, shapeOf(v[k], d + 1)]))) : typeof v;

// ---- ESPN: find a few public leagues, then record what each view contains
const E = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';
const cacheFile = '.labcache/espn_public.json';
let pub = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : [];
const tallyE = {};
if (pub.length < 6) {
  const starts = [1000, 52000, 100000, 250000, 400000, 777000, 1000000, 1234500, 2000000, 30000000, 100000000, 1100000000];
  outer: for (const st of starts) for (let i = 0; i < 40; i++) {
    const id = st + i, r = await raw(`${E}/2026/segments/0/leagues/${id}?view=mSettings`, { keep: true });
    tallyE[r.status || r.error] = (tallyE[r.status || r.error] || 0) + 1;
    if (r.status === 200) { try { const j = JSON.parse(r.text); if (j.settings && j.status && j.status.currentMatchupPeriod > 3) pub.push(id); } catch (e) {} }
    if (pub.length >= 8) break outer;
    await sleep(120);
  }
  fs.mkdirSync('.labcache', { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(pub));
}
out.espn = { probeStatus: tallyE, publicFound: pub.length };
if (pub.length) {
  const id = pub[0];
  const views = ['mSettings', 'mTeam', 'mRoster', 'mMatchup', 'mMatchupScore', 'mStandings', 'mStatus', 'mNav', 'mSchedule', 'mDraftDetail', 'kona_playercard'];
  out.espn.views = {};
  for (const v of views) {
    const r = await raw(`${E}/2026/segments/0/leagues/${id}?view=${v}`, { keep: true });
    let sh = null; try { sh = shapeOf(JSON.parse(r.text)); } catch (e) {}
    out.espn.views[v] = { status: r.status, acao: r.acao, bytes: r.bytes, shape: sh };
    await sleep(150);
  }
  // one combined call, the way the page would ask
  const comb = await raw(`${E}/2026/segments/0/leagues/${id}?view=mSettings&view=mTeam&view=mRoster&view=mMatchup&view=mMatchupScore&view=mStandings&view=mStatus`, { keep: true });
  try {
    const j = JSON.parse(comb.text);
    const st = j.settings || {};
    out.espn.sample = {
      status: j.status, scoringPeriodId: j.scoringPeriodId, seasonId: j.seasonId, segmentId: j.segmentId,
      settings: { size: st.size, isPublic: st.isPublic, scheduleSettings: st.scheduleSettings && { ...st.scheduleSettings, divisions: (st.scheduleSettings.divisions || []).map(d => ({ id: d.id, size: d.size })) }, scoringSettings: st.scoringSettings, rosterSettings: st.rosterSettings, draftSettings: st.draftSettings && { type: st.draftSettings.type, keeperCount: st.draftSettings.keeperCount, pickOrder: (st.draftSettings.pickOrder || []).length }, tradeSettings: undefined },
      teams: (j.teams || []).map(t => ({ id: t.id, divisionId: t.divisionId, playoffSeed: t.playoffSeed, rankCalculatedFinal: t.rankCalculatedFinal, currentProjectedRank: t.currentProjectedRank, points: t.points, record: t.record && t.record.overall, rosterN: t.roster && t.roster.entries && t.roster.entries.length, draftDayProjectedRank: t.draftDayProjectedRank, waiverRank: t.waiverRank })),
      schedule: (j.schedule || []).map(m => ({ id: m.id, mp: m.matchupPeriodId, tier: m.playoffTierType, winner: m.winner, home: m.home && { teamId: m.home.teamId, totalPoints: m.home.totalPoints, keys: Object.keys(m.home) }, away: m.away && { teamId: m.away.teamId, totalPoints: m.away.totalPoints, keys: Object.keys(m.away) } })),
      rosterEntry: (() => { const t = (j.teams || [])[0]; const e = t && t.roster && t.roster.entries && t.roster.entries[0]; if (!e) return null; const p = e.playerPoolEntry && e.playerPoolEntry.player; return { keys: Object.keys(e), lineupSlotId: e.lineupSlotId, poolKeys: e.playerPoolEntry && Object.keys(e.playerPoolEntry), appliedStatTotal: e.playerPoolEntry && e.playerPoolEntry.appliedStatTotal, player: p && { keys: Object.keys(p), defaultPositionId: p.defaultPositionId, eligibleSlots: p.eligibleSlots, proTeamId: p.proTeamId, injuryStatus: p.injuryStatus, stats: (p.stats || []).slice(0, 12).map(s => ({ seasonId: s.seasonId, scoringPeriodId: s.scoringPeriodId, statSourceId: s.statSourceId, statSplitTypeId: s.statSplitTypeId, appliedTotal: s.appliedTotal, nStats: Object.keys(s.stats || {}).length, id: s.id })) } }; })(),
    };
    // future-week projections for current rosters
    const sp = (j.scoringPeriodId || 12) + 2;
    const fut = await raw(`${E}/2026/segments/0/leagues/${id}?view=mRoster&scoringPeriodId=${sp}`, { keep: true });
    const fj = JSON.parse(fut.text); const t = (fj.teams || [])[0]; const ents = (t && t.roster && t.roster.entries) || [];
    out.espn.future = { asked: sp, status: fut.status, bytes: fut.bytes, entries: ents.length, statsPerPlayer: ents.slice(0, 6).map(e => ((e.playerPoolEntry.player.stats) || []).map(s => [s.scoringPeriodId, s.statSourceId, s.statSplitTypeId, s.appliedTotal == null ? null : Math.round(s.appliedTotal * 10) / 10])) };
  } catch (e) { out.espn.sampleError = String(e.message || e); }
  // would the browser be allowed to send the custom filter header?
  out.espn.preflight = await raw(`${E}/2026/segments/0/leagues/${id}?view=kona_player_info`, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-fantasy-filter' } });
  out.espn.plain = await raw(`${E}/2026/segments/0/leagues/${id}?view=mSettings`, { noHead: true });
}

// ---- MyFantasyLeague: cross-site header and script-tag support
const M = 'https://api.myfantasyleague.com/2026/export';
out.mfl = { players_cb: await raw(`${M}?TYPE=nflSchedule&W=1&JSON=1&callback=cb`), players_jsonp: await raw(`${M}?TYPE=nflSchedule&W=1&JSON=1&JSONP=cb`), plain: await raw(`${M}?TYPE=nflSchedule&W=1&JSON=1`) };
let mflPublic = [];
for (let id = 10000; id < 10040 && mflPublic.length < 3; id++) {
  const r = await raw(`${M}?TYPE=league&L=${id}&JSON=1`, { keep: true });
  try { const j = JSON.parse(r.text); if (j.league && j.league.franchises) mflPublic.push({ status: r.status, acao: r.acao, keys: Object.keys(j.league), nFr: (j.league.franchises.franchise || []).length, host: (j.league.baseURL || '').replace(/\d+/, '#') }); } catch (e) {}
  await sleep(250);
}
out.mfl.publicLeagues = mflPublic;

// ---- Fleaflicker and Yahoo
out.fleaflicker = { standings: await raw('https://www.fleaflicker.com/api/FetchLeagueStandings?sport=NFL&league_id=200000'), jsonp: await raw('https://www.fleaflicker.com/api/FetchLeagueStandings?sport=NFL&league_id=200000&callback=cb') };
out.yahoo = await raw('https://fantasysports.yahooapis.com/fantasy/v2/league/nfl.l.1?format=json');
out.nfl = await raw('https://api.fantasy.nfl.com/v2/league/standings?leagueId=1&format=json');
writeOut('probe.json', out);
console.log('probe done: espn public', pub.length, JSON.stringify(tallyE));
