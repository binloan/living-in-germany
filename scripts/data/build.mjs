// Final stage: merge metric caches into cities/<id>/generated/{cells,metrics,sources,districts,areas}.json
// Usage: npm run data            merge only (run metric modules first)
//        npm run data -- --all   run the city's steps (pipeline.steps of its manifest) first, then merge
//        npm run data -- --step areas   run only the steps of that name (cities/<id>/steps/areas.mjs, ...), no merge
//        add --city <id> for another city
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as turf from '@turf/turf';
import { topology } from 'topojson-server';
import { mesh as topojsonMesh } from 'topojson-client';
import { pathToFileURL } from 'node:url';
import { stepFile } from './paths.mjs';
import { ROOT, CACHE, CITY, CITY_DIR, CITY_ID, GEN, METRICS_DIR, SEED, SOURCES, loadAreas, loadCells, readJson, writeJson } from './lib.mjs';
import { resolveMetricDefs } from './metric-defs.mjs';
import { buildShape } from './shape.mjs';

const stepAt = process.argv.indexOf('--step');
if (stepAt > 0) {
  const name = process.argv[stepAt + 1];
  const hit = CITY.pipeline.steps.filter((s) => path.basename(s, '.mjs') === name);
  if (!hit.length) { console.error(`no step called "${name}" in the manifest of ${CITY_ID}`); process.exit(1); }
  for (const s of hit) process.exitCode ||= spawnSync(process.execPath, [stepFile(CITY_DIR, s), '--city', CITY_ID], { stdio: 'inherit', cwd: ROOT }).status ?? 1;
  process.exit(process.exitCode ?? 0);
}
if (process.argv.includes('--all')) {
  // a metric the city has no step for is simply not built, and the app leaves it out
  for (const s of CITY.pipeline.steps) {
    console.log(`> ${s}`);
    const r = spawnSync(process.execPath, [stepFile(CITY_DIR, s), '--city', CITY_ID], { stdio: 'inherit', cwd: ROOT });
    if (r.status !== 0) console.warn(`  ! ${s} exited ${r.status}`);
  }
}

const cells = loadCells();
// the shared metric definitions with this city's descriptions (cities/<id>/metrics.json) on top
const cityMetrics = path.join(CITY_DIR, 'metrics.json');
const defs = resolveMetricDefs(readJson(path.join(ROOT, 'data', 'metrics.json')), fs.existsSync(cityMetrics) ? readJson(cityMetrics) : {}, CITY.texts ?? {}, CITY_ID);
const N = cells.ids.length;
const idx = new Map(cells.ids.map((h, i) => [h, i]));
// the place (Berlin, Potsdam ...) each hex belongs to
const baseAreas = loadAreas().features;
const place = cells.area.map((a) => baseAreas[a].properties.city);

const outMetrics = {};
const metricsMeta = [];
for (const d of defs) {
  const meta = { ...d };
  metricsMeta.push(meta);
  if (d.dynamic) continue;
  const f = path.join(METRICS_DIR, `${d.id}.json`);
  if (!fs.existsSync(f)) { console.warn(`missing metric ${d.id}: skipped`); meta.missing = true; continue; }
  // one fixed ruler for every city, so a 70 means the same everywhere; a ruler taken from the city's own spread would not
  if (!Array.isArray(d.scale) || d.scale.length !== 2) throw new Error(`metric ${d.id} has no scale in data/metrics.json: scores of different cities would not be comparable`);
  const m = readJson(f);
  const raw = new Array(N).fill(null);
  for (const [h, v] of Object.entries(m.raw)) {
    const i = idx.get(h);
    if (i == null) continue;
    if (d.only && d.only !== place[i]) continue; // source not comparable across places
    raw[i] = v;
  }
  const t = d.transform === 'log' ? (x) => Math.log1p(Math.max(0, x)) : (x) => x;
  const vals = raw.filter((v) => v != null).map(t).sort((a, b) => a - b);
  if (!vals.length) { meta.missing = true; continue; }
  const lo = t(d.scale[0]), hi = t(d.scale[1]);
  const span = hi - lo || 1;
  const score = raw.map((v) => {
    if (v == null) return null;
    let s = Math.min(1, Math.max(0, (t(v) - lo) / span));
    if (d.better === 'lower') s = 1 - s;
    return Math.round(s * 100);
  });
  const dec = d.decimals ?? 0, k = 10 ** dec;
  outMetrics[d.id] = { raw: raw.map((v) => (v == null ? null : Math.round(v * k) / k)), s: score };
  const share = (pred) => {
    let have = 0, all = 0;
    for (let i = 0; i < N; i++) if (pred(i)) { all++; if (raw[i] != null) have++; }
    return all ? +(have / all).toFixed(3) : 0;
  };
  meta.cover = Object.fromEntries(CITY.municipalities.map((p) => [p, share((i) => place[i] === p)]));
  const back = (x) => (d.transform === 'log' ? Math.expm1(x) : x);
  meta.anchors = { lo: +back(lo).toFixed(2), hi: +back(hi).toFixed(2) };
  if (!meta.note && m.meta?.note) meta.note = m.meta.note;
  // how many cells sit at the ends of the ruler: a lot of 0 or 100 usually means a wrong unit or join, or a city outside the shared range
  const atEnd = (end) => Math.round((100 * score.filter((s) => s === end).length) / vals.length);
  console.log(`${d.id}: ${vals.length}/${N} cells, scale ${meta.anchors.lo}..${meta.anchors.hi}, ${atEnd(0)}% score 0 and ${atEnd(100)}% score 100, cover ${CITY.municipalities.map((p) => `${p} ${meta.cover[p]}`).join(', ')}`);
}

// proxies: where a city has no data for a metric, another metric's score stands in (documented in the metric info text)
for (const d of defs) {
  if (!d.proxy) continue;
  const me = outMetrics[d.id], src = outMetrics[d.proxy.metric];
  const meta = metricsMeta.find((x) => x.id === d.id);
  if (!me || !src) continue;
  let n = 0;
  for (let i = 0; i < N; i++) {
    if (place[i] === d.proxy.city && me.s[i] == null && src.s[i] != null) { me.s[i] = src.s[i]; n++; }
  }
  meta.proxyCells = n;
  console.log(`${d.id}: ${n} ${d.proxy.city} cells use the ${d.proxy.metric} score`);
}

writeJson(path.join(GEN, 'cells.json'), { res: cells.res, ids: cells.ids, area: cells.area, m: outMetrics });

// sources: shared + per metric (+ transit extras)
const sdir = SOURCES;
const sources = { shared: readJson(path.join(sdir, '_shared.json')), metrics: {} };
for (const d of defs) {
  const f = path.join(sdir, `${d.id}.json`);
  if (fs.existsSync(f)) sources.metrics[d.id] = readJson(f);
}
// the ratings behind the restaurants metric come from the provider the builder chose (05-ratings.mjs writes who they are from)
const ratingsSource = path.join(CACHE, 'ratings', 'source.json');
if (sources.metrics.restaurants && fs.existsSync(ratingsSource)) sources.metrics.restaurants.push({ ...readJson(ratingsSource), accessed: fs.statSync(ratingsSource).mtime.toISOString().slice(0, 10) });
writeJson(path.join(GEN, 'sources.json'), sources);

// area label points + district centroids
const areas = readJson(path.join(GEN, 'areas.json'));
for (const f of areas.features) {
  const p = turf.pointOnFeature(f).geometry.coordinates;
  f.properties.c = [+p[0].toFixed(5), +p[1].toFixed(5)];
}
writeJson(path.join(GEN, 'areas.json'), areas);
const byDistrict = new Map();
for (const f of areas.features) {
  const k = f.properties.district;
  if (!byDistrict.has(k)) byDistrict.set(k, []);
  byDistrict.get(k).push(turf.centroid(f).geometry.coordinates);
}
const districts = [...byDistrict].map(([name, pts]) => ({
  name,
  c: [+(pts.reduce((a, p) => a + p[0], 0) / pts.length).toFixed(5), +(pts.reduce((a, p) => a + p[1], 0) / pts.length).toFixed(5)],
}));
writeJson(path.join(GEN, 'districts.json'), districts);

// District borders (Bezirke, Potsdam as one outline): union the full-precision areas of each district, then
// extract every shared edge ONCE with a topology mesh. Simplifying each district on its own would leave
// neighbouring borders slightly apart and draw doubled, disconnected lines.
const fullAreas = readJson(path.join(CACHE, 'areas.geo.json'));
const unions = [];
for (const name of byDistrict.keys()) {
  const parts = fullAreas.features.filter((f) => f.properties.district === name);
  const merged = turf.union(turf.featureCollection(parts.map((f) => turf.feature(f.geometry))));
  if (merged) unions.push({ type: 'Feature', geometry: merged.geometry, properties: { name } });
}
// One outline per district, so the map can keep a selected district sharp while the rest fades.
writeJson(path.join(GEN, 'district-outlines.json'), { type: 'FeatureCollection', features: unions.map((u) => turf.truncate(turf.simplify({ type: 'Feature', geometry: u.geometry, properties: { name: u.properties.name } }, { tolerance: 0.0003, highQuality: false }), { precision: 5 })) });
// Outline of everything we score: the map darkens whatever lies outside it, clicks outside it do nothing.
const whole = turf.union(turf.featureCollection(unions.map((u) => turf.feature(u.geometry))));
const outline = turf.truncate(turf.simplify(whole, { tolerance: 0.0003, highQuality: false }), { precision: 5 });
writeJson(path.join(GEN, 'outline.json'), outline);
// the silhouette for the start and loading screens; the places other than the first (Potsdam next to Berlin) get a label
writeJson(path.join(GEN, 'shape.json'), buildShape(outline, CITY.municipalities.slice(1).map((name) => ({ name, points: cells.ids.flatMap((_, i) => (place[i] === name ? [[cells.lon[i], cells.lat[i]]] : [])) }))));
const topo = topology({ d: { type: 'FeatureCollection', features: unions } });
const mesh = topojsonMesh(topo, topo.objects.d);
const borders = turf.truncate(turf.simplify({ type: 'Feature', geometry: mesh, properties: {} }, { tolerance: 0.0003, highQuality: false }), { precision: 5 });
writeJson(path.join(GEN, 'district-borders.json'), { type: 'FeatureCollection', features: [borders] });
// ---- Price zones: where one average rent counts. The city's own module (pipeline.zones in its manifest) says which zones there are
// and which one each hex centre lies in; every hex belongs to exactly one zone.
const zoneAdapter = await import(pathToFileURL(stepFile(CITY_DIR, CITY.pipeline.zones)).href);
const { zones, cellZone } = zoneAdapter.assignZones({ areas, cells });
// hexes whose centre falls outside every zone (borders, generalised outlines): the zone most of their planning area has
const votes = new Map();
for (let i = 0; i < N; i++) if (cellZone[i] >= 0) { const m = votes.get(cells.area[i]) || votes.set(cells.area[i], new Map()).get(cells.area[i]); m.set(cellZone[i], (m.get(cellZone[i]) || 0) + 1); }
let stray = 0;
for (let i = 0; i < N; i++) {
  if (cellZone[i] >= 0) continue;
  const m = votes.get(cells.area[i]);
  cellZone[i] = m ? [...m].sort((a, b) => b[1] - a[1])[0][0] : 0;
  stray++;
}
// a representative point of each zone that really is one of its hexes: the hex centre nearest to the mean of its hexes
zones.forEach((z, k) => {
  const idxs = []; for (let i = 0; i < N; i++) if (cellZone[i] === k) idxs.push(i);
  if (!idxs.length) { console.warn('zone without hexes:', z.name); z.c = [0, 0]; return; }
  const mx = idxs.reduce((a, i) => a + cells.lon[i], 0) / idxs.length, my = idxs.reduce((a, i) => a + cells.lat[i], 0) / idxs.length;
  const best = idxs.reduce((a, i) => (Math.hypot((cells.lon[i] - mx) * 0.61, cells.lat[i] - my) < Math.hypot((cells.lon[a] - mx) * 0.61, cells.lat[a] - my) ? i : a));
  z.c = [cells.lon[best], cells.lat[best]];
  z.n = idxs.length;
});
// zones with no published rent anywhere (listed in the seed file): they do not hold the rent score back, rent just stays empty there
const seedFile = path.join(SEED, 'rents.json');
const noData = fs.existsSync(seedFile) ? Object.keys(readJson(seedFile).noData ?? {}) : [];
for (const z of zones) if (noData.includes(zoneAdapter.seedKey(z))) z.exempt = true;
writeJson(path.join(GEN, 'zones.json'), { zones, cell: cellZone });
console.log(`price zones: ${zones.length} (${CITY.municipalities.map((p) => `${p} ${zones.filter((z) => z.city === p).length}`).join(', ')}), ${zones.filter((z) => z.exempt).length} without a published rent, ${stray} hexes assigned by area`);
writeJson(path.join(GEN, 'metrics.json'), metricsMeta);
console.log('build done:', fs.readdirSync(GEN).map((f) => `${f} ${(fs.statSync(path.join(GEN, f)).size / 1024).toFixed(0)}KB`).join(', '));
