// ESPN public leagues through the real page code, then the deployed page in a real browser. Anonymous output.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { anon, writeOut, sleep } from './lib.mjs';
const require = createRequire(import.meta.url);
const C = require('../next/js/core.js'), E = require('../next/js/engine.js'), X = require('../next/js/espn.js'), M = require('../next/js/model.js');
const pub = JSON.parse(fs.readFileSync('.labcache/espn_public.json', 'utf8')), t0 = Date.now();
const get = async url => { const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }); if (r.status === 404 || r.status === 401) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
const out = [];
for (const [k, id] of pub.entries()) {
  const rec = { h: anon('espn' + id) }; let stage = 'load';
  try {
    const raw = await X.load(id, 2026, get); stage = 'normalize'; const D = X.normalize(raw);
    Object.assign(rec, { phase: D.phase, n: D.n, P: D.set && D.set.P, tiebreak: D.set && D.set.tiebreak, div: D.set && D.set.nDiv, seedsMatch: D.seedsMatch, recordsDiffer: D.recordsDiffer, why: D.why ? 1 : 0, slots: D.set && D.set.slots && D.set.slots.length });
    if (D.phase === 'unsupported' || D.phase === 'pre') { out.push(rec); continue; }
    const need = M.weeksNeeded(D); let proj = null;
    if (k < 8 && need.length) { stage = 'rosters'; const t1 = Date.now(); await X.loadRosters(raw, id, 2026, Math.min(need[0] + 1, need[need.length - 1]), get); rec.msRosters = Date.now() - t1; stage = 'project'; const pj = X.project(raw, D, need); proj = pj.proj; rec.projWeeks = Object.keys(pj.proj).length; const w0 = Object.keys(pj.proj)[0]; if (w0) { const tt = pj.proj[w0].totals; rec.projMean = Math.round(tt.reduce((a, b) => a + b, 0) / tt.length); rec.empty = pj.proj[w0].lineups.reduce((a, l) => a + l.filter(s => s.id == null).length, 0); } }
    stage = 'simulate'; const cfg = M.buildConfig(D, proj, {}), res = E.simulate(cfg, [], 4000, 1), sum = a => Array.from(a).reduce((x, y) => x + y, 0) / res.wsum;
    rec.mode = cfg.mode; rec.base = Math.round(cfg.base); rec.bad = [];
    if (Math.abs(sum(res.playoff) - Math.min(D.set.P, D.n)) > 1e-6) rec.bad.push('playoff sum'); if (Math.abs(sum(res.champ) - 1) > 1e-6) rec.bad.push('champ sum');
    const cl = E.clinch(cfg, [], Math.min(D.set.P, D.n)); for (let i = 0; i < D.n; i++) { if (cl.clinched[i] && res.playoff[i] / res.wsum < 0.999999) rec.bad.push('clinched but sim'); if (cl.eliminated[i] && res.playoff[i] > 0) rec.bad.push('eliminated but sim'); }
    out.push(rec);
  } catch (e) { rec.stage = stage; rec.error = String(e && e.stack || e).slice(0, 400); out.push(rec); }
  await sleep(150);
}
// the deployed page in a browser, for a few of them
const browserOut = [];
try {
  const { chromium } = require('playwright'), SITE = 'https://mbitner-5.github.io/league-odds/next/', want = fs.readFileSync('next/js/main.js', 'utf8');
  let live = false; for (let k = 0; k < 40 && !live; k++) { try { const r = await fetch(SITE + 'js/main.js?t=' + Date.now()); live = r.ok && (await r.text()) === want; } catch (e) {} if (!live) await sleep(15000); }
  const browser = await chromium.launch(), ok = out.filter(r => r.phase === 'regular').map(r => r.h), ids = pub.filter(id => ok.includes(anon('espn' + id))).slice(0, 4);
  for (const [k, id] of ids.entries()) {
    const ctx = await browser.newContext({ viewport: { width: k % 2 ? 1280 : 393, height: 850 } }), p = await ctx.newPage(), rec = { h: anon('espn' + id), deployed: live, errors: [] };
    p.on('console', m => { if (m.type() === 'error') rec.errors.push(m.text().slice(0, 200).replace(/\d{5,}/g, '#')); }); p.on('pageerror', e => rec.errors.push('PAGEERROR ' + String(e.message).slice(0, 300)));
    try {
      const t = Date.now(); await p.goto(SITE + '?espn=' + id + '&season=2026', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => (!document.getElementById('app').hidden && document.querySelector('table.odds')) || !document.getElementById('message').hidden || !document.getElementById('start').hidden, null, { timeout: 90000 });
      rec.ms = Date.now() - t;
      Object.assign(rec, await p.evaluate(() => { const lo = window.__lo || {}; return { app: !document.getElementById('app').hidden, mode: lo.cfg && lo.cfg.mode, haveProj: lo.cfg && lo.cfg.haveProj, rows: document.querySelectorAll('table.odds tbody tr.r').length, tabs: [...document.querySelectorAll('.tabs button')].filter(b => !b.hidden).map(b => b.id.slice(4)), err: window.__loError ? String(window.__loError).slice(0, 300) : null, startErr: document.getElementById('start-err').textContent.slice(0, 120) }; }));
      if (rec.app) { const sides = await p.locator('.side').count(); if (sides) { await p.locator('.side').first().click(); await p.waitForTimeout(900); rec.pickShown = await p.locator('.side[aria-pressed="true"]').count(); } await p.locator('#tab-lineups').click(); await p.waitForTimeout(200); rec.lineupCards = await p.locator('.lcard').count(); rec.overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (rec.overflow > 1) rec.wide = await p.evaluate(() => [...document.querySelectorAll('#app *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 14).map(e => ({ tag: e.tagName, cls: e.className && String(e.className).slice(0, 40), w: Math.round(e.getBoundingClientRect().width), right: Math.round(e.getBoundingClientRect().right), kids: e.children.length, len: (e.textContent || '').length, weeks: e.classList && e.classList.contains('seg') ? e.children.length : undefined }))); }
    } catch (e) { rec.errors.push('TEST ' + String(e.message).slice(0, 300)); }
    await ctx.close(); browserOut.push(rec);
  }
  // a private league id must land back on the start screen with the how-to-make-public message
  { const ctx = await browser.newContext(), p = await ctx.newPage(); await p.goto(SITE + '?espn=1&season=2026'); await p.waitForFunction(() => !document.getElementById('start').hidden || !document.getElementById('message').hidden, null, { timeout: 60000 }).catch(() => {}); browserOut.push({ privateLeague: await p.evaluate(() => ({ start: !document.getElementById('start').hidden, text: document.getElementById('start-err').textContent.slice(0, 160) })) }); await ctx.close(); }
  await browser.close();
} catch (e) { browserOut.push({ error: String(e && e.stack || e).slice(0, 400) }); }
const t = f => out.reduce((m, r) => { const k = String(f(r)); m[k] = (m[k] || 0) + 1; return m; }, {});
writeOut('espn_e2e.json', { leagues: out.length, errors: out.filter(r => r.error).length, bad: out.filter(r => r.bad && r.bad.length).length, phase: t(r => r.phase), seedsMatch: t(r => r.phase === 'regular' ? r.tiebreak + ':' + r.seedsMatch : '-'), secs: Math.round((Date.now() - t0) / 1000), results: out, browser: browserOut });
console.log('espn e2e done: leagues', out.length, 'errors', out.filter(r => r.error).length, 'browser', JSON.stringify(browserOut).slice(0, 400));
