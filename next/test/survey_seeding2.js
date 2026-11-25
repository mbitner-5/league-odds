// Research, second pass: first-round pairings and byes only (re-seeded leagues list later rounds by team), zero-stat leagues skipped.
const C = require('../js/core.js'), fs = require('fs');
const file = process.argv[2] || 'survey_2025.json';
const L = JSON.parse(fs.readFileSync('/home/claude/fx/survey/' + file, 'utf8')).filter(x => x && !x.error);
const tally = {}, bump = k => { tally[k] = (tally[k] || 0) + 1; }, ex = [];
let reseedOk = 0, reseedBad = 0, populated = 0, empty = 0;
for (const lg of L) {
  const s = lg.s, R = lg.rosters || [];
  if (!lg.wb || !lg.wb.length) { empty++; continue; }
  populated++;
  if (!R.length || R.every(r => !(r.w + r.l + r.t))) { bump('skip: no records on rosters'); continue; }
  const ids = R.map(r => r.rid), t = { wins: R.map(r => r.w || 0), losses: R.map(r => r.l || 0), ties: R.map(r => r.t || 0), pf: R.map(r => r.pf), pa: R.map(r => r.pa) };
  const div = s.div > 1 ? R.map(r => r.div) : null, P = s.P;
  const order = C.seedOrder(t, div, s.div), seedOf = {}; order.forEach((i, sd) => { seedOf[ids[i]] = sd; });
  const std = C.standardBracket(P), info = { r1: std.filter(g => g.r === 1).map(g => [g.a.s, g.b.s].sort().join('v')).sort().join(' ') };
  // Sleeper's first-round pairs and bye teams, as seeds under our seeding
  const r1 = lg.wb.filter(x => x.r === 1), later = lg.wb.filter(x => x.r === 2);
  const seedsIn = new Set(); let unknown = false;
  const pairs = r1.map(x => { const a = seedOf[x.t1], b = seedOf[x.t2]; if (a == null || b == null || typeof x.t1 !== 'number' || typeof x.t2 !== 'number') unknown = true; seedsIn.add(a); seedsIn.add(b); return [a, b].sort().join('v'); }).sort().join(' ');
  const tag = `${div ? 'div' + s.div + ' ' : ''}P${P}${s.st ? ' reseed' : ''}${s.med ? ' median' : ''}${s.ovr ? ' OVERRIDE' : ''}`;
  if (unknown) { bump('?? first round not readable ' + tag); continue; }
  const good = pairs === info.r1 && [...seedsIn].every(x => x < P);
  // byes: teams listed directly in round 2 of a fixed bracket
  bump((good ? 'ok   ' : 'DIFF ') + tag);
  if (!good && ex.length < 14) ex.push({ tag, n: s.n, sleeperR1: pairs, ours: info.r1, top: order.slice(0, P + 2).map(i => `${ids[i]}:${t.wins[i]}-${t.losses[i]}${t.ties[i] ? '-' + t.ties[i] : ''}/${t.pf[i]}${div ? '/d' + div[i] : ''}`) });
  // re-seed rule: in round 2 the best seed left meets the worst seed left
  if (good && s.st === 1 && lg.wb.some(x => x.w != null)) {
    const win = {}; r1.forEach(x => { if (x.w != null) win[x.m] = x.w; });
    if (Object.keys(win).length === r1.length) {
      const alive = []; for (let sd = 0; sd < P; sd++) { const rid = ids[order[sd]]; const lost = r1.some(x => x.l === rid); if (!lost) alive.push(sd); }
      const want = []; for (let k = 0; k < alive.length / 2; k++) want.push([alive[k], alive[alive.length - 1 - k]].join('v'));
      const title = later.filter(x => !x.p).map(x => [seedOf[x.t1], seedOf[x.t2]].sort((a, b) => a - b).join('v')).sort().join(' ');
      if (title === want.sort().join(' ')) reseedOk++; else { reseedBad++; if (ex.length < 20) ex.push({ reseed: tag, title, want: want.join(' ') }); }
    }
  }
}
console.log(file, 'leagues', L.length, 'with a bracket', populated, 'without', empty);
Object.keys(tally).sort().forEach(k => console.log(String(tally[k]).padStart(5), k));
console.log('re-seed rule holds in', reseedOk, 'breaks in', reseedBad);
ex.forEach(e => console.log(JSON.stringify(e)));
