// Pure helpers for transit metrics (no side effects, no I/O). Reusable from the Express server.

const M_PER_DEG_LAT = 111195;
const DLAT = 0.01;   // bucket height in degrees (~1.11 km)
const DLON = 0.016;  // bucket width in degrees (~1.08 km at 52.5N)

const dist = (lat1, lon1, lat2, lon2) => {
  const dy = (lat2 - lat1) * M_PER_DEG_LAT;
  const dx = (lon2 - lon1) * M_PER_DEG_LAT * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy);
};
export const distM = dist;

/**
 * The kind of line (S, U, T, R) a route type code of a GTFS feed stands for, or null (bus, ferry, ...). `routeTypes` is the city's
 * `pipeline.gtfs.routeTypes`: per kind a list of codes, [from, to] ranges or { code, name } entries. The first kind that matches wins,
 * so a narrow code can sit inside a wider range (109 S-Bahn inside the rail range 100 to 199). `{ code: 2, name: "^S\d" }` matches
 * that code only when the route's short name matches the pattern, for feeds that give S-Bahn and regional trains one code.
 */
const hit = (r, code, name) => (Array.isArray(r) ? code >= r[0] && code <= r[1]
  : typeof r === 'object' ? code === r.code && new RegExp(r.name).test(name ?? '') : code === r);
export const routeMode = (routeTypes, code, name) => Object.keys(routeTypes).find((m) => routeTypes[m].some((r) => hit(r, code, name))) ?? null;

/** Bucket grid over points {lat, lon, ...}. Query returns indices within radiusM. */
export function buildGrid(points) {
  const map = new Map();
  points.forEach((p, i) => {
    const k = Math.floor(p.lat / DLAT) * 100000 + Math.floor(p.lon / DLON);
    let a = map.get(k);
    if (!a) map.set(k, (a = []));
    a.push(i);
  });
  return {
    /** calls fn(index, distanceM) for every point within radiusM of (lat, lon) */
    query(lat, lon, radiusM, fn) {
      const nLat = Math.ceil(radiusM / (DLAT * M_PER_DEG_LAT));
      const nLon = Math.ceil(radiusM / (DLON * M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180)));
      const bi = Math.floor(lat / DLAT), bj = Math.floor(lon / DLON);
      for (let i = bi - nLat; i <= bi + nLat; i++) {
        for (let j = bj - nLon; j <= bj + nLon; j++) {
          const a = map.get(i * 100000 + j);
          if (!a) continue;
          for (const idx of a) {
            const p = points[idx];
            const d = dist(lat, lon, p.lat, p.lon);
            if (d <= radiusM) fn(idx, d);
          }
        }
      }
    },
  };
}

/**
 * Per-cell travel minutes from stop durations.
 * @param cells  { ids[], lat[], lon[] } (shape of cities/<id>/cache/cells.base.json)
 * @param stops  [{ lat, lon, duration }]  duration = minutes from stop to hub (or hub to stop)
 * @param opts   walkMPerMin (80 = 4.8 km/h), maxWalkM (1000), maxMinutes (120; used when nothing reachable)
 * @returns      { [cellId]: minutes }  (never null; unreachable cells get maxMinutes)
 */
export function cellMinutesFromStops(cells, stops, { walkMPerMin = 80, maxWalkM = 1000, maxMinutes = 120 } = {}) {
  const valid = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && Number.isFinite(s.duration));
  const grid = buildGrid(valid);
  const out = {};
  for (let i = 0; i < cells.ids.length; i++) {
    let best = Infinity;
    grid.query(cells.lat[i], cells.lon[i], maxWalkM, (idx, d) => {
      const t = valid[idx].duration + d / walkMPerMin;
      if (t < best) best = t;
    });
    out[cells.ids[i]] = Math.min(best, maxMinutes);
  }
  return out;
}

/** Sum of weighted departures within radiusM; stops: [{lat, lon, dph}] -> { [cellId]: number } */
export function weightedAccess(cells, stops, radiusM = 700) {
  const grid = buildGrid(stops);
  const out = {};
  for (let i = 0; i < cells.ids.length; i++) {
    let sum = 0;
    grid.query(cells.lat[i], cells.lon[i], radiusM, (idx, d) => { sum += stops[idx].dph * (1 - d / radiusM); });
    out[cells.ids[i]] = sum;
  }
  return out;
}

/**
 * Multimodal transit access. entries: [{lat, lon, g, mode, dph}] = departures/h of line group g at a stop.
 * Per cell, per line group: best (modeWeight * min(dph, cap) * (1 - dist/radius)) over entries within radius;
 * raw = sum of group contributions + modeBonus * (distinct modes among contributing groups - 1). Bus and ferry (B, F) add their lines
 * but not a mode: the bonus rewards a mix of rail kinds, and every bus stop would otherwise earn it.
 * @returns { out: {[cellId]: number}, detail(i) -> [{g, contribution}] sorted desc }
 */
export function multimodalAccess(cells, entries, { radiusM = 1000, plateauM = 250, cap = 12, modeWeight = { R: 2.5, S: 1.5, U: 1.5, T: 1.0, B: 0.5, F: 0.5 }, modeBonus = 5, noBonus = ['B', 'F'] } = {}) {
  const grid = buildGrid(entries);
  const out = {};
  const cellGroups = (i) => {
    const best = new Map(); // g -> { c, mode }
    grid.query(cells.lat[i], cells.lon[i], radiusM, (idx, d) => {
      const e = entries[idx];
      // full weight up to plateauM (a 3 min walk), then falling linearly to 0 at radiusM (a 12 min walk)
      const c = (modeWeight[e.mode] ?? 0) * Math.min(e.dph, cap) * (d <= plateauM ? 1 : 1 - (d - plateauM) / (radiusM - plateauM));
      const b = best.get(e.g);
      if (!b || c > b.c) best.set(e.g, { c, mode: e.mode });
    });
    return best;
  };
  for (let i = 0; i < cells.ids.length; i++) {
    const best = cellGroups(i);
    let sum = 0;
    const modes = new Set();
    for (const b of best.values()) if (b.c > 0) { sum += b.c; if (!noBonus.includes(b.mode)) modes.add(b.mode); }
    out[cells.ids[i]] = sum + (modes.size > 1 ? modeBonus * (modes.size - 1) : 0);
  }
  return { out, detail: (i) => [...cellGroups(i)].map(([g, b]) => ({ g, contribution: b.c })).sort((a, b) => b.contribution - a.contribution) };
}
