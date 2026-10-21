// Step 1 of a city: its named areas and the H3 hex grid. This one makes them up (a grid of square areas, see _synthetic.mjs), so the
// demo needs no download. A real city downloads the boundaries of its statistical areas here; the rest of the step stays the same.
// The contract, which the merge (scripts/data/build.mjs) relies on:
//
//   cache/areas.geo.json   FeatureCollection, full precision. Feature.properties: { id, name, district, city, kind }, where `city` is one
//                          of the manifest's `municipalities`, `district` the larger area above (shown on the spot card), `id` unique.
//   cache/cells.base.json  { res: 9, ids, lat, lon, area } the H3 cells whose centre lies inside an area; area[i] is the index of cell i's
//                          area in areas.geo.json.
//   generated/areas.json   the same areas, simplified (turf.simplify, tolerance 0.0002, 5 decimals).
//
// Shared helpers come from scripts/data/lib.mjs, imported as '#data/lib.mjs'.
import path from 'node:path';
import * as turf from '@turf/turf';
import { polygonToCells, cellToLatLng } from 'h3-js';
import { CACHE, GEN, H3_RES, writeJson } from '#data/lib.mjs';
import { PLACES, areaBox, districtName } from './_synthetic.mjs';

const features = [];
let district = 0;
for (const place of PLACES) {
  const names = new Map(); // district key -> its made-up name
  for (let r = 0; r < place.rows; r++) {
    for (let c = 0; c < place.cols; c++) {
      const key = `${Math.floor(c / 2)}/${Math.floor(r / 2)}`;
      if (!names.has(key)) names.set(key, districtName(district++));
      const [w, s, e, n] = areaBox(place.col0 + c, place.row0 + r);
      const dName = names.get(key);
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
        properties: { id: `${place.prefix}${String(r).padStart(2, '0')}${String(c).padStart(2, '0')}`, name: `${dName} ${String.fromCharCode(65 + (c % 2) + 2 * (r % 2))}`, district: dName, city: place.name, kind: 'Area' },
      });
    }
  }
}
writeJson(path.join(CACHE, 'areas.geo.json'), { type: 'FeatureCollection', features });

// the hex grid: every res-9 cell whose centre lies in an area
const ids = [], lat = [], lon = [], area = [];
const seen = new Set();
features.forEach((f, ai) => {
  for (const h of polygonToCells(f.geometry.coordinates, H3_RES, true)) {
    if (seen.has(h)) continue;
    seen.add(h);
    const [la, lo] = cellToLatLng(h);
    ids.push(h); lat.push(+la.toFixed(5)); lon.push(+lo.toFixed(5)); area.push(ai);
  }
});
writeJson(path.join(CACHE, 'cells.base.json'), { res: H3_RES, ids, lat, lon, area });

const slim = features.map((f) => turf.truncate(turf.simplify(f, { tolerance: 0.0002, highQuality: false }), { precision: 5 }));
writeJson(path.join(GEN, 'areas.json'), { type: 'FeatureCollection', features: slim });
console.log(`areas: ${features.length}; cells: ${ids.length}`);
