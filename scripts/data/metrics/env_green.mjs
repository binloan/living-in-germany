// Metric `green`: % of the 500 m disc around each hex centre covered by green/blue OSM areas (more = better).
// OSM via Overpass (cached per tile). Polygons rasterised to a 25 m grid (union), then disc coverage per hex.
import fs from 'node:fs';
import path from 'node:path';
import { RAW, loadCells, writeMetric, writeSources } from '../lib.mjs';
import { overpass, cellsBBox, tiles } from '../lib_overpass.mjs';

const DIR = path.join(RAW, 'osm_green');
const RADIUS = 500, RES = 25;
const TAGS = [
  ['leisure', 'park|garden|nature_reserve|playground|recreation_ground'],
  ['landuse', 'forest|grass|meadow|recreation_ground|allotments|cemetery|village_green|orchard'],
  ['natural', 'wood|scrub|grassland|water|heath|wetland'],
  ['waterway', 'riverbank'],
];
const bbox = cellsBBox();
const tl = tiles(bbox, 3, 3, 0);

const elements = new Map(); // "type/id" -> element
for (let t = 0; t < tl.length; t++) {
  const [s, w, n, e] = tl[t];
  const bb = `${s},${w},${n},${e}`;
  const parts = TAGS.map(([k, v]) => `way["${k}"~"^(${v})$"](${bb});\n  relation["${k}"~"^(${v})$"]["type"="multipolygon"](${bb});`).join('\n  ');
  const ql = `[out:json][timeout:300];\n(\n  ${parts}\n);\nout geom;`;
  const j = await overpass(ql, path.join(DIR, `tile_${t}.json`));
  for (const el of j.elements) elements.set(el.type + '/' + el.id, el);
  console.log(`tile ${t}: ${j.elements.length} elements`);
}
console.log('unique elements', elements.size);

// ---- projection & grid ----
const lat0 = (bbox[0] + bbox[2]) / 2, lon0 = bbox[1];
const mLat = 111320, mLon = mLat * Math.cos((lat0 * Math.PI) / 180);
const proj = (lat, lon) => [((lon - lon0) * mLon) / RES, ((lat - bbox[0]) * mLat) / RES]; // grid units
const NX = Math.ceil(((bbox[3] - bbox[1]) * mLon) / RES) + 1, NY = Math.ceil(((bbox[2] - bbox[0]) * mLat) / RES) + 1;
const grid = new Uint8Array(NX * NY);

function stitch(segs) {
  // join way fragments into closed rings
  const rings = [];
  const key = (p) => p.lat + ',' + p.lon;
  const pool = segs.filter((s) => s.length > 1).map((s) => s.slice());
  while (pool.length) {
    let cur = pool.pop();
    let guard = true;
    while (guard && key(cur[0]) !== key(cur[cur.length - 1])) {
      guard = false;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        if (key(s[0]) === key(cur[cur.length - 1])) cur = cur.concat(s.slice(1));
        else if (key(s[s.length - 1]) === key(cur[cur.length - 1])) cur = cur.concat(s.slice(0, -1).reverse());
        else if (key(s[s.length - 1]) === key(cur[0])) cur = s.concat(cur.slice(1));
        else if (key(s[0]) === key(cur[0])) cur = s.slice().reverse().concat(cur.slice(1));
        else continue;
        pool.splice(i, 1); guard = true; break;
      }
    }
    if (cur.length >= 4 && key(cur[0]) === key(cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}

function fill(rings) {
  const pr = rings.map((r) => r.map((p) => proj(p.lat, p.lon)));
  let ymin = Infinity, ymax = -Infinity;
  for (const r of pr) for (const p of r) { if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1]; }
  const j0 = Math.max(0, Math.ceil(ymin - 0.5)), j1 = Math.min(NY - 1, Math.floor(ymax - 0.5));
  for (let j = j0; j <= j1; j++) {
    const y = j + 0.5, xs = [];
    for (const r of pr) for (let i = 0; i + 1 < r.length; i++) {
      const a = r[i], b = r[i + 1];
      if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] - 0.5)), i1 = Math.min(NX - 1, Math.floor(xs[k + 1] - 0.5));
      for (let i = i0; i <= i1; i++) grid[j * NX + i] = 1;
    }
  }
}

let nPoly = 0, skipped = 0;
for (const el of elements.values()) {
  let rings = [];
  if (el.type === 'way') {
    const g = el.geometry;
    if (g && g.length >= 4 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon) rings = [g];
  } else if (el.type === 'relation') {
    const outer = [], inner = [];
    for (const m of el.members || []) {
      if (m.type !== 'way' || !m.geometry) continue;
      (m.role === 'inner' ? inner : outer).push(m.geometry);
    }
    rings = [...stitch(outer), ...stitch(inner)];
  }
  if (!rings.length) { skipped++; continue; }
  fill(rings); nPoly++;
}
console.log(`rasterised ${nPoly} features, skipped ${skipped} (unclosed/incomplete)`);

// ---- per-hex disc coverage ----
const cells = loadCells();
const rr = RADIUS / RES;
const raw = {};
cells.ids.forEach((h, i) => {
  const [cx, cy] = proj(cells.lat[i], cells.lon[i]);
  let tot = 0, g = 0;
  for (let j = Math.ceil(cy - rr); j <= Math.floor(cy + rr); j++) {
    for (let k = Math.ceil(cx - rr); k <= Math.floor(cx + rr); k++) {
      const dx = k + 0.5 - cx, dy = j + 0.5 - cy;
      if (dx * dx + dy * dy > rr * rr) continue;
      tot++;
      if (j >= 0 && k >= 0 && j < NY && k < NX && grid[j * NX + k]) g++;
    }
  }
  raw[h] = (100 * g) / tot;
});

writeMetric('green', raw, {
  unit: '% green/blue within 500 m',
  note: 'Share of the 500 m disc around the hex centre covered by OSM green/blue areas (union, 25 m raster). Tags: leisure=park|garden|nature_reserve|playground|recreation_ground; landuse=forest|grass|meadow|recreation_ground|allotments|cemetery|village_green|orchard; natural=wood|scrub|grassland|water|heath|wetland; waterway=riverbank (closed ways + multipolygon relations). Denominator = whole disc (incl. built-up and water). Private gardens only where mapped; street trees and linear waterways not counted.',
});

writeSources('green.json', JSON.stringify([
  {
    name: 'OpenStreetMap (green/blue land-use and natural areas) via Overpass API',
    url: 'https://overpass-api.de/api/interpreter',
    license: 'Open Database License (ODbL) 1.0',
    attribution: '© OpenStreetMap contributors (https://www.openstreetmap.org/copyright)',
    accessed: '2026-10-18',
    note: 'Queried by tile for leisure/landuse/natural/waterway tags (see metric note); data as of access date.',
  },
], null, 2));
