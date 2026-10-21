// Metric `center` (lower is better): straight-line distance in km from each hex centre to the centre of Berlin
// (Alexanderplatz). Potsdam is an alternative to living in Berlin, so its hexes are measured against Berlin too.
// Pure geometry, no download.
import { CITY, haversineM, loadCells, writeMetric } from '../lib.mjs';

const CENTRES = [CITY.centre];
const cells = loadCells();
const raw = {};
cells.ids.forEach((id, i) => {
  raw[id] = Math.min(...CENTRES.map((c) => haversineM(cells.lat[i], cells.lon[i], c.lat, c.lon))) / 1000;
});
writeMetric('center', raw, { unit: 'km', note: `Straight-line distance to the centre of Berlin (${CENTRES[0].name})` });
