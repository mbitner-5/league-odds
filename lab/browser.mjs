// Opens the deployed preview in a real browser for a spread of real leagues and reports what happened, anonymously.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { anon, writeOut, getJSON, sleep } from './lib.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = process.env.SITE || 'https://mbitner-5.github.io/league-odds/next/';
const ids = JSON.parse(fs.readFileSync('.labcache/survey_ids.json', 'utf8'));
const t0 = Date.now();

// wait until the deployed page is the code in this commit
const want = fs.readFileSync('next/js/main.js', 'utf8');
let live = false;
for (let k = 0; k < 40 && !live; k++) { try { const r = await fetch(SITE + 'js/main.js?t=' + Date.now()); live = r.ok && (await r.text()) === want; } catch (e) {} if (!live) await sleep(15000); }
const meta = await (await fetch(SITE + 'data/meta.json?t=' + Date.now())).json().catch(() => null);

// a spread of league shapes: one of each settings combination, capped
const seen = new Set(), pick = [];
for (const [list, cap] of [[ids.live26, 26], [ids.fin25, 6]]) {
  let n = 0;
  for (const id of list) {
    if (n >= cap) break;
    const L = await getJSON(`https://api.sleeper.app/v1/league/${id}`, { ttlHours: 72 }); if (!L) continue;
    const s = L.settings || {}, key = [L.status, s.num_teams, s.playoff_teams, s.league_average_match, s.divisions || 0, s.playoff_seed_type, s.type, s.best_ball, s.playoff_round_type, (L.roster_positions || []).filter(p => /IDP|DL|LB|DB|SUPER|K$|DEF/.test(p)).sort().join()].join('|');
    if (seen.has(key)) continue; seen.add(key); pick.push({ id, key }); n++;
  }
}
const browser = await chromium.launch();
const out = [];
async function visit(id, key, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 850 }, deviceScaleFactor: 1 }), p = await ctx.newPage();
  const rec = { h: anon(id), key, width, errors: [] };
  p.on('console', m => { if (m.type() === 'error') rec.errors.push(m.text().slice(0, 200).replace(/\d{15,}/g, '#')); });
  p.on('pageerror', e => rec.errors.push('PAGEERROR ' + String(e.message).slice(0, 300)));
  try {
    const t = Date.now();
    await p.goto(SITE + '?league=' + id, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => (!document.getElementById('app').hidden && document.querySelector('table.odds')) || !document.getElementById('message').hidden || !document.getElementById('start').hidden, null, { timeout: 60000 });
    rec.ms = Date.now() - t;
    const st = await p.evaluate(() => { const lo = window.__lo || {}; return { app: !document.getElementById('app').hidden, message: !document.getElementById('message').hidden, start: !document.getElementById('start').hidden, tabs: [...document.querySelectorAll('.tabs button')].filter(b => !b.hidden).map(b => b.id.slice(4)),
      phase: lo.league && lo.league.phase, mode: lo.cfg && lo.cfg.mode, haveProj: lo.cfg && lo.cfg.haveProj, n: lo.league && lo.league.n, games: lo.cfg && lo.cfg.games.length, flags: !!document.getElementById('flags'), err: window.__loError ? String(window.__loError).slice(0, 400).replace(/\d{15,}/g, '#') : null,
      rows: document.querySelectorAll('table.odds tbody tr.r').length, why: lo.league && lo.league.why ? 1 : 0 }; });
    Object.assign(rec, st);
    if (st.app) {
      rec.overflow = [];
      for (const tab of st.tabs) { await p.locator('#tab-' + tab).click(); await p.waitForTimeout(120); const w = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (w > 1) rec.overflow.push(tab + ':' + w); }
      await p.locator('#tab-playoffs').click();
      const sides = await p.locator('.side').count(); rec.sides = sides;
      if (sides) { const t2 = Date.now(); await p.locator('.side').first().click(); await p.waitForFunction(() => document.querySelector('.changes') || document.querySelector('.side[aria-pressed="true"]'), null, { timeout: 20000 }); await p.waitForTimeout(700); rec.msPick = Date.now() - t2; rec.pickShown = await p.locator('.side[aria-pressed="true"]').count(); }
      await p.locator('.tbtn').first().click(); await p.waitForTimeout(150); rec.drawer = await p.locator('.detail').count();
      if (await p.locator('#basis:not([hidden]) button[data-mode="season"]').count()) { await p.locator('#basis button[data-mode="season"]').click(); await p.waitForTimeout(500); rec.modeAfter = await p.evaluate(() => window.__lo.cfg.mode); }
      if (st.tabs.includes('draft')) { await p.locator('#tab-draft').click(); await p.waitForTimeout(150); rec.draftRows = await p.locator('table.odds tbody tr.r').count(); rec.holders = await p.locator('table.own tbody tr').count(); }
      await p.locator('#tab-lineups').click(); await p.waitForTimeout(150); rec.lineupCards = await p.locator('.lcard').count();
    }
  } catch (e) { rec.errors.push('TEST ' + String(e.message).slice(0, 300).replace(/\d{15,}/g, '#')); }
  await ctx.close(); out.push(rec);
}
for (const [k, lg] of pick.entries()) await visit(lg.id, lg.key, k % 4 === 3 ? 1280 : 393);
// the start screen: a bad id, and a username lookup (the repo owner's own public username)
const extra = {};
{ const ctx = await browser.newContext({ viewport: { width: 393, height: 800 } }), p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e.message)));
  await p.goto(SITE + '?league=123456789012345678'); await p.waitForFunction(() => !document.getElementById('start').hidden || !document.getElementById('message').hidden, null, { timeout: 30000 });
  extra.badId = await p.evaluate(() => ({ start: !document.getElementById('start').hidden, err: document.getElementById('start-err').textContent.replace(/\d{15,}/g, '#') }));
  await p.goto(SITE); await p.waitForSelector('#start:not([hidden])'); await p.fill('#q', 'BittyG'); await p.click('#go-btn');
  await p.waitForFunction(() => !document.getElementById('found').hidden || !document.getElementById('start-err').hidden, null, { timeout: 30000 });
  extra.username = await p.evaluate(() => ({ leagues: document.querySelectorAll('#found a').length, err: document.getElementById('start-err').hidden ? '' : document.getElementById('start-err').textContent }));
  await p.fill('#q', 'https://sleeper.com/leagues/1313270302943223808/matchup'); await p.click('#go-btn'); await p.waitForFunction(() => !document.getElementById('app').hidden && document.querySelector('table.odds'), null, { timeout: 60000 });
  extra.link = await p.evaluate(() => ({ title: document.title, recent: (JSON.parse(localStorage.getItem('league-odds-recent')) || []).length }));
  extra.errors = errs; await ctx.close(); }
await browser.close();
const bad = out.filter(r => r.errors.length || r.err || (r.overflow && r.overflow.length) || (!r.app && !r.message));
writeOut('browser.json', { when: new Date().toISOString(), site: SITE, deployed: live, meta, visited: out.length, bad: bad.length, extra, secs: Math.round((Date.now() - t0) / 1000), results: out });
console.log('browser done: visited', out.length, 'bad', bad.length, 'deployed', live, JSON.stringify(extra).slice(0, 300));
