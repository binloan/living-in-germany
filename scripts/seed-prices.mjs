// Puts the average rents of the city's seed/rents.json (EUR per m²) on the shared price list, one report per price zone
// (Berlin Ortsteil, Potsdam Stadtteil) at a point inside it. Safe to run twice: a zone that already has that price is skipped.
// Zone keys: whatever the city's zone module (seedKey in cities/<id>/steps/zones.mjs) says: "Bezirk/Ortsteil" for Berlin, the Stadtteil id (P11 ...) for Potsdam.
// Usage: node scripts/seed-prices.mjs [--city <id>] [--url https://your-app.appspot.com | --live] [--file cities/<id>/seed/rents.json] [--delay ms]
//   --live  the deployed app of GCP_PROJECT_ID (https://<project>.appspot.com)
//   --runtime  copies the prices of your local server (cities/<id>/runtime/prices.json, a list of { lat, lon, value }) to the live one, e.g. with --live
// The server allows 20 writes per minute per IP (PRICE_WRITES_PER_MIN), so the default pace is one every 3.2 s.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import 'dotenv/config';
import { CITIES, readCityIndex, stepFile } from './data/paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const live = process.argv.includes('--live');
if (live && !process.env.GCP_PROJECT_ID) { console.error('--live needs GCP_PROJECT_ID in .env'); process.exit(1); }
const base = (live ? `https://${process.env.GCP_PROJECT_ID}.appspot.com` : arg('url', `http://localhost:${process.env.PORT || 8080}`)).replace(/\/+$/, '');
const delay = Number(arg('delay', 3200));
const city = arg('city', readCityIndex().default);
const cityDir = path.join(CITIES, String(city));
if (!fs.existsSync(path.join(cityDir, 'city.json'))) { console.error(`unknown city "${city}"`); process.exit(1); }
const loaded = JSON.parse(fs.readFileSync(path.resolve(root, process.argv.includes('--runtime') ? path.join(cityDir, 'runtime', 'prices.json') : arg('file', path.join(cityDir, 'seed', 'rents.json'))), 'utf8'));
const plain = Array.isArray(loaded); // a plain list of prices (the local server's file), not the per-zone seed
const seed = plain ? { zones: [] } : loaded;
const { zones } = JSON.parse(fs.readFileSync(path.join(cityDir, 'generated', 'zones.json'), 'utf8'));
// how the seed file names a zone is the city's own rule (pipeline.zones of its manifest)
const manifest = JSON.parse(fs.readFileSync(path.join(cityDir, 'city.json'), 'utf8'));
const { seedKey } = await import(pathToFileURL(stepFile(cityDir, manifest.pipeline.zones)).href);
const byKey = new Map(zones.map((z) => [seedKey(z), z]));

const existing = (await (await fetch(`${base}/api/prices?city=${city}`)).json()).prices;
const near = (a, b) => Math.hypot((a.lon - b.lon) * 68_000, (a.lat - b.lat) * 111_000) < 100;
let added = 0;
const send = async (label, p) => {
  if (existing.some((q) => near(q, p) && q.value === p.value)) return;
  const res = await fetch(`${base}/api/prices?city=${city}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: p.lat, lon: p.lon, value: p.value }) });
  if (!res.ok) console.warn(`! ${label}: ${res.status}`);
  else { added++; process.stdout.write(`\r${added} added`); }
  if (delay) await new Promise((r) => setTimeout(r, delay));
};
if (plain) {
  for (const p of loaded) await send(`${p.lat},${p.lon}`, p);
  console.log(`\n${added} of ${loaded.length} prices added to ${base} (the rest were there already)`);
  await new Promise((r) => setTimeout(r, 200)); // let the connections close before exiting (a Windows libuv assertion otherwise)
  process.exit(0);
}
const left = new Set(byKey.keys());
for (const k of Object.keys(seed.noData ?? {})) left.delete(k); // left empty on purpose
for (const e of seed.zones) {
  const z = byKey.get(e.zone);
  if (!z) { console.warn(`! ${e.zone}: no such zone`); continue; }
  left.delete(e.zone);
  const p = { lat: z.c[1], lon: z.c[0], value: e.value };
  if (existing.some((q) => near(q, p) && q.value === e.value)) continue;
  const res = await fetch(`${base}/api/prices?city=${city}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
  if (!res.ok) console.warn(`! ${e.zone}: ${res.status}`);
  else added++;
  if (delay) await new Promise((r) => setTimeout(r, delay));
}
console.log(`${added} added to ${base}`);
if (seed.noData) console.log(`left empty on purpose (no published rent): ${Object.keys(seed.noData).join(', ')}`);
if (left.size) console.log(`zones without a value in the file: ${[...left].join(', ')}`);
