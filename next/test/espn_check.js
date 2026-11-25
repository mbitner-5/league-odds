// Research: does our ESPN seeding (with ESPN's tiebreak rules) reproduce ESPN's own playoffSeed? And does the reader run end to end?
const fs = require('fs'), C = require('../js/core.js'), E = require('../js/engine.js'), X = require('../js/espn.js'), M = require('../js/model.js');
const L = JSON.parse(fs.readFileSync(process.argv[2] || '/home/claude/fx/espn/espn_leagues.json', 'utf8'));
const tally = {}, bump = k => { tally[k] = (tally[k] || 0) + 1; }, ex = [];
// rebuild an ESPN-shaped league object from the slim record
function unslim(y) { return { league: { id: 1, seasonId: y.season, scoringPeriodId: y.status.latest, status: { isActive: y.status.active, currentMatchupPeriod: y.status.cur, isPlayoffMatchupEdited: y.status.edited },
  settings: { name: 'x', scheduleSettings: { matchupPeriodCount: y.set.mpCount, matchupPeriods: y.set.periods, playoffTeamCount: y.set.P, playoffReseed: y.set.reseed, playoffSeedingRule: y.set.rule, divisions: y.set.divs.map(d => ({ id: d[0], size: d[1] })) }, scoringSettings: { scoringType: y.set.scoringType }, rosterSettings: { lineupSlotCounts: y.set.slots } },
  teams: y.teams.map(t => ({ id: t.id, divisionId: t.div, playoffSeed: t.seed, name: 'T' + t.id, record: { overall: { wins: t.rec[0], losses: t.rec[1], ties: t.rec[2], pointsFor: t.rec[3], pointsAgainst: t.rec[4] } } })),
  schedule: y.sched.map(s => ({ matchupPeriodId: s[0], playoffTierType: s[1], home: s[2] == null ? null : { teamId: s[2], totalPoints: s[4] }, away: s[3] == null ? null : { teamId: s[3], totalPoints: s[5] }, winner: s[6] })) }, rosterWeeks: {} }; }
for (const lg of L) for (const yr of ['y2026', 'y2025']) {
  const y = lg[yr]; if (!y || !y.teams.length) continue;
  let D; try { D = X.normalize(unslim(y)); } catch (e) { bump(yr + ' ERROR normalize: ' + String(e.message).slice(0, 80)); continue; }
  const tag = `${yr} ${y.set.rule} div${y.set.divs.length > 1 ? y.set.divs.length : 0} P${y.set.P}`;
  if (D.phase === 'unsupported' || D.phase === 'pre') { bump(`${yr} ${D.phase}: ${(D.why || '').slice(0, 50)}`); continue; }
  // full order vs ESPN's seeds, for seasons where every team has a seed
  const n = D.n, seeds = y.teams.slice().sort((a, b) => a.id - b.id).map(t => t.seed);
  const top = D.order.slice(0, D.set.P).every((t, k) => seeds[t] === k + 1), all = D.order.every((t, k) => seeds[t] === k + 1);
  bump(`${tag} ${D.phase}: playoff seeds ${top ? 'match' : 'DIFFER'}${D.recordsDiffer ? ' (records differ)' : ''}`);
  if (!top && ex.length < 10) ex.push({ tag, phase: D.phase, mine: D.order.slice(0, D.set.P + 1).map(t => `${seeds[t]}:${D.rec.wins[t]}-${D.rec.losses[t]}${D.rec.ties[t] ? '-' + D.rec.ties[t] : ''}/${Math.round(D.rec.pf[t])}/d${D.teams[t].div}`) });
  try {
    const cfg = M.buildConfig(D, null, {}), res = E.simulate(cfg, [], 1500, 1), sum = a => Array.from(a).reduce((x, z) => x + z, 0) / res.wsum;
    if (Math.abs(sum(res.playoff) - D.set.P) > 1e-6 || Math.abs(sum(res.champ) - 1) > 1e-6) bump(yr + ' BAD sums');
    if (D.phase === 'done') { const champs = Array.from(res.champ).filter(x => x > 0).length; bump(`${yr} finished season: ${champs === 1 ? 'one certain champion' : champs + ' possible champions'} (games matched ${Object.keys(D.fixed.done).length})`); }
  } catch (e) { bump(yr + ' ERROR simulate: ' + String(e.message).slice(0, 80)); }
}
Object.keys(tally).sort().forEach(k => console.log(String(tally[k]).padStart(4), k));
ex.forEach(e => console.log(JSON.stringify(e)));
