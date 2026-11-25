// Research: does our seeding + bracket shape match what Sleeper built, across the surveyed finished 2025 leagues?
const C = require('../js/core.js'), fs = require('fs');
const L = JSON.parse(fs.readFileSync('/home/claude/fx/survey/survey_2025.json', 'utf8')).filter(x => x && !x.error);
const tally = {}, bump = (k, by = 1) => { tally[k] = (tally[k] || 0) + by; };
const shapes = {}, examples = [];
let n = 0;
for (const lg of L) {
  const s = lg.s, R = lg.rosters || [];
  if (!lg.wb || !lg.wb.length || !R.length) { bump('skip: no bracket or rosters (type ' + s.type + ', P ' + s.P + ')'); continue; }
  n++;
  const ids = R.map(r => r.rid), t = { wins: R.map(r => r.w || 0), losses: R.map(r => r.l || 0), ties: R.map(r => r.t || 0), pf: R.map(r => r.pf), pa: R.map(r => r.pa) };
  const div = s.div > 1 ? R.map(r => r.div) : null;
  const order = C.seedOrder(t, div, s.div), seedOf = {};
  const P = s.P;
  order.forEach((i, sd) => { if (sd < P) seedOf[ids[i]] = sd; });
  const br = C.bracketFromSleeper(lg.wb, seedOf);
  const tag = `P${P} div${s.div} st${s.st} rt${s.rt} med${s.med}${s.ovr ? ' OVR' : ''}`;
  if (!br) {
    // which bracket teams are not in our top P?
    const teams = new Set(); lg.wb.forEach(x => { if (typeof x.t1 === 'number' && !x.t1_from) teams.add(x.t1); if (typeof x.t2 === 'number' && !x.t2_from) teams.add(x.t2); });
    const mine = new Set(order.slice(0, P).map(i => ids[i])), extra = [...teams].filter(x => !mine.has(x));
    // would ignoring divisions fix it?
    let fix = '';
    if (div) { const o2 = C.standingsOrder(t), m2 = new Set(o2.slice(0, P).map(i => ids[i])); if ([...teams].every(x => m2.has(x))) fix = ' (matches when divisions are ignored)'; }
    bump('MISMATCH set ' + tag + fix); if (examples.length < 12) examples.push({ tag, n: s.n, bracketTeams: teams.size, extra, order: order.map(i => `${ids[i]}:${t.wins[i]}-${t.losses[i]}${t.ties[i] ? '-' + t.ties[i] : ''} ${t.pf[i]}${div ? ' d' + div[i] : ''}`).slice(0, P + 3) });
    continue;
  }
  const key = C.bracketKey(br), std = C.bracketKey(C.standardBracket(P));
  if (key === std) bump('ok ' + (div ? 'div ' : '') + 'P' + P + (s.st ? ' reseed' : ''));
  else { bump('SHAPE differs ' + tag); (shapes[`P${P} st${s.st}`] = shapes[`P${P} st${s.st}`] || {})[key] = ((shapes[`P${P} st${s.st}`] || {})[key] || 0) + 1; }
}
console.log('leagues with brackets:', n);
Object.keys(tally).sort().forEach(k => console.log(String(tally[k]).padStart(5), k));
console.log('\nnon-standard shapes:'); for (const k in shapes) { console.log(k); for (const sh in shapes[k]) console.log('   ', shapes[k][sh], sh); console.log('    std:', C.bracketKey(C.standardBracket(Number(k.slice(1).split(' ')[0])))); }
console.log('\nset mismatches (examples):'); examples.forEach(e => console.log(JSON.stringify(e)));
