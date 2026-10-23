// The city's GTFS feed (pipeline.gtfs of its manifest) -> transit-lines.json, stations.json, metric transit_access.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parse } from 'csv-parse/sync';
import { CITY, RAW, GEN, CACHE, download, loadCells, writeMetric, writeJson } from '../lib.mjs';
import { unzipTo } from './transit_unzip.mjs';
import { distM, buildGrid, multimodalAccess, routeMode } from './transit_lib.mjs';

const GTFS = CITY.pipeline.gtfs;
const GTFS_URL = GTFS.url;
const ZIP = path.join(RAW, GTFS.dir, 'GTFS.zip');
const DIR = path.join(RAW, GTFS.dir, 'gtfs');
// stops outside this box are dropped
const BBOX = { minLat: GTFS.bbox.s, maxLat: GTFS.bbox.n, minLon: GTFS.bbox.w, maxLon: GTFS.bbox.e };
const inBbox = (lat, lon) => lat >= BBOX.minLat && lat <= BBOX.maxLat && lon >= BBOX.minLon && lon <= BBOX.maxLon;
const DEFAULT_COLOR = { S: '#008D4F', U: '#0065AE', T: '#D81E05', R: '#E3001B' };
const MODE_ORDER = { S: 0, U: 1, T: 2, R: 3 };
// which route type codes of the feed are which kind of line: pipeline.gtfs.routeTypes of the manifest
if (!GTFS.routeTypes) throw new Error('pipeline.gtfs.routeTypes is missing in the manifest: which route types of the feed are S, U, T and R lines');
// kinds that count for transit_access only (B bus, F ferry): pipeline.gtfs.accessRouteTypes, same shape as routeTypes. They are neither
// drawn as lines nor listed as stations, and a city without the key scores as before.
const ACCESS = GTFS.accessRouteTypes ?? {};
if (Object.keys(ACCESS).some((k) => !['B', 'F'].includes(k))) throw new Error('pipeline.gtfs.accessRouteTypes may only name B (bus) and F (ferry)');
const modeOf = (t, name) => routeMode(GTFS.routeTypes, t, name) ?? routeMode(ACCESS, t, name);
const isAccessOnly = (mode) => mode in ACCESS;

// ---------- download + unzip
await download(GTFS_URL, ZIP);
if (!fs.existsSync(path.join(DIR, 'stop_times.txt'))) {
  console.log('unzipping GTFS ...');
  await unzipTo(ZIP, DIR);
}
const readCsv = (f) => parse(fs.readFileSync(path.join(DIR, f)), { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true });

// ---------- routes / trips
const routeInfo = new Map(); // route_id -> { mode, name, color }
for (const r of readCsv('routes.txt')) {
  const mode = modeOf(Number(r.route_type), r.route_short_name);
  if (!mode) continue;
  routeInfo.set(r.route_id, { mode, name: r.route_short_name, color: (r.route_color || '').replace('#', '').toUpperCase() });
}
const groups = []; // line groups: { key, mode, name, color }
const groupIdx = new Map();
const routeGroup = new Map();
for (const [rid, r] of routeInfo) {
  const key = r.mode + '|' + r.name;
  let gi = groupIdx.get(key);
  if (gi == null) { gi = groups.length; groupIdx.set(key, gi); groups.push({ key, mode: r.mode, name: r.name, color: '' }); }
  // black and white are what a feed puts where it has no colour for the line
  if (!groups[gi].color && /^[0-9A-F]{6}$/.test(r.color) && !/^(000000|FFFFFF)$/.test(r.color)) groups[gi].color = '#' + r.color;
  routeGroup.set(rid, gi);
}
const tripInfo = new Map(); // trip_id -> { g, service, active }
const shapeCount = new Map(); // g -> dir -> shape_id -> count
for (const t of readCsv('trips.txt')) {
  const g = routeGroup.get(t.route_id);
  if (g == null) continue;
  tripInfo.set(t.trip_id, { g, service: t.service_id, active: false });
  if (t.shape_id && !isAccessOnly(groups[g].mode)) {
    const d = shapeCount.get(g) || new Map();
    shapeCount.set(g, d);
    const dk = t.direction_id || '0';
    const m = d.get(dk) || new Map();
    d.set(dk, m);
    m.set(t.shape_id, (m.get(t.shape_id) || 0) + 1);
  }
}
console.log(`rail-ish routes ${routeInfo.size}, line groups ${groups.length}, trips ${tripInfo.size}`);

// ---------- representative Tuesday
const cal = readCsv('calendar.txt');
const calDates = readCsv('calendar_dates.txt');
const ymd = (d) => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
const parseYmd = (n) => new Date(Date.UTC(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100));
const exceptions = new Map(); // date -> {add:Set, rem:Set}
for (const c of calDates) {
  const d = Number(c.date);
  const e = exceptions.get(d) || { add: new Set(), rem: new Set() };
  exceptions.set(d, e);
  (c.exception_type === '1' ? e.add : e.rem).add(c.service_id);
}
const tripsPerService = new Map();
for (const t of tripInfo.values()) tripsPerService.set(t.service, (tripsPerService.get(t.service) || 0) + 1);
function activeServices(dateNum) {
  const dow = parseYmd(dateNum).getUTCDay(); // 0=Sun
  const col = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dow];
  const s = new Set();
  for (const c of cal) if (c[col] === '1' && Number(c.start_date) <= dateNum && dateNum <= Number(c.end_date)) s.add(c.service_id);
  const e = exceptions.get(dateNum);
  if (e) { e.add.forEach((x) => s.add(x)); e.rem.forEach((x) => s.delete(x)); }
  return s;
}
const minD = Math.min(...cal.map((c) => Number(c.start_date))), maxD = Math.max(...cal.map((c) => Number(c.end_date)));
const tuesdays = [];
for (let d = parseYmd(minD); ymd(d) <= maxD; d = new Date(d.getTime() + 864e5)) {
  if (d.getUTCDay() !== 2) continue;
  const n = ymd(d);
  let cnt = 0;
  for (const sid of activeServices(n)) cnt += tripsPerService.get(sid) || 0;
  if (cnt > 0) tuesdays.push({ n, cnt });
}
const sortedCnt = [...tuesdays].sort((a, b) => a.cnt - b.cnt);
const median = sortedCnt[Math.floor(sortedCnt.length / 2)].cnt;
const chosen = tuesdays.filter((t) => t.cnt >= median * 0.97 && t.cnt <= median * 1.03)
  .sort((a, b) => Math.abs(a.n - 20261015) - Math.abs(b.n - 20261015))[0] || sortedCnt[Math.floor(sortedCnt.length / 2)];
console.log(`feed validity ${minD}-${maxD}; ${tuesdays.length} Tuesdays, median rail trips ${median}; representative Tuesday ${chosen.n} (${chosen.cnt} trips)`);
const svc = activeServices(chosen.n);
for (const t of tripInfo.values()) t.active = svc.has(t.service);

// ---------- stops
const stops = new Map();
for (const s of readCsv('stops.txt')) {
  stops.set(s.stop_id, { id: s.stop_id, name: s.stop_name, lat: Number(s.stop_lat), lon: Number(s.stop_lon), parent: s.parent_station || '', type: s.location_type });
}

// ---------- stream stop_times
const depCount = new Map();  // stop_id -> Map(group idx -> departures in window on the active day)
const stopGroups = new Map(); // stop_id -> Set(group idx) (all days)
const W0 = 7 * 3600, W1 = 19 * 3600;
// A feed without shapes.txt (the nationwide gtfs.de feed) gets one straight-line shape per distinct stop sequence of the rail lines that
// touch the box; 02-rail-graph then redraws the lines along the OSM tracks.
// a shapes.txt with only its header line (one regional feed ships it so) counts as missing
const HAS_SHAPES = fs.existsSync(path.join(DIR, 'shapes.txt')) && fs.statSync(path.join(DIR, 'shapes.txt')).size > 200;
const patterns = new Map(); // "group|stop,stop,..." -> trips
{
  let curTrip = null, curInfo = null, rows = [];
  const flush = () => {
    if (!curInfo || !rows.length) return;
    if (!isAccessOnly(groups[curInfo.g].mode)) {
      for (const r of rows) {
        let s = stopGroups.get(r[0]);
        if (!s) stopGroups.set(r[0], (s = new Set()));
        s.add(curInfo.g);
      }
    }
    if (!HAS_SHAPES && !isAccessOnly(groups[curInfo.g].mode) && rows.some((r) => { const s = stops.get(r[0]); return s && inBbox(s.lat, s.lon); })) {
      const key = curInfo.g + '|' + rows.map((r) => r[0]).join(',');
      patterns.set(key, (patterns.get(key) || 0) + 1);
    }
    if (curInfo.active) {
      for (let i = 0; i < rows.length - 1; i++) {
        const [sid, dep] = rows[i];
        if (dep >= W0 && dep < W1) {
          let m = depCount.get(sid);
          if (!m) depCount.set(sid, (m = new Map()));
          m.set(curInfo.g, (m.get(curInfo.g) || 0) + 1);
        }
      }
    }
  };
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(DIR, 'stop_times.txt'), { highWaterMark: 1 << 20 }), crlfDelay: Infinity });
  // the columns are found in the header; the fast path is the common layout (stop_id second, departure_time last), which needs no field splitting
  let first = true, n = 0, fast = true, SI = 1, DI = -1;
  const splitCsv = (l) => {
    if (!l.includes('"')) return l.split(',');
    const out = []; let cur = '', q = false;
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur);
    return out;
  };
  for await (const line of rl) {
    if (first) {
      first = false;
      const h = line.replace(/^﻿/, '').trim().split(',').map((c) => c.replace(/^"|"$/g, ''));
      SI = h.indexOf('stop_id'); DI = h.indexOf('departure_time');
      if (h[0] !== 'trip_id' || SI < 0 || DI < 0) throw new Error('stop_times.txt needs trip_id first and the columns stop_id and departure_time');
      fast = SI === 1 && DI === h.length - 1;
      continue;
    }
    n++;
    const i = line.indexOf(',');
    let tid = line.slice(0, i);
    if (tid.charCodeAt(0) === 34) tid = tid.slice(1, -1); // some feeds quote every field
    if (tid !== curTrip) { flush(); curTrip = tid; curInfo = tripInfo.get(tid); rows = []; }
    if (!curInfo) continue;
    let sid, dt;
    if (fast) {
      const j = line.indexOf(',', i + 1);
      sid = line.slice(i + 1, j);
      if (sid.charCodeAt(0) === 34) sid = sid.slice(1, -1);
      dt = line.slice(line.lastIndexOf(',') + 1).trim().replace(/^"|"$/g, '');
    } else {
      const f = splitCsv(line);
      sid = f[SI]; dt = (f[DI] ?? '').trim();
    }
    const p = dt.split(':');
    rows.push([sid, p.length === 3 ? (+p[0]) * 3600 + (+p[1]) * 60 + (+p[2]) : -1]);
  }
  flush();
  console.log(`stop_times lines ${n}; stops with rail service ${stopGroups.size}; stops with departures ${depCount.size}`);
}
const pseudoPts = new Map();
if (!HAS_SHAPES) {
  let k = 0;
  for (const [key, count] of patterns) {
    const bar = key.indexOf('|'), g = Number(key.slice(0, bar));
    const sid = 'p' + k++;
    const d = shapeCount.get(g) || new Map();
    shapeCount.set(g, d);
    const m = d.get('0') || new Map();
    d.set('0', m);
    m.set(sid, count);
    pseudoPts.set(sid, key.slice(bar + 1).split(',').map((id, seq) => { const s = stops.get(id); return s ? [s.lon, s.lat, seq] : null; }).filter(Boolean));
  }
  console.log(`no shapes.txt: ${patterns.size} stop sequences stand in for the shapes`);
  // The stop sequences also go to 02-rail-graph, which lays each line along the OSM tracks through its stops. Per line the busiest
  // sequences are taken until every stop of the line is covered (branches and short-turn variants show up as sequences of their own).
  const perGroup = new Map();
  for (const [key, count] of patterns) {
    const bar = key.indexOf('|'), g = Number(key.slice(0, bar));
    (perGroup.get(g) ?? perGroup.set(g, []).get(g)).push({ ids: key.slice(bar + 1).split(','), count });
  }
  const out = [];
  for (const [g, list] of perGroup) {
    list.sort((a, b) => b.count - a.count);
    const covered = new Set();
    let taken = 0;
    for (const p of list) {
      if (taken >= 12) break;
      if (taken && !p.ids.some((id) => !covered.has(id))) continue;
      p.ids.forEach((id) => covered.add(id));
      taken++;
      out.push({ mode: groups[g].mode, name: groups[g].name, count: p.count, stops: p.ids.map((id) => stops.get(id)).filter(Boolean).map((s) => [s.lon, s.lat]) });
    }
  }
  fs.mkdirSync(CACHE, { recursive: true });
  writeJson(path.join(CACHE, 'line-patterns.json'), out);
}

// ---------- transit_access
const ACCESS_WEIGHTS = [['B', 'bus', 0.5], ['F', 'ferry', 0.5]].filter(([k]) => k in ACCESS).map(([, n, w]) => `${n} ${w}`);
const TRANSIT_NOTE = 'Multimodal transit-access score. For every hex centre and every line (a mode plus line name, e.g. S|S7, U|U2, T|M4, R|RE1) the best stop within 1,000 m (a 12 minute walk) that has departures of that line between 07:00 and 19:00 on a typical Tuesday of the feed is chosen; its departures per hour (count / 12, capped at 12 per line) are multiplied by a mode weight (regional rail 2.5, S-Bahn 1.5, U-Bahn 1.5, tram 1.0' + (ACCESS_WEIGHTS.length ? ', ' + ACCESS_WEIGHTS.join(', ') : '') + ') and by a distance factor that is 1 up to 250 m and then falls linearly to 0 at 1,000 m. The score is the sum over all lines plus a bonus of 5 points for every additional distinct rail mode beyond the first among the contributing lines (0 when only one mode)' + (ACCESS_WEIGHTS.length ? ', buses and ferries earn no bonus' : '') + ', so a station with tram, S-Bahn, U-Bahn and regional services scores far higher than one frequent line; cells without service score 0. Source: ' + CITY.texts.timetable + '.';
const cells = loadCells();
const entries = []; // one per (stop, line group) with departures in the window
for (const [sid, m] of depCount) {
  const st = stops.get(sid);
  if (!st || !inBbox(st.lat, st.lon)) continue;
  for (const [g, c] of m) entries.push({ lat: st.lat, lon: st.lon, g, mode: groups[g].mode, dph: c / 12, sid });
}
console.log(`access: ${entries.length} (stop, line group) entries`);
const access = multimodalAccess(cells, entries, { radiusM: 1000, plateauM: 250, cap: 12 });
writeMetric('transit_access', access.out, {
  unit: 'pts',
  note: TRANSIT_NOTE,
});
if (process.env.TRANSIT_DEBUG) {
  fs.writeFileSync(process.env.TRANSIT_DEBUG, JSON.stringify({ groups: groups.map((g) => g.key), entries }));
}

// ---------- stations
// a feed names its stops its own way ("Mill Road (Exampleton)", "Exampleton, Mill Road"): pipeline.gtfs.stopNameRemove in the manifest lists
// regular expressions (case-insensitive) whose matches are cut out, in order. The German "Bhf"/"Bf" suffix goes after them, for every city.
const REMOVE = (GTFS.stopNameRemove ?? []).map((p) => new RegExp(p, 'i'));
const cleanName = (raw) => {
  let n = raw.trim();
  n = n.replace(/^(S\+U|S|U)\s+/, '');
  for (const re of REMOVE) n = n.replace(re, '');
  n = n.replace(/\s+(Bhf|Bf)(?=\/|$)/, '');
  return n.trim();
};
const MERGE_M = GTFS.stationMergeM ?? 150;
const keyName = (n) => n.split('/')[0].trim().toLowerCase();
const stopModes = (sid) => new Set([...(stopGroups.get(sid) || [])].map((g) => groups[g].mode));
const clusters = new Map(); // cluster key -> { members:[stop], lat, lon, name, modes:Set, lines:Set }
for (const sid of stopGroups.keys()) {
  const s = stops.get(sid);
  if (!s || !inBbox(s.lat, s.lon)) continue;
  const key = s.parent && stops.has(s.parent) ? s.parent : sid;
  let c = clusters.get(key);
  if (!c) {
    const anchor = stops.get(key);
    c = { key, anchor, members: [], groups: new Set() };
    clusters.set(key, c);
  }
  c.members.push(s);
  stopGroups.get(sid).forEach((g) => c.groups.add(g));
}
// compute position + display name per cluster
let list = [...clusters.values()].map((c) => {
  const parent = c.anchor && c.anchor.type === '1' ? c.anchor : null;
  let a = parent;
  const mLat = c.members.reduce((x, m) => x + m.lat, 0) / c.members.length;
  const mLon = c.members.reduce((x, m) => x + m.lon, 0) / c.members.length;
  // a feed's parent station can lie hundreds of metres from the platforms its lines stop at: the platforms are where the tracks are
  if (a && distM(a.lat, a.lon, mLat, mLon) > 100) a = null;
  const lat = a ? a.lat : mLat;
  const lon = a ? a.lon : mLon;
  const rawName = (parent || c.members[0]).name;
  const name = cleanName(rawName);
  return { lat, lon, name, key: keyName(name), groups: c.groups, n: c.members.length, hasParent: !!parent };
});
// merge same-name clusters within pipeline.gtfs.stationMergeM (default 150 m; the S and U platforms of one interchange can be further apart)
const par = list.map((_, i) => i);
const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
const grid = buildGrid(list);
list.forEach((c, i) => {
  grid.query(c.lat, c.lon, MERGE_M, (j) => { if (j !== i && list[j].key === c.key) par[find(j)] = find(i); });
});
const merged = new Map();
list.forEach((c, i) => {
  const r = find(i);
  const m = merged.get(r) || { items: [] };
  merged.set(r, m);
  m.items.push(c);
});
const lineOrder = (a, b) => {
  const ga = groups[a], gb = groups[b];
  if (ga.mode !== gb.mode) return MODE_ORDER[ga.mode] - MODE_ORDER[gb.mode];
  return ga.name.localeCompare(gb.name, 'de', { numeric: true });
};
const stationRows = [];
for (const m of merged.values()) {
  const best = m.items.sort((a, b) => (b.hasParent - a.hasParent) || (b.n - a.n))[0];
  const gs = new Set();
  m.items.forEach((c) => c.groups.forEach((g) => gs.add(g)));
  const sorted = [...gs].sort(lineOrder);
  const modes = ['S', 'U', 'T', 'R'].filter((x) => sorted.some((g) => groups[g].mode === x)).join('');
  // prefer short display name of the best item (drop "/street" suffix only when merged from several)
  const name = m.items.length > 1 ? best.name.split('/')[0].trim() : best.name;
  stationRows.push([+best.lat.toFixed(5), +best.lon.toFixed(5), name, modes, [...new Set(sorted.map((g) => groups[g].name))]]);
}
stationRows.sort((a, b) => a[2].localeCompare(b[2], 'de'));
writeJson(path.join(GEN, 'stations.json'), { fields: ['lat', 'lon', 'name', 'modes', 'lines'], stops: stationRows });
console.log(`stations: ${stationRows.length}`);

// ---------- line geometry
const KX = 111195 * Math.cos(52.5 * Math.PI / 180), KY = 111195;
const proj = (p) => [(p[0] - 13.4) * KX, (p[1] - 52.5) * KY]; // p = [lon, lat]
const selected = new Map(); // shape_id -> { g, count }
for (const [g, dirs] of shapeCount) {
  for (const m of dirs.values()) {
    const arr = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const top = arr[0][1];
    arr.filter(([, c], i) => i === 0 || (c >= top * 0.1 && i < 5)).forEach(([sid, c]) => {
      const prev = selected.get(sid);
      selected.set(sid, { g, count: (prev?.count || 0) + c });
    });
  }
}
const shapePts = pseudoPts;
if (HAS_SHAPES) {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(DIR, 'shapes.txt'), { highWaterMark: 1 << 20 }), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    const i = line.indexOf(',');
    let sid = line.slice(0, i);
    if (sid.charCodeAt(0) === 34) sid = sid.slice(1, -1);
    if (!selected.has(sid)) continue;
    const p = line.split(',');
    const lat = +p[1].replace(/"/g, ''), lon = +p[2].replace(/"/g, ''), seq = +p[3].replace(/"/g, '');
    let a = shapePts.get(sid);
    if (!a) shapePts.set(sid, (a = []));
    a.push([lon, lat, seq]);
  }
}
console.log(`shapes selected ${selected.size}, loaded ${shapePts.size}`);

/** densify polyline (lon/lat points) to <= step metres; returns [[lon,lat],...] */
function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = proj(pts[i - 1]), b = proj(pts[i]);
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.ceil(d / step);
    for (let j = 1; j < k; j++) {
      const t = j / k;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
    }
    out.push(pts[i]);
  }
  return out;
}
function dp(pts, tol) { // Douglas-Peucker in metres
  if (pts.length < 3) return pts;
  const P = pts.map(proj);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, ay] = P[s], [bx, by] = P[e];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    for (let i = s + 1; i < e; i++) {
      let d;
      if (L2 === 0) d = Math.hypot(P[i][0] - ax, P[i][1] - ay);
      else {
        const t = Math.max(0, Math.min(1, ((P[i][0] - ax) * dx + (P[i][1] - ay) * dy) / L2));
        d = Math.hypot(P[i][0] - (ax + t * dx), P[i][1] - (ay + t * dy));
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const byGroup = new Map(); // g -> [{sid,count}]
for (const [sid, { g, count }] of selected) {
  if (!shapePts.has(sid)) continue;
  const a = byGroup.get(g) || [];
  byGroup.set(g, a);
  a.push({ sid, count });
}
const features = [];
const COVER = 12, CELL = 15;
for (const [g, arr] of byGroup) {
  arr.sort((a, b) => b.count - a.count);
  const covered = new Map(); // grid of accepted sample points
  const isCovered = (p) => {
    const [x, y] = proj(p);
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
      const a = covered.get(i * 100003 + j);
      if (a) for (const q of a) if ((q[0] - x) ** 2 + (q[1] - y) ** 2 <= COVER * COVER) return true;
    }
    return false;
  };
  const addCovered = (p) => {
    const [x, y] = proj(p);
    const k = Math.floor(x / CELL) * 100003 + Math.floor(y / CELL);
    const a = covered.get(k) || [];
    covered.set(k, a);
    a.push([x, y]);
  };
  const lines = [];
  for (const { sid } of arr) {
    const raw = shapePts.get(sid).sort((a, b) => a[2] - b[2]).map((p) => [p[0], p[1]]);
    // clip: split into runs of in-bbox points (shape vertices are dense enough for rail; densify later)
    const runs = [];
    let cur = [];
    for (const p of raw) {
      if (inBbox(p[1], p[0])) cur.push(p);
      else { if (cur.length > 1) runs.push(cur); cur = []; }
    }
    if (cur.length > 1) runs.push(cur);
    for (const run of runs) {
      const dense = densify(run, 10);
      const flags = dense.map((p) => isCovered(p));
      let i = 0;
      const newPts = [];
      while (i < dense.length) {
        if (flags[i]) { i++; continue; }
        let j = i;
        while (j < dense.length && !flags[j]) j++;
        const s = Math.max(0, i - 1), e = Math.min(dense.length - 1, j);
        const seg = dense.slice(s, e + 1);
        if (j - i >= 2) lines.push(seg);
        for (let k = i; k < j; k++) newPts.push(dense[k]);
        i = j;
      }
      newPts.forEach(addCovered);
    }
  }
  const coords = lines.map((l) => dp(l, 15).map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)])).filter((l) => l.length >= 2);
  if (!coords.length) continue;
  const grp = groups[g];
  features.push({
    type: 'Feature',
    properties: { mode: grp.mode, name: grp.name, color: grp.color || DEFAULT_COLOR[grp.mode] },
    geometry: { type: 'MultiLineString', coordinates: coords },
  });
}
features.sort((a, b) => (MODE_ORDER[a.properties.mode] - MODE_ORDER[b.properties.mode]) || a.properties.name.localeCompare(b.properties.name, 'de', { numeric: true }));
writeJson(path.join(GEN, 'transit-lines.json'), { type: 'FeatureCollection', features });
console.log(`lines: ${features.length} features (${['S', 'U', 'T', 'R'].map((m) => m + ':' + features.filter((f) => f.properties.mode === m).length).join(' ')})`);
