// Metric `center` (lower is better): straight-line distance in km from each hex centre to the centre of the city
// (`centre` in the manifest). A smaller place next to it is measured against the same centre.
// Pure geometry, no download.
import { CITY, haversineM, loadCells, writeMetric } from '../lib.mjs';

const CENTRES = [CITY.centre];
const cells = loadCells();
const raw = {};
cells.ids.forEach((id, i) => {
  raw[id] = Math.min(...CENTRES.map((c) => haversineM(cells.lat[i], cells.lon[i], c.lat, c.lon))) / 1000;
});
writeMetric('center', raw, { unit: 'km', note: `Straight-line distance to ${CITY.texts?.centreWhere ?? 'the centre of the city'} (${CENTRES[0].name})` });
