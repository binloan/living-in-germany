import { config } from '../config.js';
import { SerialQueue } from '../cache.js';
import { nextWeekdayIso } from '../commute.js';
import { snapLeg } from '../railsnap.js';
import { assembleRoute, bestOf, isLongDistance, lineName, lonLat, walkLeg, wallClock, WALK_M_PER_MIN, metres } from './lib.js';

/**
 * Routes from the VBB (Verkehrsverbund Berlin-Brandenburg), the timetable service of the region itself, through its HAFAS ReST API.
 * Access is by request (api@vbb.de) and gives a key and the address of the server; both go into VBB_ACCESS_ID and VBB_API_URL.
 * Without them this provider stays off and the route comes from Transitous.
 *
 * Written from the general HAFAS ReST interface: the field names below have not yet been checked against a live answer of the
 * VBB server. When the key arrives, run `node scripts/probe-route.mjs` and compare (docs: "Routes from VBB" in the README).
 */

const queue = new SerialQueue(300);
const TIMEOUT_MS = 25_000;

/** HAFAS product classes (bitmask). 32 is IC/ICE and never requested; 1+2+4+64 = S-Bahn, U-Bahn, tram, regional (RB, RE). */
const PRODUCTS = 1 + 2 + 4 + 64;
const CLASS_MODE = { 1: 'S', 2: 'U', 4: 'T', 8: 'B', 16: 'F', 32: 'X', 64: 'R' };
/** The answer of HAFAS when there is no connection (not an error of the service). */
const NO_RESULT = /NO_RESULT|SVC_NO_RESULT|H890|H891|H892|H895|H9380/;

const list = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);

/** Mode letter of a journey leg (X: long-distance, which the Deutschlandticket does not cover). */
function modeOf(leg) {
  const prod = list(leg.Product)[0] ?? {};
  const cls = Number(prod.cls);
  if (CLASS_MODE[cls]) return CLASS_MODE[cls];
  const cat = String(prod.catOutS ?? prod.catOut ?? leg.category ?? '').trim();
  if (isLongDistance(cat) || isLongDistance(leg.name)) return 'X';
  if (/^S$/i.test(cat) || /^S\d/.test(leg.name ?? '')) return 'S';
  if (/^U$/i.test(cat) || /^U\d/.test(leg.name ?? '')) return 'U';
  if (/^(Tram|STR|M)/i.test(cat) || /^(Tram|STR)/i.test(leg.name ?? '')) return 'T';
  if (/^(RE|RB|FEX|Regional)/i.test(cat)) return 'R';
  if (/^Bus/i.test(cat) || /^Bus/i.test(leg.name ?? '')) return 'B';
  return 'B';
}

/** Instant of an { date: "2026-10-21", time: "09:00:00" } stamp, read as one clock for the whole trip (only differences are used). */
function stamp(p) {
  if (!p?.date || !p?.time) return NaN;
  const t = String(p.time);
  return Date.parse(`${p.date}T${t.length === 5 ? `${t}:00` : t.slice(0, 8)}Z`);
}
const point = (p) => lonLat(p?.lon, p?.lat);

/** Flat [lon, lat, lon, lat, ...] of a HAFAS polyline -> [[lon, lat], ...] */
function polyline(leg) {
  const crd = leg.Polyline?.crd;
  if (!Array.isArray(crd) || crd.length < 4) return [];
  const out = [];
  for (let i = 0; i + 1 < crd.length; i += 2) {
    const p = lonLat(crd[i], crd[i + 1]);
    if (p) out.push(p);
  }
  return out;
}

/** One Trip of the answer -> our route, or null when it uses a long-distance train or cannot be drawn. */
export function convertTrip(trip, from, to, city) {
  const src = list(trip?.LegList?.Leg);
  if (!src.length) return null;
  const start = [from.lon, from.lat], end = [to.lon, to.lat];
  const legs = [];
  let longDistance = false;
  src.forEach((l, i) => {
    const a = point(l.Origin) ?? (i === 0 ? start : null), b = point(l.Destination) ?? (i === src.length - 1 ? end : null);
    const fromName = l.Origin?.name || '', toName = l.Destination?.name || '';
    const t0 = stamp(l.Origin), t1 = stamp(l.Destination);
    if (l.type !== 'JNY') {
      const shape = polyline(l);
      const walk = walkLeg(a, b, fromName, toName, Number.isFinite(t0) && Number.isFinite(t1) ? Math.round((t1 - t0) / 60_000) : Math.round((l.dist ?? (a && b ? metres(a, b) : 0)) / WALK_M_PER_MIN));
      if (shape.length > 1) walk.coords = shape;
      legs.push(walk);
      return;
    }
    const mode = modeOf(l);
    if (mode === 'X') { longDistance = true; return; }
    const name = lineName(l.name ?? list(l.Product)[0]?.name);
    const stopped = list(l.Stops?.Stop).map(point).filter(Boolean);
    const stops = stopped.length >= 2 ? stopped : [a, b].filter(Boolean);
    const shape = polyline(l);
    const coords = ['R', 'S', 'U', 'T'].includes(mode) ? (snapLeg(city, mode, stops, name) ?? (shape.length > 1 ? shape : stops)) : (shape.length > 1 ? shape : stops);
    legs.push({ mode, name, color: null, from: fromName, to: toName, minutes: Math.round((t1 - t0) / 60_000), coords });
  });
  if (longDistance) return null;
  return assembleRoute(legs, stamp(src[0].Origin), stamp(src.at(-1).Destination), from, to);
}

/** The request for a trip from the spot to the commute place, arriving next weekday 09:00. Carries the access key: never log it. */
export function tripUrl(from, to) {
  const { date, time } = wallClock(nextWeekdayIso(9, 0));
  const url = new URL(`${config.vbbApiUrl}/trip`);
  const q = url.searchParams;
  q.set('accessId', config.vbbAccessId);
  q.set('format', 'json');
  q.set('originCoordLat', String(from.lat)); q.set('originCoordLong', String(from.lon)); q.set('originCoordName', 'Start');
  q.set('destCoordLat', String(to.lat)); q.set('destCoordLong', String(to.lon)); q.set('destCoordName', 'Ziel');
  q.set('date', date); q.set('time', time); q.set('searchForArrival', '1');
  q.set('products', String(PRODUCTS));
  q.set('numF', '5');
  q.set('passlist', '1');
  q.set('poly', '1');
  q.set('lang', 'de');
  return url;
}

/** The best trip from the spot to the commute place, or null when there is none. Rejects when VBB cannot be asked. */
async function plan(from, to, city) {
  const url = tripUrl(from, to);
  const res = await queue.run(() => fetch(url, { headers: { 'User-Agent': config.userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) }));
  // never put the URL into an error: it carries the access key
  const data = await res.json().catch(() => null);
  if (data?.errorCode) {
    if (NO_RESULT.test(data.errorCode)) return null;
    throw Object.assign(new Error(`vbb ${data.errorCode}`), { code: data.errorCode });
  }
  if (!res.ok || !data) throw Object.assign(new Error(`vbb ${res.status}`), { code: 'upstream_error' });
  const routes = list(data.Trip).map((t) => convertTrip(t, from, to, city)).filter(Boolean);
  return routes.length ? bestOf(routes) : null;
}

export const vbb = { id: 'vbb', name: 'VBB', needs: 'VBB_API_URL and VBB_ACCESS_ID', configured: () => !!(config.vbbApiUrl && config.vbbAccessId), plan };
