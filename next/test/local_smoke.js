const fs = require('fs'), C = require('../js/core.js'), E = require('../js/engine.js'), S = require('../js/sleeper.js'), M = require('../js/model.js');
function rawOf(k) { const f = JSON.parse(fs.readFileSync(`/home/claude/fx/seed_${k}.json`, 'utf8')); return { league: f.league, state: JSON.parse(fs.readFileSync('/home/claude/fx/state.json', 'utf8')), users: f.users, rosters: f.rosters, winners: f.winners_bracket, losers: f.losers_bracket, traded: f.traded_picks, drafts: f.drafts, matchups: f.matchups, draft0: f.draft0 }; }
const pct = x => (100 * x).toFixed(1).padStart(5);
function run(label, raw, draft) {
  const D = S.normalize(raw);
  console.log(`\n== ${label}: ${D.name} ${D.season} phase=${D.phase} through=${D.through} scored=${D.scored} P=${D.set.P} rounds=${JSON.stringify(D.set.rounds)} bracket=${D.bracketSource} seedsMatch=${D.seedsMatch} recordsDiffer=${!!D.recordsDiffer} warn=${JSON.stringify(D.warnings)}`);
  if (D.phase === 'unsupported' || D.phase === 'pre') { console.log(D.why); return D; }
  const cfg = M.buildConfig(D, null, { draft });
  const t = Date.now(), res = E.simulate(cfg, [], 20000, 5), ms = Date.now() - t;
  console.log(`mode=${cfg.mode} base=${cfg.base.toFixed(1)} sigma=${cfg.hyper.sigma.toFixed(1)} tau=${cfg.hyper.tau.toFixed(1)} games=${cfg.games.length} weeks=${cfg.weeks} ${ms}ms`);
  const sum = a => Array.from(a).reduce((x, y) => x + y, 0) / res.wsum;
  console.log(`sums: playoff ${sum(res.playoff).toFixed(3)} bye ${sum(res.bye).toFixed(3)} final ${sum(res.fin).toFixed(3)} champ ${sum(res.champ).toFixed(3)}`);
  D.order.forEach(i => console.log(`  ${D.teams[i].name.padEnd(26).slice(0, 26)} ${D.rec.wins[i]}-${D.rec.losses[i]} po ${pct(res.playoff[i] / res.wsum)} bye ${pct(res.bye[i] / res.wsum)} semi ${pct(res.reach[2][i] / res.wsum)} fin ${pct(res.fin[i] / res.wsum)} ch ${pct(res.champ[i] / res.wsum)}` + (res.slotDist ? ' slot ' + (res.slotSum[i] / res.wsum).toFixed(2) : '')));
  return D;
}
run('live 2026', rawOf(0), { nonPlayoff: 'record', playoff: 'place' });
run('finished 2025', rawOf(1), { nonPlayoff: 'record', playoff: 'place' });
// playoffs in progress: rewind 2025 to just after the first playoff week
const r = rawOf(1); r.league.status = 'in_season'; r.league.settings.last_scored_leg = 14;
r.winners = r.winners.map(g => g.r === 1 ? g : Object.assign({}, g, { w: null, l: null, t1: g.t1_from ? null : g.t1, t2: g.t2_from ? null : g.t2 }));
run('2025 after round one', r, { nonPlayoff: 'record', playoff: 'place' });
// two-week final half played
const r2 = rawOf(1); r2.league.status = 'in_season'; r2.league.settings.last_scored_leg = 16;
r2.winners = r2.winners.map(g => g.r < 3 ? g : Object.assign({}, g, { w: null, l: null }));
const D2 = run('2025 mid final (two-week)', r2, { nonPlayoff: 'record', playoff: 'place' }); console.log('partial', JSON.stringify(D2.fixed.partial));
// draft rule from history: past seasons paired with the following draft
const past = [1, 2, 3].map(k => { const p = rawOf(k), nx = rawOf(k - 1); return { league: p.league, rosters: p.rosters, winners: p.winners, draft: nx.draft0 }; });
console.log('\ndraft rule:', JSON.stringify(M.inferDraftRule(past)));
