// Opens the page in a real browser. By default Sleeper is answered from saved fixtures (offline);
// with LIVE=1 it talks to Sleeper. Usage: node next/test/browser.js [leagueId] [shotPrefix]
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), DATA = process.env.SHARED || '/home/claude/fx/e2e/shared', FX = process.env.FX || '/home/claude/fx/e2e/fixtures';
const LIVE = !!process.env.LIVE, id = process.argv[2] || '1313270302943223808', prefix = process.argv[3] || '/tmp/shots/n';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const f = u.startsWith('/data/') ? path.join(DATA, u.slice(6)) : path.join(ROOT, u);
  fs.readFile(f, (e, buf) => { if (e) { res.writeHead(404); res.end('nope'); } else { res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'text/plain' }); res.end(buf); } });
});
function fixtureRoutes() {
  const raw = JSON.parse(fs.readFileSync(path.join(FX, 'seed_raw.json'), 'utf8')), hist = JSON.parse(fs.readFileSync(path.join(FX, 'seed_history.json'), 'utf8'));
  const m = {}; const L = raw.league.league_id;
  m[`/v1/league/${L}`] = raw.league; m['/v1/state/nfl'] = raw.state; m[`/v1/league/${L}/users`] = raw.users; m[`/v1/league/${L}/rosters`] = raw.rosters;
  m[`/v1/league/${L}/winners_bracket`] = raw.winners; m[`/v1/league/${L}/losers_bracket`] = raw.losers; m[`/v1/league/${L}/traded_picks`] = raw.traded; m[`/v1/league/${L}/drafts`] = raw.drafts;
  for (const w in raw.matchups) m[`/v1/league/${L}/matchups/${w}`] = raw.matchups[w];
  let following = raw.drafts[0];
  hist.forEach(h => { const id2 = h.league.league_id; m[`/v1/league/${id2}`] = h.league; m[`/v1/league/${id2}/rosters`] = h.rosters; m[`/v1/league/${id2}/winners_bracket`] = h.winners; if (h.draft) m[`/v1/draft/${h.draft.draft_id}`] = h.draft; });
  // each past league's own draft list: the draft that followed the season before it
  hist.forEach((h, k) => { const own = hist[k + 1] ? hist[k + 1].draft : null; m[`/v1/league/${h.league.league_id}/drafts`] = own ? [{ draft_id: own.draft_id }] : []; });
  try { Object.assign(m, JSON.parse(fs.readFileSync(path.join(FX, 'extra_routes.json'), 'utf8'))); } catch (e) {}
  return m;
}
(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const routes = LIVE ? null : fixtureRoutes(), errs = [], misses = [];
  let fontCss = '';
  try { const font = fs.readFileSync('/tmp/fonts/node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2').toString('base64'); fontCss = '@font-face{font-family:"Archivo";src:url(data:font/woff2;base64,' + font + ') format("woff2");font-weight:100 900;font-stretch:62% 125%;}'; } catch (e) {}
  for (const [w, dpr] of [[393, 2], [1280, 1]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 860 }, deviceScaleFactor: dpr }), p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    if (!LIVE) {
      await p.route('https://api.sleeper.app/**', route => { const u = new URL(route.request().url()); const hit = routes[u.pathname]; if (hit === undefined) { misses.push(u.pathname); return route.fulfill({ status: 404, body: 'null', headers: { 'access-control-allow-origin': '*' } }); } route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hit), headers: { 'access-control-allow-origin': '*' } }); });
      await p.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: fontCss }));
    }
    const t0 = Date.now();
    await p.goto(`http://localhost:${port}/?league=${id}`);
    await p.waitForFunction(() => !document.getElementById('app').hidden && document.querySelector('table.odds') || !document.getElementById('message').hidden || !document.getElementById('start').hidden, null, { timeout: 45000 });
    const ms = Date.now() - t0;
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: `${prefix}_${w}_1.png` });
    const info = await p.evaluate(() => ({ app: !document.getElementById('app').hidden, msg: document.getElementById('message').textContent.slice(0, 200), title: document.title, tabs: [...document.querySelectorAll('.tabs button')].filter(b => !b.hidden).map(b => b.textContent), meta: document.getElementById('meta').textContent, flags: (document.getElementById('flags') || {}).textContent || '', err: window.__loError || null, mode: window.__lo && window.__lo.cfg && window.__lo.cfg.mode }));
    console.log(w, ms + 'ms', JSON.stringify(info));
    if (process.env.SHOWLIVE) console.log('  live', await p.evaluate(() => { const c = window.__lo.cfg; return c.live ? JSON.stringify({ week: c.live.week, banked: c.live.banked.map(x => Math.round(x)), share: c.live.share.map(x => Math.round(x * 100) / 100) }) : 'none'; }));
    if (info.app) {
      const widths = [];
      for (const tab of info.tabs) { const key = { Playoffs: 'playoffs', 'Draft picks': 'draft', Lineups: 'lineups', 'How it works': 'method' }[tab]; await p.locator('#tab-' + key).click(); await p.waitForTimeout(150); widths.push(key + ':' + await p.evaluate(() => document.documentElement.scrollWidth)); await p.screenshot({ path: `${prefix}_${w}_${key}.png`, fullPage: key !== 'playoffs' && w > 1000 }); }
      console.log('  widths', widths.join(' '));
      await p.locator('#tab-playoffs').click();
      const sides = await p.locator('.side').count();
      if (sides) { await p.locator('.side').nth(1).click(); await p.waitForTimeout(600); await p.locator('.tbtn').first().click(); await p.waitForTimeout(200); await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: `${prefix}_${w}_pick.png`, fullPage: true }); }
    }
    await ctx.close();
  }
  // start screen
  { const ctx = await browser.newContext({ viewport: { width: 393, height: 760 }, deviceScaleFactor: 2 }), p = await ctx.newPage();
    if (!LIVE) await p.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: fontCss }));
    p.on('pageerror', e => errs.push('PAGEERROR start ' + e.message));
    await p.goto(`http://localhost:${port}/`); await p.waitForSelector('#start:not([hidden])'); await p.evaluate(() => document.fonts.ready); await p.screenshot({ path: `${prefix}_start.png` }); await ctx.close(); }
  console.log('errors:', errs.length ? errs.slice(0, 8) : 'none', misses.length ? 'unrouted: ' + [...new Set(misses)].slice(0, 6).join(' ') : '');
  await browser.close(); server.close(); process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
