// Local check of seeding and bracket shape against the saved public fixtures (not part of the repo tests).
const C = require('../js/core.js'), fs = require('fs');
for (const k of [0, 1, 2, 3]) {
  const f = JSON.parse(fs.readFileSync(`/home/claude/fx/seed_${k}.json`, 'utf8')), L = f.league, s = L.settings;
  const ids = f.rosters.map(r => r.roster_id), t = { wins: [], losses: [], ties: [], pf: [], pa: [] };
  f.rosters.forEach(r => { const x = r.settings; t.wins.push(x.wins); t.losses.push(x.losses); t.ties.push(x.ties); t.pf.push(x.fpts + (x.fpts_decimal || 0) / 100); t.pa.push(x.fpts_against + (x.fpts_against_decimal || 0) / 100); });
  const order = C.seedOrder(t, null, 0), seedOf = {}; order.forEach((i, sd) => { if (sd < s.playoff_teams) seedOf[ids[i]] = sd; });
  const br = C.bracketFromSleeper(f.winners_bracket, seedOf);
  const std = C.bracketKey(C.standardBracket(s.playoff_teams));
  console.log(L.season, L.status, 'seeds', order.slice(0, s.playoff_teams).map(i => ids[i]).join(','), '| bracket read:', br ? (C.bracketKey(br) === std ? 'matches standard' : 'DIFFERENT ' + C.bracketKey(br)) : 'could not map');
  // lower bracket: which teams have byes?
  const rest = order.slice(s.playoff_teams).map(i => ids[i]);
  const lb = f.losers_bracket || [], r1 = lb.filter(x => x.r === 1).map(x => [x.t1, x.t2]), r2 = lb.filter(x => x.r === 2 && !x.t1_from).map(x => x.t1);
  console.log('   non-playoff order (best first):', rest.join(','), '| lower r1:', JSON.stringify(r1), 'byes:', JSON.stringify(r2), 'playoff_type', s.playoff_type);
}
// round weeks
console.log(JSON.stringify(C.roundWeeks(14, 3, 1)), JSON.stringify(C.roundWeeks(15, 3, 0)), JSON.stringify(C.roundWeeks(13, 3, 2)));
// lineup sanity
const slots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'REC_FLEX'];
const pl = [['q1', ['QB'], 22], ['q2', ['QB'], 18], ['r1', ['RB'], 15], ['r2', ['RB'], 12], ['r3', ['RB'], 11], ['w1', ['WR'], 16], ['w2', ['WR'], 14], ['w3', ['WR'], 9], ['t1', ['TE'], 8], ['t2', ['TE'], 7.5], ['x', ['WR', 'DB'], 9.5]].map(a => ({ id: a[0], pos: a[1], pts: a[2] }));
const bl = C.bestLineup(slots, pl); console.log(bl.total.toFixed(1), bl.starters.map(s => s.slot + ':' + s.id).join(' '));
for (const P of [2, 3, 4, 5, 6, 7, 8, 10, 12]) console.log(P, C.bracketKey(C.standardBracket(P)));
