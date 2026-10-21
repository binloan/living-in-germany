// Metric `pop_age` (lower = younger = better) for any city: mean age of the residents, from the Zensus 2022 100 m grid ("Durchschnittsalter"),
// averaged per H3 res-9 hex and weighted by the residents of each grid cell. A hex with too few residents has no value (no filling).
import { CITY, loadCells, writeMetric, writeSources } from '../lib.mjs';
import { ZENSUS, ZENSUS_ATTRIBUTION, ZENSUS_LICENSE, populationGrid, meanAgeGrid } from '../zensus.mjs';

const MIN_HEX_POP = 20; // fewer census residents in a hex: the age is too noisy to show
const { byCell } = await populationGrid(CITY.bbox);
const { byHex, cells: nCells } = await meanAgeGrid(CITY.bbox, byCell);
console.log(`Zensus age grid cells in the box: ${nCells}`);
const raw = {};
for (const h of loadCells().ids) {
  const z = byHex.get(h);
  if (z && z[1] >= MIN_HEX_POP) raw[h] = z[0] / z[1];
}

writeMetric('pop_age', raw, {
  unit: 'years',
  note: `Mean age of the residents: Zensus 2022 100 m grid "Durchschnittsalter" (15.05.2022, mean age per cell, perturbed by the cell-key method), averaged per H3 hex weighted by the residents of each cell. Hexes with fewer than ${MIN_HEX_POP} census residents (parks, water, thinly built edges) have no value. Lower = younger = better.`,
});
writeSources('pop_age.json', JSON.stringify([{
  name: 'Zensus 2022 – Durchschnittsalter in Gitterzellen (100 m grid)',
  url: ZENSUS.age.url,
  license: ZENSUS_LICENSE,
  attribution: ZENSUS_ATTRIBUTION,
  accessed: new Date().toISOString().slice(0, 10),
  note: `File ${ZENSUS.age.csv} (mean age per 100 m cell, Stichtag 15.05.2022), averaged per H3 res-9 hex weighted by cell residents. Found via https://www.zensus2022.de/DE/Ergebnisse-des-Zensus/gitterzellen.html.`,
}, {
  name: 'Zensus 2022 – Bevölkerungszahl in 100-m-Gitterzellen (population weights)',
  url: ZENSUS.population.url,
  license: ZENSUS_LICENSE,
  attribution: ZENSUS_ATTRIBUTION,
  accessed: new Date().toISOString().slice(0, 10),
  note: `File ${ZENSUS.population.csv}; used only as weights for the mean age.`,
}], null, 2) + '\n');
