// Which clean site names are still unregistered? Asks the public domain registries (RDAP). No league data involved.
import { writeOut, sleep } from './lib.mjs';
const names = ['playoffsandpicks.com', 'playoffsandpicks.app', 'playoffsandpicks.co', 'playoffsandpicks.io', 'playoffsandpicks.football', 'playoffsandpicks.net', 'playoffsandpicks.org', 'playoffsandpicks.xyz', 'playoffspicks.com', 'playoffs-picks.com', 'pandp.football', 'pandp.app', 'pnpodds.com', 'pandpodds.com', 'playoffspicks.app', 'leagueodds.com', 'leagueodds.app', 'leagueodds.io', 'leagueodds.co', 'leagueodds.net', 'leagueodds.org', 'leagueodds.football', 'leagueodds.xyz', 'leagueodds.fyi', 'leagueodds.live', 'leagueodds.site', 'leagueodds.fun',
  'getleagueodds.com', 'myleagueodds.com', 'theleagueodds.com', 'yourleagueodds.com', 'leagueodds.us', 'league-odds.com',
  'playoffodds.app', 'playoffodds.io', 'fantasyplayoffodds.com', 'fantasyleagueodds.com', 'dynastyodds.com', 'dynastyodds.app', 'dynastyodds.io', 'whatifodds.com', 'oddsmyleague.com', 'leaguewhatif.com'];
const out = [];
for (const n of names) {
  let status = null, note = '';
  for (const base of ['https://rdap.org/domain/', 'https://www.rdap.net/domain/']) {
    try { const r = await fetch(base + n, { headers: { Accept: 'application/rdap+json', 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' }); status = r.status; if (r.status === 200) { const j = await r.json().catch(() => null); const ev = j && (j.events || []).find(e => e.eventAction === 'registration'); note = ev ? 'registered ' + String(ev.eventDate).slice(0, 10) : 'registered'; } if (status === 200 || status === 404) break; } catch (e) { note = String(e.message).slice(0, 60); }
    await sleep(400);
  }
  out.push({ name: n, status, verdict: status === 404 ? 'looks unregistered' : status === 200 ? 'taken' : 'unknown', note });
  await sleep(700);
}
writeOut('domains.json', out);
console.log('domains:', out.map(o => `${o.name}=${o.verdict}`).join(', '));
