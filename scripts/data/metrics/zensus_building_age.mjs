// Metric `building_age` (newer = better) for any city: average construction year of buildings with dwellings, from the Zensus 2022 100 m grid
// "Gebäude nach Baujahr in Mikrozensus-Klassen". Mean year per hex = sum(buildings * class year) / sum(buildings). A hex with fewer than
// MIN_B buildings has no value (no filling).
import { CITY, loadCells, writeMetric, writeSources } from '../lib.mjs';
import { ZENSUS, ZENSUS_ATTRIBUTION, ZENSUS_LICENSE, buildingYearGrid } from '../zensus.mjs';

const MIN_B = 2;
// the class midpoints; Vor1919 is 1900 because it is dominated by the Gründerzeit
const CLASS_YEAR = { Vor1919: 1900, a1919bis1948: 1934, a1949bis1978: 1964, a1979bis1990: 1985, a1991bis2000: 1996, a2001bis2010: 2006, a2011bis2019: 2015, a2020undspaeter: 2021 };
const { byHex, cells: nCells } = await buildingYearGrid(CITY.bbox, CLASS_YEAR);
console.log(`Zensus building grid: ${nCells} cells with class counts`);
const raw = {};
for (const h of loadCells().ids) {
  const z = byHex.get(h);
  if (z && z[1] >= MIN_B) raw[h] = z[0] / z[1];
}

writeMetric('building_age', raw, {
  unit: 'avg year built',
  note: `Zensus 2022 100 m grid "Gebäude nach Baujahr in Mikrozensus-Klassen" (buildings with dwellings, 15.05.2022; classes Vor1919, 1919-48, 1949-78, 1979-90, 1991-2000, 2001-10, 2011-19, 2020+ mapped to 1900, 1934, 1964, 1985, 1996, 2006, 2015, 2021); cell midpoints binned into hexes, mean year weighted by building counts; hexes with fewer than ${MIN_B} buildings are omitted. The classes are coarse (everything before 1919 counts as 1900) and the counts are perturbed, so single values are less precise than a register of the city.`,
});
writeSources('building_age.json', JSON.stringify([{
  name: 'Zensus 2022 – Gebäude nach Baujahr in Mikrozensus-Klassen in Gitterzellen (100 m grid)',
  url: ZENSUS.buildings.url,
  license: ZENSUS_LICENSE,
  attribution: ZENSUS_ATTRIBUTION,
  accessed: new Date().toISOString().slice(0, 10),
  note: `File ${ZENSUS.buildings.csv} (buildings with dwellings per 100 m cell and construction-year class, Stichtag 15.05.2022). Class years: Vor1919=1900, 1919-48=1934, 1949-78=1964, 1979-90=1985, 1991-2000=1996, 2001-10=2006, 2011-19=2015, 2020+=2021; building-weighted mean per H3 res-9 hex. Found via https://www.zensus2022.de/DE/Ergebnisse-des-Zensus/gitterzellen.html.`,
}], null, 2) + '\n');
