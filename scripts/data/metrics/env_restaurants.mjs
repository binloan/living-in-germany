// Metric `restaurants` (more = better): how many restaurants are around, times how good the best ones of the area are.
//   raw = count(OSM amenity=restaurant within 600 m of the hex centre) * q
//   q   = clamp((avg - 4.0) / 0.7, 0.1, 1), avg = mean rating of the area's 20 most popular restaurants (05-ratings.mjs)
// So a street full of average places and a street with a few outstanding ones both score, a street full of outstanding ones scores most.
import path from 'node:path';
import fs from 'node:fs';
import { CACHE, haversineM, loadAreas, loadCells, readJson, writeMetric } from '../lib.mjs';
import { loadRestaurants } from '../lib_restaurants.mjs';

const QFILE = path.join(CACHE, 'ratings', 'quality.json');
if (!fs.existsSync(QFILE)) {
  console.warn('[metric:restaurants] no ratings yet: run `npm run data:ratings` first (needs a RATINGS_PROVIDER, see scripts/data/ratings/template.mjs). Skipped.');
  process.exit(0);
}
const quality = readJson(QFILE);
const cells = loadCells();
const areas = loadAreas().features;
const RADIUS = 600;

const restaurants = await loadRestaurants();
const B = 0.01, bk = new Map();
for (const r of restaurants) {
  const k = Math.floor(r.lat / B) + ',' + Math.floor(r.lon / B);
  if (!bk.has(k)) bk.set(k, []);
  bk.get(k).push(r);
}
const q = areas.map((f) => {
  const a = quality[f.properties.id]?.avg;
  return a == null ? 0.1 : Math.min(1, Math.max(0.1, (a - 4.0) / 0.7));
});

const raw = {};
cells.ids.forEach((h, i) => {
  const la = cells.lat[i], lo = cells.lon[i], bi = Math.floor(la / B), bj = Math.floor(lo / B);
  let n = 0;
  for (let di = -1; di <= 1; di++) for (let dj = -2; dj <= 2; dj++) {
    for (const r of bk.get(`${bi + di},${bj + dj}`) ?? []) if (haversineM(la, lo, r.lat, r.lon) <= RADIUS) n++;
  }
  raw[h] = n * q[cells.area[i]];
});

writeMetric('restaurants', raw, {
  unit: 'restaurants x quality',
  note: `OSM restaurants within ${RADIUS} m of the hex centre, times a quality factor from 0.1 to 1 per area: the average rating of the area's 20 most popular restaurants (ratings shrunk towards 4.0 for places with few reviews), 4.0 stars or less = 0.1 up to 4.7 stars = 1. Zero means no restaurant mapped nearby.`,
});
