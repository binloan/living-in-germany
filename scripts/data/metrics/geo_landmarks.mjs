// Metric `landmarks` (more = better): how close the famous places are, the landmark pins of the map (cities/<id>/generated/pois.json).
// Same fade as the transit stops: a landmark counts fully up to 250 m and fades to nothing at 1,000 m,
//   weight = 1 for d <= 250 m, (1000 - d) / 750 in between, 0 beyond; raw = sum over landmarks of rankWeight * weight.
// rankWeight: rank 1 (the big names) 1.0, rank 2 0.7, rank 3 0.5. Run 04-pois.mjs first. Pure geometry, no download.
import fs from 'node:fs';
import path from 'node:path';
import { GEN, haversineM, loadCells, readJson, writeMetric } from '../lib.mjs';

const FILE = path.join(GEN, 'pois.json');
if (!fs.existsSync(FILE)) {
  console.warn('[metric:landmarks] cities/<id>/generated/pois.json missing: run `npm run data:pois` first. Skipped.');
  process.exit(0);
}
const pois = readJson(FILE);
const RANK_WEIGHT = { 1: 1, 2: 0.7, 3: 0.5 };
const FULL = 250, NONE = 1000;
const cells = loadCells();
const raw = {};
cells.ids.forEach((id, i) => {
  let sum = 0;
  for (const p of pois) {
    const d = haversineM(cells.lat[i], cells.lon[i], p.lat, p.lon);
    if (d >= NONE) continue;
    sum += (RANK_WEIGHT[p.rank] ?? 0.5) * (d <= FULL ? 1 : (NONE - d) / (NONE - FULL));
  }
  raw[id] = sum;
});
writeMetric('landmarks', raw, {
  unit: 'pts',
  note: `${pois.length} landmarks (the map pins). Each counts fully within ${FULL} m of the hex centre, fading linearly to nothing at ${NONE} m; the big names count 1.0, district landmarks 0.7, local ones 0.5. Zero means no landmark within ${NONE} m.`,
});
