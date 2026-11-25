// ESPN public leagues: gather anonymous structure (settings, seeds, schedule) to build and check an ESPN reader,
// plus one league's data with every name removed, for local work. League ids stay in the private cache.
import fs from 'node:fs';
import { writeOut, sleep, anon } from './lib.mjs';
const E = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';
const cacheFile = '.labcache/espn_public.json', t0 = Date.now();
let pub = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : [];
async function get(url) { for (let a = 0; a < 3; a++) { try { const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }); if (r.status === 200) return await r.json(); if (r.status === 401 || r.status === 404) return null; } catch (e) {} await sleep(800); } return null; }
// find more public leagues by trying id ranges
const tally = { 200: 0, other: 0 };
if (pub.length < 60) {
  const starts = [2000, 40000, 60000, 90000, 120000, 150000, 200000, 300000, 350000, 450000, 500000, 600000, 700000, 800000, 900000, 1100000, 1300000, 1500000, 1700000, 1900000];
  outer: for (const st of starts) for (let i = 0; i < 90; i++) {
    const id = st + i; if (pub.includes(id)) continue;
    try { const r = await fetch(`${E}/2026/segments/0/leagues/${id}?view=mStatus`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.status === 200) { const j = await r.json(); tally[200]++; if (j.status && j.status.currentMatchupPeriod > 3 && j.status.isActive) pub.push(id); } else tally.other++; } catch (e) { tally.other++; }
    if (pub.length >= 70) break outer;
    await sleep(90);
  }
  fs.mkdirSync('.labcache', { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(pub));
}
const VIEWS = 'view=mSettings&view=mTeam&view=mMatchupScore&view=mStandings&view=mStatus';
const slim = j => { const st = j.settings || {}, ss = st.scheduleSettings || {}, sc = st.scoringSettings || {};
  return { season: j.seasonId, status: j.status && { cur: j.status.currentMatchupPeriod, latest: j.status.latestScoringPeriod, first: j.status.firstScoringPeriod, final: j.status.finalScoringPeriod, active: j.status.isActive, edited: j.status.isPlayoffMatchupEdited },
    set: { size: st.size, mpCount: ss.matchupPeriodCount, mpLen: ss.matchupPeriodLength, periods: ss.matchupPeriods, P: ss.playoffTeamCount, poLen: ss.playoffMatchupPeriodLength, poLenByRound: ss.playoffMatchupPeriodLengthByRound, reseed: ss.playoffReseed, rule: ss.playoffSeedingRule, ruleBy: ss.playoffSeedingRuleBy, divs: (ss.divisions || []).map(d => [d.id, d.size]), consolationOff: ss.consolationLadderDisabled, varLen: ss.variablePlayoffMatchupPeriodLength,
      tie: sc.matchupTieRule, tieBy: sc.matchupTieRuleBy, poTie: sc.playoffMatchupTieRule, poTieBy: sc.playoffMatchupTieRuleBy, scoringType: sc.scoringType, homeBonus: sc.homeTeamBonus, poHomeBonus: sc.playoffHomeTeamBonus, slots: (st.rosterSettings || {}).lineupSlotCounts, keepers: st.draftSettings && st.draftSettings.keeperCount },
    teams: (j.teams || []).map(t => ({ id: t.id, div: t.divisionId, seed: t.playoffSeed, rankFinal: t.rankCalculatedFinal, pts: t.points, adj: t.pointsAdjusted, rec: t.record && [t.record.overall.wins, t.record.overall.losses, t.record.overall.ties, t.record.overall.pointsFor, t.record.overall.pointsAgainst], drec: t.record && t.record.division && [t.record.division.wins, t.record.division.losses, t.record.division.ties] })),
    sched: (j.schedule || []).map(m => [m.matchupPeriodId, m.playoffTierType, m.home ? m.home.teamId : null, m.away ? m.away.teamId : null, m.home ? m.home.totalPoints : null, m.away ? m.away.totalPoints : null, m.winner]) }; };
const out = [];
for (const id of pub.slice(0, 70)) {
  const rec = { h: anon('espn' + id) };
  const cur = await get(`${E}/2026/segments/0/leagues/${id}?${VIEWS}`); if (cur) rec.y2026 = slim(cur);
  const prev = await get(`${E}/2025/segments/0/leagues/${id}?${VIEWS}`); if (prev) rec.y2025 = slim(prev);
  out.push(rec); await sleep(120);
}
writeOut('espn_leagues.json', JSON.stringify(out));
// one league with names removed, including rosters and projections, for local page work
let fixture = null;
for (const id of pub) {
  const j = await get(`${E}/2026/segments/0/leagues/${id}?${VIEWS}`); if (!j || !j.teams || j.teams.length < 8) continue;
  const sp = j.scoringPeriodId, weeks = {};
  for (const w of [sp, sp + 2]) {
    const r = await get(`${E}/2026/segments/0/leagues/${id}?view=mRoster&scoringPeriodId=${w}`); if (!r) continue;
    weeks[w] = (r.teams || []).map(t => ({ id: t.id, entries: ((t.roster && t.roster.entries) || []).map(e => { const p = (e.playerPoolEntry && e.playerPoolEntry.player) || {}; return { playerId: e.playerId, lineupSlotId: e.lineupSlotId, player: { fullName: p.fullName, eligibleSlots: p.eligibleSlots, proTeamId: p.proTeamId, defaultPositionId: p.defaultPositionId, injuryStatus: p.injuryStatus, stats: (p.stats || []).filter(s => s.statSourceId === 1 && s.statSplitTypeId === 1).map(s => ({ scoringPeriodId: s.scoringPeriodId, statSourceId: 1, statSplitTypeId: 1, appliedTotal: s.appliedTotal, seasonId: s.seasonId })) } }; }) }));
  }
  (j.teams || []).forEach((t, k) => { t.name = 'Team ' + (k + 1); t.abbrev = 'T' + (k + 1); delete t.owners; delete t.primaryOwner; delete t.logo; delete t.tradeBlock; delete t.transactionCounter; delete t.valuesByStat; });
  delete j.members; if (j.settings) { j.settings.name = 'Example ESPN League'; (j.settings.scheduleSettings.divisions || []).forEach((d, k) => { d.name = 'Division ' + (k + 1); }); }
  delete j.draftDetail;
  fixture = { league: j, rosterWeeks: weeks }; break;
}
if (fixture) writeOut('fixtures/espn_raw.json', JSON.stringify(fixture));
const rules = {}; out.forEach(r => { const s = r.y2026 && r.y2026.set; if (s) { const k = `${s.rule}/by${s.ruleBy}/P${s.P}/n${s.size}/div${s.divs.length}/reseed${s.reseed}/poLen${s.poLen}/tie${s.tie}`; rules[k] = (rules[k] || 0) + 1; } });
writeOut('espn.json', { found: pub.length, probe: tally, leagues: out.length, with2025: out.filter(r => r.y2025).length, rules, fixture: !!fixture, secs: Math.round((Date.now() - t0) / 1000) });
console.log('espn done: public', pub.length, 'leagues', out.length, 'with 2025', out.filter(r => r.y2025).length, 'fixture', !!fixture);
