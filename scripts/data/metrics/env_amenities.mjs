// Metric `amenities`: weighted, capped count of daily-needs POIs within 800 m of the hex centre (more = better).
// OSM via Overpass (cached per tile). Formula: raw = sum_c  w_c * min(count_c, cap_c)
//   grocery  (shop=supermarket|convenience|greengrocer|bakery)  w 1.0  cap 10
//   pharmacy (amenity=pharmacy)                                  w 1.0  cap 3
//   eating   (amenity=cafe|restaurant)                           w 0.5  cap 20
//   health   (amenity=doctors|clinic)                            w 1.0  cap 8
//   post     (amenity=post_office)                               w 1.0  cap 2
//   library  (amenity=library)                                   w 1.0  cap 1
//   kinder   (amenity=kindergarten)                              w 0.5  cap 4
// Max possible = 10+3+10+8+2+1+2 = 36.
import fs from 'node:fs';
import path from 'node:path';
import { RAW, loadCells, haversineM, writeMetric, writeSources } from '../lib.mjs';
import { overpass, cellsBBox, tiles } from '../lib_overpass.mjs';

const DIR = path.join(RAW, 'osm_amenities');
const RADIUS = 800;
const CATS = {
  grocery: { w: 1, cap: 10, test: (t) => ['supermarket', 'convenience', 'greengrocer', 'bakery'].includes(t.shop) },
  pharmacy: { w: 1, cap: 3, test: (t) => t.amenity === 'pharmacy' },
  eating: { w: 0.5, cap: 20, test: (t) => ['cafe', 'restaurant'].includes(t.amenity) },
  health: { w: 1, cap: 8, test: (t) => ['doctors', 'clinic'].includes(t.amenity) },
  post: { w: 1, cap: 2, test: (t) => t.amenity === 'post_office' },
  library: { w: 1, cap: 1, test: (t) => t.amenity === 'library' },
  kinder: { w: 0.5, cap: 4, test: (t) => t.amenity === 'kindergarten' },
};

const bbox = cellsBBox();
const tl = tiles(bbox, 3, 3, 0);
const pois = new Map();
for (let t = 0; t < tl.length; t++) {
  const [s, w, n, e] = tl[t];
  const bb = `${s},${w},${n},${e}`;
  const ql = `[out:json][timeout:300];
(
  nwr["shop"~"^(supermarket|convenience|greengrocer|bakery)$"](${bb});
  nwr["amenity"~"^(pharmacy|cafe|restaurant|doctors|clinic|post_office|library|kindergarten)$"](${bb});
);
out center tags;`;
  const j = await overpass(ql, path.join(DIR, `tile_${t}.json`));
  for (const el of j.elements) {
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null) continue;
    const cat = Object.keys(CATS).find((c) => CATS[c].test(el.tags || {}));
    if (cat) pois.set(el.type + '/' + el.id, { lat, lon, cat });
  }
  console.log(`tile ${t}: ${j.elements.length} elements`);
}
const counts = {};
for (const p of pois.values()) counts[p.cat] = (counts[p.cat] || 0) + 1;
console.log('distinct POIs', pois.size, counts);

// bucket POIs (0.01 deg ~ 1.1 km lat / 0.68 km lon)
const B = 0.01, bk = new Map();
for (const p of pois.values()) {
  const k = Math.floor(p.lat / B) + ',' + Math.floor(p.lon / B);
  (bk.get(k) || bk.set(k, []).get(k)).push(p);
}
const cells = loadCells();
const raw = {};
cells.ids.forEach((h, i) => {
  const la = cells.lat[i], lo = cells.lon[i];
  const c = {};
  const bi = Math.floor(la / B), bj = Math.floor(lo / B);
  for (let di = -1; di <= 1; di++) for (let dj = -2; dj <= 2; dj++) {
    for (const p of bk.get(bi + di + ',' + (bj + dj)) || []) {
      if (haversineM(la, lo, p.lat, p.lon) <= RADIUS) c[p.cat] = (c[p.cat] || 0) + 1;
    }
  }
  let v = 0;
  for (const [k, def] of Object.entries(CATS)) v += def.w * Math.min(c[k] || 0, def.cap);
  raw[h] = v;
});

writeMetric('amenities', raw, {
  unit: 'weighted POI count (800 m)',
  note: 'OSM POIs within 800 m (haversine) of hex centre. raw = sum_c w_c*min(count_c,cap_c): grocery (shop=supermarket|convenience|greengrocer|bakery) w1 cap10; pharmacy w1 cap3; eating (amenity=cafe|restaurant) w0.5 cap20; health (amenity=doctors|clinic) w1 cap8; post_office w1 cap2; library w1 cap1; kindergarten w0.5 cap4. Max 36. Distinct OSM objects (nodes/ways/relations; areas via centre). Zero is a real value (no POI nearby) but depends on OSM mapping completeness.',
});

writeSources('amenities.json', JSON.stringify([
  {
    name: 'OpenStreetMap (shops and amenities) via Overpass API',
    url: 'https://overpass-api.de/api/interpreter',
    license: 'Open Database License (ODbL) 1.0',
    attribution: '© OpenStreetMap contributors (https://www.openstreetmap.org/copyright)',
    accessed: '2026-10-18',
    note: 'Queried by tile for shop=supermarket|convenience|greengrocer|bakery and amenity=pharmacy|cafe|restaurant|doctors|clinic|post_office|library|kindergarten; data as of access date.',
  },
], null, 2));
