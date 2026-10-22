// Metric `density` (lower is better) for any city: residents per hectare, from the Zensus 2022 100 m grid, which exists for all of Germany.
// Every grid cell is exactly 1 ha, so the residents of the cells in a hex divided by the hex area is the gross density. The grid lists
// inhabited cells only, so a hex without a cell has no residents (density 0). A city whose area holds a lot of forest, water or airport
// can leave those hexes out instead (pipeline.densityOmitEmpty in its manifest): otherwise half of its hexes score a perfect 100.
import { cellArea } from 'h3-js';
import { CITY, loadCells, writeMetric, writeSources } from '../lib.mjs';
import { ZENSUS, ZENSUS_ATTRIBUTION, ZENSUS_LICENSE, populationGrid } from '../zensus.mjs';

const { byHex } = await populationGrid(CITY.bbox);
const cells = loadCells();
const raw = {};
const omitEmpty = CITY.pipeline.densityOmitEmpty === true;
for (const h of cells.ids) if (!omitEmpty || byHex.has(h)) raw[h] = (byHex.get(h) || 0) / (cellArea(h, 'm2') / 10000);

writeMetric('density', raw, {
  unit: 'residents/ha',
  note: 'Gross residential density: residents of the Zensus 2022 100 m grid (15.05.2022) summed per H3 res-9 hex and divided by the full hex area (~10.5 ha); parks, water and industry inside a hex dilute it. Cells are binned into hexes by their midpoint; the grid lists inhabited cells only, so a hex without a cell counts as 0 residents.',
});
writeSources('density.json', JSON.stringify([{
  name: 'Zensus 2022 – Bevölkerungszahl in 100-m-Gitterzellen',
  url: ZENSUS.population.url,
  license: ZENSUS_LICENSE,
  attribution: ZENSUS_ATTRIBUTION,
  accessed: new Date().toISOString().slice(0, 10),
  note: `File ${ZENSUS.population.csv} (EPSG:3035 cell midpoints, residents at 15.05.2022), summed per H3 res-9 hex / hex area.`,
}], null, 2) + '\n');
