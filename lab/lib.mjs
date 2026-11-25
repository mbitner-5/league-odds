// Shared helpers for the lab: polite, cached access to public fantasy APIs, and anonymous ids.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CACHE = process.env.LAB_CACHE || '.labcache';
const GAP = Number(process.env.LAB_GAP_MS || 85);          // about 11 requests a second, well under Sleeper's limit
let last = 0, chain = Promise.resolve();
export const sleep = ms => new Promise(r => setTimeout(r, ms));
function slot() {
  const p = chain.then(() => new Promise(r => { const wait = Math.max(0, last + GAP - Date.now()); setTimeout(() => { last = Date.now(); r(); }, wait); }));
  chain = p; return p;
}
export let calls = 0, hits = 0;
export async function getJSON(url, { ttlHours = 0, headers = {} } = {}) {
  const key = crypto.createHash('sha1').update(url).digest('hex'), file = path.join(CACHE, key.slice(0, 2), key + '.json');
  if (fs.existsSync(file) && (!ttlHours || Date.now() - fs.statSync(file).mtimeMs < ttlHours * 3600e3)) { hits++; return JSON.parse(fs.readFileSync(file, 'utf8')); }
  for (let a = 0; ; a++) {
    await slot(); calls++;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (league-odds lab)', Accept: 'application/json', ...headers } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(j));
      return j;
    } catch (e) { if (a >= 3) throw e; await sleep(1500 * (a + 1)); }
  }
}
export const anon = id => crypto.createHash('sha256').update('league-odds:' + id).digest('hex').slice(0, 10);
export const S = 'https://api.sleeper.app/v1';
export function tally(map, key, by = 1) { key = String(key); map[key] = (map[key] || 0) + by; }
// keys of an object with a count and a sample of each value's type
export function shape(objs, max = 400) {
  const out = {};
  for (const o of objs.slice(0, max)) for (const k in (o || {})) { const v = o[k], t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v; (out[k] = out[k] || { n: 0, types: {} }).n++; out[k].types[t] = (out[k].types[t] || 0) + 1; }
  return out;
}
export function writeOut(name, data) {
  const f = path.join('lab-out', name); fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data, null, 1));
}
export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: String(e && e.message || e) }; } } }));
  return out;
}
