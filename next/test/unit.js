// Unit tests for the general engine and its building blocks. Run: node next/test/unit.js
const C = require('../js/core.js'), E = require('../js/engine.js'), S = require('../js/sleeper.js'), M = require('../js/model.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')); } };
const rng = C.sfc32(99), rnd = () => rng();
const sum = (a, w) => Array.from(a).reduce((x, y) => x + y, 0) / w;
function league(n, P, o = {}) {
  const weeks = o.weeks || 3, games = [], rel = {};
  for (let w = 1; w <= weeks; w++) { const ids = [...Array(n).keys()].sort(() => rnd() - 0.5); for (let k = 0; k + 1 < n; k += 2) games.push({ week: w, a: ids[k], b: ids[k + 1] }); rel[w] = Array.from({ length: n }, (_, i) => (o.rel ? o.rel[i] : (i % 5) * 3 - 6)); }
  const br = C.standardBracket(P), R = E.bracketInfo(br).rounds, rounds = C.roundWeeks(weeks + 1, R, o.rt || 0);
  rounds.flat().forEach(w => { rel[w] = rel[1].slice(); });
  return { n, wins: Array.from({ length: n }, (_, i) => o.wins ? o.wins[i] : (i * 7) % 5), losses: Array.from({ length: n }, (_, i) => o.wins ? o.total - o.wins[i] : 4 - (i * 7) % 5), ties: new Array(n).fill(0),
    pf: Array.from({ length: n }, (_, i) => o.pf ? o.pf[i] : 400 + i * 1.37), pa: new Array(n).fill(400), div: o.div || null, nDiv: o.nDiv || 0, median: !!o.median,
    games: o.noGames ? [] : games, rel, base: 100, sigma: o.sigma || 20, v: new Array(n).fill(o.v == null ? 9 : o.v),
    playoff: { teams: P, bracket: br, rounds, reseed: !!o.reseed, fixed: o.fixed || null }, draft: o.draft === undefined ? { nonPlayoff: 'record', playoff: 'place' } : o.draft };
}

/* ---- brackets ---- */
for (const P of [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16]) {
  const br = C.standardBracket(P), info = E.bracketInfo(br), seen = {};
  br.forEach(g => { if (info.title[g.m]) [g.a, g.b].forEach(x => { if (x.s != null) seen[x.s] = (seen[x.s] || 0) + 1; }); });
  ok(`bracket ${P}: every seed enters the title path once`, Object.keys(seen).length === P && Object.values(seen).every(v => v === 1));
  ok(`bracket ${P}: title games = teams - 1`, Object.keys(info.title).length === P - 1);
}
ok('six-team bracket gives two byes', E.bracketInfo(C.standardBracket(6)).byeSeeds.join() === '0,1');
ok('seven-team bracket gives one bye', E.bracketInfo(C.standardBracket(7)).byeSeeds.join() === '0');
ok('round weeks: two-week final', JSON.stringify(C.roundWeeks(14, 3, 1)) === '[[14],[15],[16,17]]');
ok('round weeks: two weeks each', JSON.stringify(C.roundWeeks(13, 3, 2)) === '[[13,14],[15,16],[17,18]]');

/* ---- simulation invariants over many league shapes ---- */
for (const [n, P, o] of [[4, 2, {}], [6, 4, {}], [8, 4, { median: true }], [10, 6, { reseed: true }], [12, 6, { median: true, rt: 1 }], [12, 7, {}], [12, 8, { reseed: true }], [14, 6, { rt: 2 }], [16, 8, { median: true }], [10, 5, {}], [9, 4, {}], [12, 3, {}],
  [12, 6, { div: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3], nDiv: 3 }], [32, 12, { div: Array.from({ length: 32 }, (_, i) => 1 + (i % 8)), nDiv: 8, weeks: 5 }], [12, 6, { draft: { nonPlayoff: 'maxpf', playoff: 'seed' } }], [12, 6, { draft: null }]]) {
  const cfg = league(n, P, o), N = 3000, r = E.simulate(cfg, [], N, 1), tag = `n${n} P${P} ${JSON.stringify(Object.keys(o))}`;
  const info = E.bracketInfo(cfg.playoff.bracket);
  ok(`${tag}: playoff odds add to ${P}`, Math.abs(sum(r.playoff, r.wsum) - P) < 1e-9);
  ok(`${tag}: one champion`, Math.abs(sum(r.champ, r.wsum) - 1) < 1e-9);
  ok(`${tag}: two finalists`, P < 2 || Math.abs(sum(r.fin, r.wsum) - 2) < 1e-9);
  ok(`${tag}: byes add up`, Math.abs(sum(r.bye, r.wsum) - info.byeSeeds.length) < 1e-9);
  ok(`${tag}: final round holds two teams`, Math.abs(sum(r.reach[r.rounds], r.wsum) - 2) < 1e-9, String(sum(r.reach[r.rounds], r.wsum)));
  ok(`${tag}: each team has one seed`, r.seedDist.every(d => Math.abs(sum(d, r.wsum) - 1) < 1e-9));
  if (cfg.draft) {
    ok(`${tag}: each team has one draft slot`, r.slotDist.every(d => Math.abs(sum(d, r.wsum) - 1) < 1e-9));
    let cols = true; for (let j = 0; j < n; j++) { let c = 0; for (let i = 0; i < n; i++) c += r.slotDist[i][j]; if (Math.abs(c / r.wsum - 1) > 1e-9) cols = false; }
    ok(`${tag}: each draft slot has one team`, cols);
    const champSlot = r.champ.every((c, i) => c === 0 || r.slotDist[i][n - 1] >= c - 1e-9);
    ok(`${tag}: the champion picks last`, champSlot);
  }
  ok(`${tag}: no NaN`, [...r.playoff, ...r.champ, ...r.pfSum].every(Number.isFinite));
}

/* ---- same teams, same odds ---- */
{ const cfg = league(8, 4, { rel: new Array(8).fill(0), wins: new Array(8).fill(3), total: 6, pf: new Array(8).fill(600), weeks: 4 }), r = E.simulate(cfg, [], 40000, 2);
  const p = Array.from(r.playoff).map(x => x / r.wsum); ok('identical teams get identical odds', p.every(x => Math.abs(x - 0.5) < 0.012), p.map(x => x.toFixed(3)).join(' ')); }

/* ---- median games ---- */
{ const rel = [80, 0, 0, 0, 0, 0, 0, -80], cfg = league(8, 4, { rel, median: true, wins: new Array(8).fill(0), total: 0, weeks: 3, sigma: 5, v: 0 }), r = E.simulate(cfg, [], 2000, 3);
  ok('median: a dominant team wins twice a week', r.winsDist[0][6] / r.wsum > 0.999, String(r.winsDist[0][6] / r.wsum));
  ok('median: a hopeless team never wins', r.winsDist[7][0] / r.wsum > 0.999);
  let total = 0; for (let i = 0; i < 8; i++) for (let w = 0; w < r.winsDist[i].length; w++) total += w * r.winsDist[i][w] / r.wsum;
  ok('median: wins per week = games + half the league', Math.abs(total - 3 * (4 + 4)) < 0.05, String(total)); }

/* ---- divisions: a division winner is seeded even with a worse record ---- */
{ const div = [1, 1, 1, 1, 2, 2, 2, 2], wins = [9, 8, 7, 6, 3, 2, 1, 0], cfg = league(8, 4, { div, nDiv: 2, wins, total: 10, noGames: true }), r = E.simulate(cfg, [], 500, 4);
  ok('division winner with a losing record makes it', r.playoff[4] / r.wsum === 1 && r.seedDist[4][1] / r.wsum === 1);
  ok('the fourth-best record misses out', r.playoff[3] / r.wsum === 0);
  const flat = league(8, 4, { wins, total: 10, noGames: true }), r2 = E.simulate(flat, [], 500, 4);
  ok('without divisions the top four records go', [0, 1, 2, 3].every(i => r2.playoff[i] / r2.wsum === 1)); }

/* ---- re-seeding ---- */
{ const wins = [10, 9, 8, 7, 6, 5, 1, 0], rel = [0, 0, 0, 0, 0, 300, 0, 0];       // the 6 seed beats everyone
  const fixed = () => ({ done: { 1: [4, 3], 2: [5, 2] } });                           // first round: 5 beats 4, 6 beats 3
  const a = E.simulate(league(8, 6, { wins, total: 10, rel, noGames: true, reseed: true, fixed: fixed(), sigma: 10, v: 0 }), [], 1500, 5);
  const b = E.simulate(league(8, 6, { wins, total: 10, rel, noGames: true, reseed: false, fixed: fixed(), sigma: 10, v: 0 }), [], 1500, 5);
  ok('re-seed: the 1 seed draws the lowest seed left (and loses to it here)', a.fin[0] / a.wsum < 0.001 && a.fin[1] / a.wsum > 0.3, `${a.fin[0] / a.wsum} ${a.fin[1] / a.wsum}`);
  ok('fixed bracket: the 2 seed draws the 3v6 winner instead', b.fin[1] / b.wsum < 0.001 && b.fin[0] / b.wsum > 0.3, `${b.fin[0] / b.wsum} ${b.fin[1] / b.wsum}`); }

/* ---- playoffs under way ---- */
{ const wins = [10, 9, 8, 7, 6, 5, 1, 0];
  const cfg = league(8, 6, { wins, total: 10, noGames: true, rt: 1, fixed: { done: { 1: [3, 4], 2: [2, 5], 3: [0, 3], 4: [1, 2] }, partial: { 6: { a: 180, b: 100, weeks: [16] } } } });
  const r = E.simulate(cfg, [], 4000, 6);
  ok('finished games stay finished', r.fin[0] / r.wsum === 1 && r.fin[1] / r.wsum === 1 && r.reach[2][4] === 0);
  ok('an 80-point lead after week one of a two-week final nearly decides it', r.champ[0] / r.wsum > 0.99, String(r.champ[0] / r.wsum));
  const seeds = E.simulate(league(8, 6, { wins, total: 10, noGames: true, fixed: { seeds: [7, 6, 5, 4, 3, 2], rest: [1, 0] } }), [], 300, 6);
  ok('given seeds override the standings', seeds.playoff[7] / seeds.wsum === 1 && seeds.playoff[0] === 0 && seeds.bye[7] / seeds.wsum === 1); }

/* ---- forced results are sampled exactly ---- */
{ const cfg = league(10, 4, { weeks: 3 }), N = 120000, free = E.simulate(cfg, [], N, 7);
  const g = 2, picks = cfg.games.map((_, i) => i === g ? 1 : 0), forced = E.simulate(cfg, picks, N, 8);
  let worst = 0; for (let i = 0; i < 10; i++) worst = Math.max(worst, Math.abs(free.levPA[g][i] / free.levWA[g] - forced.playoff[i] / forced.wsum));
  ok('a pick gives the same odds as the runs where that result happened', worst < 0.012, 'max gap ' + worst.toFixed(4));
  ok('forced game always goes the picked way', Math.abs(forced.gameA[g] / forced.gameW[g] - 1) < 1e-12);
  const med = league(10, 4, { weeks: 3, median: true }), f2 = E.simulate(med, [], N, 7), p2 = med.games.map((_, i) => i === 4 ? 2 : 0), r2 = E.simulate(med, p2, N, 8);
  let w2 = 0; for (let i = 0; i < 10; i++) w2 = Math.max(w2, Math.abs(f2.levPB[4][i] / f2.levWB[4] - r2.playoff[i] / r2.wsum));
  ok('same with median games in play', w2 < 0.012, 'max gap ' + w2.toFixed(4)); }

/* ---- a week under way ---- */
{ const base0 = JSON.stringify(league(8, 4, { weeks: 2, rel: new Array(8).fill(0), wins: new Array(8).fill(3), total: 6, pf: new Array(8).fill(600), v: 0 }));
  const mk = live => { const c = JSON.parse(base0); c.live = live; return c; };
  const g0 = mk(null).games[0], A = g0.a, B = g0.b, ones = new Array(8).fill(1), zeros = new Array(8).fill(0);
  const same = E.simulate(mk({ week: 1, banked: zeros, share: ones }), [], 60000, 3), plain = E.simulate(mk(null), [], 60000, 4);
  let gap = 0; for (let i = 0; i < 8; i++) gap = Math.max(gap, Math.abs(same.playoff[i] / same.wsum - plain.playoff[i] / plain.wsum));
  ok('live week with nothing played yet changes nothing', gap < 0.012, String(gap));
  const banked = zeros.slice(), share = ones.slice(); banked[A] = 130; share[A] = 0; banked[B] = 90; share[B] = 0;
  const done = E.simulate(mk({ week: 1, banked, share }), [], 4000, 5);
  ok('a finished game in a live week is settled', done.gameA[0] / done.gameW[0] === 1);
  const b2 = zeros.slice(), s2 = ones.slice(); b2[A] = 80; s2[A] = 0.5; const half = E.simulate(mk({ week: 1, banked: b2, share: s2 }), [], 60000, 6);
  const want = C.normCdf((80 + 50 - 100) / Math.sqrt(400 * 0.5 + 400));
  ok('half-played week: banked points plus half the expected rest, with less luck left', Math.abs(half.gameA[0] / half.gameW[0] - want) < 0.01, `${half.gameA[0] / half.gameW[0]} vs ${want}`);
  const picks = mk(null).games.map((_, i) => i === 0 ? 2 : 0), free = E.simulate(mk({ week: 1, banked: b2, share: s2 }), [], 150000, 7), forced = E.simulate(mk({ week: 1, banked: b2, share: s2 }), picks, 150000, 8);
  let w3 = 0; for (let i = 0; i < 8; i++) w3 = Math.max(w3, Math.abs(free.levPB[0][i] / free.levWB[0] - forced.playoff[i] / forced.wsum));
  ok('picking the trailing team in a half-played game matches the runs where it came back', w3 < 0.015 && Math.abs(forced.wsum / forced.nSims - (1 - want)) < 0.01, `gap ${w3.toFixed(4)} weight ${forced.wsum / forced.nSims}`);
  let pfGap = 0; for (let i = 0; i < 8; i++) pfGap = Math.max(pfGap, Math.abs(free.levPB[0][i] / free.levWB[0] - forced.playoff[i] / forced.wsum));
  // points-for must also line up after conditioning (the tiebreak depends on it)
  const fa = forced.pfSum[A] / forced.wsum, fb = forced.pfSum[B] / forced.wsum; ok('forced live game: the picked winner outscores the loser on average', fb > fa);
  // model helper: banked and remaining shares from starters
  const Dm = { n: 2, teams: [{ rid: 1 }, { rid: 2 }], set: { scoring: { rush_yd: 0.1 } } };
  const pack = { keys: ['rush_yd'], p: { a: [0, 100], b: [0, 50], c: [0, 80] } }, players = { a: ['A', 'RB', 'KC', ['RB']], b: ['B', 'RB', 'SF', ['RB']], c: ['C', 'RB', 'NYG', ['RB']] };
  const lw = M.liveWeek(Dm, [{ roster_id: 1, starters: ['a', 'b'], players_points: { a: 14, b: 0 } }, { roster_id: 2, starters: ['c', '0'], players_points: { c: 3 } }], pack, players, t => ({ KC: 'done', SF: 'pre', NYG: 'live' })[t] || null, 5);
  ok('live week helper: banked points and share left', lw.banked.join() === '14,3' && Math.abs(lw.share[0] - 5 / 15) < 1e-9 && Math.abs(lw.share[1] - 0.5) < 1e-9, JSON.stringify(lw));
  ok('live week helper: nothing started means no live week', M.liveWeek(Dm, [{ roster_id: 1, starters: ['b'], players_points: {} }], pack, players, () => 'pre', 5) === null); }

/* ---- sure things never contradict the runs ---- */
for (let t = 0; t < 40; t++) {
  const n = [6, 8, 10, 12][t % 4], P = [4, 4, 6, 6][t % 4], o = { weeks: 1 + (t % 3), wins: Array.from({ length: n }, () => Math.floor(rnd() * 9)), total: 9, median: t % 5 === 0 };
  if (t % 7 === 3) { o.div = Array.from({ length: n }, (_, i) => 1 + (i % 2)); o.nDiv = 2; }
  const cfg = league(n, P, o), cl = E.clinch(cfg, [], P), r = E.simulate(cfg, [], 3000, 20 + t);
  let good = true; for (let i = 0; i < n; i++) { if (cl.clinched[i] && r.playoff[i] / r.wsum < 1 - 1e-12) good = false; if (cl.eliminated[i] && r.playoff[i] > 0) good = false; }
  ok(`clinch flags hold up in the runs (case ${t}, ${cl.method})`, good);
}
{ const cfg = league(8, 4, { wins: [9, 9, 9, 9, 1, 1, 1, 1], total: 10, weeks: 1 }), cl = E.clinch(cfg, [], 4);
  ok('clinch: four teams eight games clear are in, the rest are out', cl.clinched.slice(0, 4).every(Boolean) && cl.eliminated.slice(4).every(Boolean)); }

/* ---- draft-order rules ---- */
{ const n = 8, P = 4, order = Int32Array.from([0, 1, 2, 3, 4, 5, 6, 7]), seedOf = Int32Array.from(order), elim = Int32Array.from([3, 1, 2, 1, 0, 0, 0, 0]), place = Int32Array.from([1, 4, 2, 3, 0, 0, 0, 0]), lostIn = Int32Array.from([0, 2, 3, 1, 0, 0, 0, 0]);
  const pp = Float64Array.from([0, 0, 0, 0, 900, 700, 800, 750]), pf = Float64Array.from([0, 0, 0, 0, 500, 650, 600, 550]);
  const run = rule => Array.from(E.draftSlots(rule, n, P, 2, order, seedOf, elim, place, lostIn, pp, pf, new Int32Array(n), new Int32Array(n), new Float64Array(n)));
  ok('record: worst record picks first', run({ nonPlayoff: 'record', playoff: 'place' }).slice(4).join() === '4,3,2,1');
  ok('max PF: fewest potential points picks first', run({ nonPlayoff: 'maxpf', playoff: 'place' }).slice(4).join() === '4,1,3,2');
  ok('points: fewest points picks first', run({ nonPlayoff: 'pf', playoff: 'place' }).slice(4).join() === '1,4,3,2');
  ok('place: third-place game loser picks before its winner', run({ nonPlayoff: 'record', playoff: 'place' }).slice(0, 4).join() === '8,5,7,6');
  ok('seed: the lower seed picks first', run({ nonPlayoff: 'record', playoff: 'seed' }).slice(0, 4).join() === '8,6,7,5');
  ok('bracket: the later game picks first', run({ nonPlayoff: 'record', playoff: 'bracket' }).slice(0, 4).join() === '8,5,7,6');
  ok('record for everyone ignores the bracket', run({ nonPlayoff: 'record', playoff: 'record' }).join() === '8,7,6,5,4,3,2,1'); }

/* ---- scoring and lineups ---- */
ok('actual scoring is stat times value', Math.abs(C.scoreStats({ pass_yd: 300, pass_td: 2, pass_int: 1, rush_yd: 20, junk: 5 }, { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1 }) - 20) < 1e-9);
{ const sc = { pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4, sack: 1 };
  const lo = C.projectPoints({ pts_allow: 10, sack: 2, pts_allow_7_13: 1 }, sc), hi = C.projectPoints({ pts_allow: 30, sack: 2, pts_allow_28_34: 1 }, sc);
  ok('defense tiers: expected value sits between neighbours and falls as points allowed rise', lo > hi && lo < 2 + 7 && lo > 2 + 1 && hi < 2 + 1 && hi > 2 - 4, `${lo} ${hi}`);
  ok('yardage bonus counts in proportion to its chance', (() => { const a = C.projectPoints({ rec_yd: 60 }, { rec_yd: 0.1, bonus_rec_yd_100: 3 }), b = C.projectPoints({ rec_yd: 110 }, { rec_yd: 0.1, bonus_rec_yd_100: 3 }); return a > 6 && a < 7 && b > 11 + 1.2 && b < 14; })());
  ok('kick distance splits fall back on the 50+ count', Math.abs(C.projectPoints({ fgm: 2, fgm_50p: 1, fga: 3 }, { fgm_50_59: 5, fgm_60p: 6, fgmiss: -1 }) - (0.93 * 5 + 0.07 * 6 - 1)) < 1e-9); }
for (let t = 0; t < 60; t++) {
  const slotPool = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'REC_FLEX', 'WRRB_FLEX'], slots = Array.from({ length: 3 + (t % 3) }, () => slotPool[Math.floor(rnd() * slotPool.length)]);
  const posPool = [['QB'], ['RB'], ['WR'], ['TE'], ['WR', 'RB'], ['TE', 'QB']], players = Array.from({ length: 4 + (t % 4) }, (_, i) => ({ id: 'p' + i, pos: posPool[Math.floor(rnd() * posPool.length)], pts: Math.round(rnd() * 200) / 10 + 0.1 }));
  let best = 0; (function go(k, used, tot) { if (k === slots.length) { if (tot > best) best = tot; return; } go(k + 1, used, tot); players.forEach((p, i) => { if (!used[i] && C.slotAccepts(slots[k], p.pos)) { used[i] = 1; go(k + 1, used, tot + p.pts); used[i] = 0; } }); })(0, {}, 0);
  const got = C.bestLineup(slots, players);
  ok(`best lineup matches brute force (case ${t})`, Math.abs(got.total - best) < 1e-9 && new Set(got.starters.filter(s => s.id).map(s => s.id)).size === got.starters.filter(s => s.id).length, `${got.total} vs ${best}`);
}

/* ---- reading a league ---- */
{ ok('league id from a link', S.parseId('https://sleeper.com/leagues/1313270302943223808/matchup') === '1313270302943223808' && S.parseId('abc') === null);
  ok('title case keeps small words and existing capitals', S.titleCase('cherry pie of the NFL  ') === 'Cherry Pie of the NFL');
  const r = S.rebuild(4, { 1: [[0, 1, 100, 90], [2, 3, 80, 70]] }, true);
  ok('median records: top half win twice, bottom half as they played', r.wins.join() === '2,1,1,0' && r.losses.join() === '0,1,1,2');
  const mk = (rid, w, l, pf) => ({ roster_id: rid, owner_id: 'u' + rid, players: [], starters: [], settings: { wins: w, losses: l, ties: 0, fpts: pf, fpts_against: 500 } });
  const raw = { league: { league_id: '1', name: 'test league', season: '2026', status: 'in_season', settings: { playoff_teams: 2, playoff_week_start: 4, num_teams: 4, last_scored_leg: 1, type: 2, draft_rounds: 3 }, roster_positions: ['QB', 'BN'], scoring_settings: {} }, state: { week: 2 },
    users: [], rosters: [mk(1, 1, 0, 100), mk(2, 0, 1, 90), mk(3, 1, 0, 80), mk(4, 0, 1, 70)], winners: [], losers: [], traded: [], drafts: [],
    matchups: { 1: [{ roster_id: 1, matchup_id: 1, points: 100 }, { roster_id: 2, matchup_id: 1, points: 90 }, { roster_id: 3, matchup_id: 2, points: 80 }, { roster_id: 4, matchup_id: 2, points: 70 }],
      2: [{ roster_id: 1, matchup_id: 1, points: 0 }, { roster_id: 3, matchup_id: 1, points: 0 }, { roster_id: 2, matchup_id: 2, points: 0 }, { roster_id: 4, matchup_id: 2, points: 0 }],
      3: [{ roster_id: 1, matchup_id: 1, points: 0 }, { roster_id: 4, matchup_id: 1, points: 0 }, { roster_id: 2, matchup_id: 2, points: 0 }, { roster_id: 3, matchup_id: 2, points: 0 }] } };
  const D = S.normalize(raw);
  ok('reads phase, weeks and schedule', D.phase === 'regular' && D.through === 1 && Object.keys(D.schedule).join() === '2,3' && D.results[1].length === 2 && D.set.regEnd === 3);
  const cfg = M.buildConfig(D, null, { draft: { nonPlayoff: 'maxpf', playoff: 'place' } }), res = E.simulate(cfg, [], 2000, 1);
  ok('a tiny league runs end to end', Math.abs(sum(res.playoff, res.wsum) - 2) < 1e-9 && cfg.mode === 'season');
  raw.league.settings.type = 3; ok('guillotine leagues get a clear message', S.normalize(raw).phase === 'unsupported');
  raw.league.settings.type = 2; raw.league.status = 'pre_draft'; ok('undrafted leagues get a clear message', S.normalize(raw).phase === 'pre'); }

console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
