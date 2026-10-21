import fs from 'node:fs';
import { Router } from 'express';
import { cellToLatLng } from 'h3-js';
import { config } from './config.js';
import { cityPath, parseLatLon } from './cities.js';
import { TtlCache } from './cache.js';

export const commuteRouter = Router();
const cache = new TtlCache(300, 24 * 3_600_000);
const inflight = new Map();

const WALK_M_PER_MIN = 80; // 4.8 km/h
const MAX_WALK_M = 1000;
const MAX_TRAVEL_MIN = 90;
const UNREACHABLE = 255;
export const TRANSFER_MIN = 6; // each transfer counts as extra minutes when choosing/scoring
/**
 * Walking and local rail only: S-Bahn, U-Bahn, tram and regional trains (RB, RE). No buses or ferries, and no ICE, IC or EC:
 * the Deutschlandticket does not cover them, and the app plans for people who ride on it. The generic RAIL mode is left out
 * as well because feeds use it for any train, long-distance ones included.
 */
export const RAIL_MODES = 'TRAM,SUBWAY,SUBURBAN,METRO,REGIONAL_RAIL,REGIONAL_FAST_RAIL';

const grids = new Map(); // city id -> its hex grid, read on first use
function loadGrid(city) {
  if (grids.has(city.id)) return grids.get(city.id);
  const { ids } = JSON.parse(fs.readFileSync(cityPath(city, 'generated', 'cells.json'), 'utf8'));
  const lat = new Float64Array(ids.length), lon = new Float64Array(ids.length);
  const buckets = new Map();
  ids.forEach((h, i) => {
    const [la, lo] = cellToLatLng(h);
    lat[i] = la; lon[i] = lo;
    const k = bucket(la, lo);
    (buckets.get(k) || buckets.set(k, []).get(k)).push(i);
  });
  const grid = { n: ids.length, lat, lon, buckets };
  grids.set(city.id, grid);
  return grid;
}
const bucket = (la, lo) => `${Math.floor(la / 0.01)}:${Math.floor(lo / 0.015)}`;

/** Local wall-clock hh:mm of the next Mon-Fri (skipping today) as ISO UTC, in German time (the tool is for Germany). */
export function nextWeekdayIso(hour = 8, minute = 30, from = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false, weekday: 'short' });
  for (let d = 1; d < 8; d++) {
    for (const utcH of [hour - 2, hour - 1]) {
      const t = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + d, utcH, minute));
      const parts = Object.fromEntries(fmt.formatToParts(t).map((p) => [p.type, p.value]));
      if (Number(parts.hour) === hour && !['Sat', 'Sun'].includes(parts.weekday)) return t.toISOString();
    }
  }
  return from.toISOString();
}

/** stops: [{lat, lon, duration(min), k(legs)}] -> { minutes, transfers } per grid cell (minutes 255 = unreachable) */
function cellMinutes(stops, city) {
  const g = loadGrid(city);
  const minutes = new Uint8Array(g.n).fill(UNREACHABLE);
  const transfers = new Uint8Array(g.n);
  const best = new Float32Array(g.n).fill(Infinity);
  const mPerDegLat = 111_320;
  for (const s of stops) {
    const mPerDegLon = 111_320 * Math.cos((s.lat * Math.PI) / 180);
    const tr = Math.max(0, s.k - 1);
    const bl = Math.floor(s.lat / 0.01), bo = Math.floor(s.lon / 0.015);
    for (let dl = -1; dl <= 1; dl++) for (let dO = -1; dO <= 1; dO++) {
      const list = g.buckets.get(`${bl + dl}:${bo + dO}`);
      if (!list) continue;
      for (const i of list) {
        const dy = (g.lat[i] - s.lat) * mPerDegLat, dx = (g.lon[i] - s.lon) * mPerDegLon;
        const dist = Math.hypot(dx, dy);
        if (dist > MAX_WALK_M) continue;
        const t = s.duration + dist / WALK_M_PER_MIN;
        const eff = t + TRANSFER_MIN * tr;
        if (eff < best[i]) { best[i] = eff; minutes[i] = Math.min(254, Math.round(t)); transfers[i] = Math.min(9, tr); }
      }
    }
  }
  for (let i = 0; i < g.n; i++) if (best[i] === Infinity || best[i] - TRANSFER_MIN * transfers[i] > MAX_TRAVEL_MIN) minutes[i] = UNREACHABLE;
  return { minutes, transfers };
}

async function fetchStops(lat, lon) {
  const url = new URL('/api/v1/one-to-all', config.transitousUrl);
  url.searchParams.set('one', `${lat},${lon}`);
  url.searchParams.set('maxTravelTime', String(MAX_TRAVEL_MIN));
  url.searchParams.set('transitModes', RAIL_MODES);
  url.searchParams.set('arriveBy', 'true'); // travel TO the pinned place
  url.searchParams.set('time', nextWeekdayIso(9, 0));
  const res = await fetch(url, { headers: { 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw Object.assign(new Error(`transitous ${res.status}`), { status: 502, code: 'upstream_error' });
  const data = await res.json();
  const seen = new Map();
  for (const a of data.all || []) {
    const p = a.place;
    if (!p || a.duration == null) continue;
    const k = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    const prev = seen.get(k);
    if (!prev || a.duration + TRANSFER_MIN * Math.max(0, (a.k ?? 1) - 1) < prev.duration + TRANSFER_MIN * Math.max(0, prev.k - 1)) seen.set(k, { lat: p.lat, lon: p.lon, duration: a.duration, k: a.k ?? 1 });
  }
  return [...seen.values()];
}

/** GET /api/commute?lat&lon -> { minutes[], transfers[], transferMin } aligned with cells.json ids; minutes -1 = unreachable */
commuteRouter.get('/commute', async (req, res, next) => {
  try {
    const { city } = req;
    const p = parseLatLon(req.query, city);
    if (!p) return res.status(400).json({ error: 'bad_coords' });
    const key = `${city.id}:${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
    let out = cache.get(key);
    if (!out) {
      let job = inflight.get(key);
      if (!job) {
        job = fetchStops(p.lat, p.lon).then((stops) => {
          const m = cellMinutes(stops, city);
          return { minutes: Array.from(m.minutes, (v) => (v === UNREACHABLE ? -1 : v)), transfers: Array.from(m.transfers), transferMin: TRANSFER_MIN, stops: stops.length };
        }).finally(() => inflight.delete(key));
        inflight.set(key, job);
      }
      out = await job;
      cache.set(key, out);
    }
    res.json(out);
  } catch (e) { next(e); }
});
