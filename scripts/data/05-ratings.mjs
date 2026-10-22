// How good are the restaurants of each area? One ratings request per area asks a provider (RATINGS_PROVIDER, see ratings/template.mjs)
// for the 20 most popular restaurants around the area's restaurant cluster and keeps ONE number per area: the average of their
// ratings (shrunk towards 4.0 so a place with 3 reviews counts less than one with 3,000). The ratings themselves are not stored.
//   node scripts/data/05-ratings.mjs --dry-run     count the requests, send nothing
//   node scripts/data/05-ratings.mjs               ask the provider
//   --limit N   only the first N areas that still lack a result
// A counter in cities/<id>/cache/ratings/usage.json refuses to go beyond the provider's monthly limit (or RATINGS_MAX_REQUESTS).
// Finished areas are remembered, so a rerun only asks for the missing ones.
// Output: cities/<id>/cache/ratings/quality.json { [areaId]: { avg, n, good } } and source.json (who the ratings are from)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import 'dotenv/config';
import { CITIES } from './paths.mjs';
import { CACHE, haversineM, loadAreas, loadCells, readJson, writeJson } from './lib.mjs';
import { loadRestaurants } from './lib_restaurants.mjs';

const DIR = path.join(CACHE, 'ratings');
const OUT = path.join(DIR, 'quality.json');
const USAGE = path.join(DIR, 'usage.json');
const SOURCE = path.join(DIR, 'source.json');
const dry = process.argv.includes('--dry-run');
const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || Infinity;
const RADIUS = 700;
const PRIOR = { rating: 4.0, reviews: 20 };
const GOOD = { rating: 4.5, reviews: 100 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadProvider() {
  const name = process.env.RATINGS_PROVIDER;
  if (!name) { console.error('RATINGS_PROVIDER is not set in .env. Pick a ratings service: copy scripts/data/ratings/template.mjs, fill it in and name it there.'); process.exit(1); }
  if (!/^[\w-]+(\/[\w-]+)?$/.test(name)) { console.error(`RATINGS_PROVIDER "${name}" is not a provider name (letters, digits, - and _, optionally pack/<name>)`); process.exit(1); }
  // `pack/<name>` is your own provider: a file `<name>.mjs` in the folder RATINGS_PACK_DIR names (relative to the app folder; cities/ratings/ when
  // it is not set); a bare name is one of scripts/data/ratings/
  const packDir = process.env.RATINGS_PACK_DIR ? path.resolve(process.cwd(), process.env.RATINGS_PACK_DIR) : path.join(CITIES, 'ratings');
  const file = name.startsWith('pack/') ? path.join(packDir, `${name.slice(5)}.mjs`) : path.join(path.dirname(fileURLToPath(import.meta.url)), 'ratings', `${name}.mjs`);
  if (!fs.existsSync(file)) { console.error(`No provider at ${path.relative(process.cwd(), file)}`); process.exit(1); }
  return import(pathToFileURL(file).href);
}

const provider = await loadProvider();
const maxRequests = Number(process.env.RATINGS_MAX_REQUESTS) || provider.maxRequestsPerMonth || Infinity;
const cells = loadCells();
const areas = loadAreas().features;
const restaurants = await loadRestaurants();
const done = fs.existsSync(OUT) ? readJson(OUT) : {};
const usage = fs.existsSync(USAGE) ? readJson(USAGE) : {};
const month = new Date().toISOString().slice(0, 7);

// where to look: the middle of the densest cluster of an area's restaurants, else the area's own middle
const byArea = new Map();
for (const r of restaurants) {
  const a = cells.area[r.cell];
  if (!byArea.has(a)) byArea.set(a, []);
  byArea.get(a).push(r);
}
const ownCells = new Map();
cells.area.forEach((a, i) => { if (!ownCells.has(a)) ownCells.set(a, []); ownCells.get(a).push(i); });
const centre = (ai) => {
  const list = byArea.get(ai) ?? [];
  let best = null, bestN = -1;
  for (const r of list) {
    const n = list.filter((o) => haversineM(r.lat, r.lon, o.lat, o.lon) < 400).length;
    if (n > bestN) { best = r; bestN = n; }
  }
  if (best) return { lat: best.lat, lon: best.lon };
  const own = ownCells.get(ai);
  if (!own) return null;
  const mid = own[Math.floor(own.length / 2)];
  return { lat: cells.lat[mid], lon: cells.lon[mid] };
};

const todo = [];
areas.forEach((f, ai) => {
  const id = f.properties.id;
  if (done[id]) return;
  const c = centre(ai);
  if (c) todo.push({ id, name: f.properties.name, ...c });
});
const batch = todo.slice(0, limit);
const used = usage[month] ?? 0;
console.log(`${areas.length} areas, ${Object.keys(done).length} done, ${batch.length} requests to send (${used} used this month, limit ${maxRequests}); ${restaurants.length} OSM restaurants`);
if (dry) {
  console.log('dry run: nothing sent. First request would be for', batch[0]);
  process.exit(0);
}
if (!batch.length) process.exit(0);
const problem = provider.notReady?.();
if (problem) { console.error(problem); process.exit(1); }
if (used + batch.length > maxRequests) { console.error(`That would be ${used + batch.length} requests this month, above the limit of ${maxRequests}. Use --limit ${Math.max(0, maxRequests - used)} or raise RATINGS_MAX_REQUESTS on purpose.`); process.exit(1); }

let sent = 0;
for (const c of batch) {
  let places;
  try { places = await provider.ratingsNear({ lat: c.lat, lon: c.lon, radius: RADIUS }); } catch (e) { console.error(`stopped at ${c.name}: ${e.message}`); break; }
  sent++;
  usage[month] = used + sent;
  const rated = places.filter((p) => p.rating != null);
  const shrunk = rated.map((p) => ((p.rating * p.reviews) + PRIOR.rating * PRIOR.reviews) / (p.reviews + PRIOR.reviews));
  done[c.id] = {
    avg: shrunk.length ? Math.round((shrunk.reduce((a, b) => a + b, 0) / shrunk.length) * 1000) / 1000 : null,
    n: rated.length,
    good: rated.filter((p) => p.rating >= GOOD.rating && p.reviews >= GOOD.reviews).length,
  };
  if (sent % 25 === 0) { writeJson(OUT, done); writeJson(USAGE, usage); console.log(`  ${sent}/${batch.length}`); }
  await sleep(150);
}
writeJson(OUT, done);
writeJson(USAGE, usage);
if (sent) writeJson(SOURCE, provider.source);
console.log(`${sent} requests sent; ${Object.keys(done).length}/${areas.length} areas have a result; ${usage[month]} requests this month`);
