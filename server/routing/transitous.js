import { config } from '../config.js';
import { SerialQueue } from '../cache.js';
import { nextWeekdayIso, RAIL_MODES } from '../commute.js';
import { snapLeg } from '../railsnap.js';
import { bestOf } from './lib.js';

/** The route provider that covers every city: Transitous (MOTIS), open timetable data from many feeds. */

const queue = new SerialQueue(250);
const MAX_WALK_S = 30 * 60;

/** Transitous leg mode -> our mode letters (S, U, T, R, B bus, F ferry, W walk). */
function modeOf(leg) {
  const name = leg.routeShortName || '';
  switch (leg.mode) {
    case 'WALK': return 'W';
    case 'TRAM': return 'T';
    case 'SUBWAY': return 'U';
    case 'SUBURBAN': return 'S';
    case 'METRO': return /^S/.test(name) ? 'S' : 'U';
    case 'REGIONAL_RAIL': case 'REGIONAL_FAST_RAIL': case 'HIGHSPEED_RAIL': case 'LONG_DISTANCE': case 'NIGHT_RAIL': case 'RAIL': return 'R';
    case 'BUS': case 'COACH': return 'B';
    case 'FERRY': return 'F';
    default: return 'B';
  }
}

/** Decode an encoded polyline (Google algorithm) with the given precision -> [[lon, lat], ...] */
function decode(str, precision = 6) {
  const f = 10 ** precision;
  const out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d; else lon += d;
    }
    out.push([+(lon / f).toFixed(5), +(lat / f).toFixed(5)]);
  }
  return out;
}

/** Thin a polyline so that consecutive points are at least ~10 m apart (keeps the last point). */
function thin(coords) {
  if (coords.length < 3) return coords;
  const out = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    const [x0, y0] = out[out.length - 1], [x, y] = coords[i];
    if (Math.hypot((x - x0) * 67_000, (y - y0) * 111_000) >= 10) out.push(coords[i]);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

/** Rail legs follow the real tracks (OSM) through all stops of the trip; other legs use the router geometry. */
function legCoords(leg, mode, name, city) {
  const router = leg.legGeometry?.points ? thin(decode(leg.legGeometry.points, leg.legGeometry.precision ?? 6)) : [];
  if (!['R', 'S', 'U', 'T'].includes(mode)) return router;
  const stops = [leg.from, ...(leg.intermediateStops ?? []), leg.to].filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lon)).map((s) => [s.lon, s.lat]);
  return snapLeg(city, mode, stops, name) ?? router;
}

/** The best itinerary from the spot to the commute place, arriving next weekday 09:00, or null when there is none. */
async function plan(from, to, city) {
  const url = new URL('/api/v1/plan', config.transitousUrl);
  url.searchParams.set('fromPlace', `${from.lat},${from.lon}`);
  url.searchParams.set('toPlace', `${to.lat},${to.lon}`);
  url.searchParams.set('time', nextWeekdayIso(9, 0));
  url.searchParams.set('transitModes', RAIL_MODES);
  url.searchParams.set('arriveBy', 'true');
  url.searchParams.set('numItineraries', '5');
  // Transitous walks to the first and from the last stop for 15 minutes at most by default; a spot whose nearest rail stop is further
  // away (the Botanischer Garten in Lichterfelde: 18 minutes to the U3) got no route at all, while the commute map counted it as reachable
  url.searchParams.set('maxPreTransitTime', String(MAX_WALK_S));
  url.searchParams.set('maxPostTransitTime', String(MAX_WALK_S));
  const res = await queue.run(() => fetch(url, { headers: { 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(25_000) }));
  if (!res.ok) throw Object.assign(new Error(`transitous ${res.status}`), { status: 502, code: 'upstream_error' });
  const data = await res.json();
  const its = (data.itineraries || []).filter((it) => it.legs?.length);
  if (!its.length) return null;
  const routes = its.map((it) => ({
    minutes: it.duration / 60,
    transfers: it.transfers,
    legs: it.legs.map((leg) => {
      const mode = modeOf(leg);
      const name = mode === 'W' ? '' : (leg.routeShortName || leg.displayName || '').replace(/\s*\(.*\)$/, '');
      const color = leg.routeColor ? (leg.routeColor.startsWith('#') ? leg.routeColor : `#${leg.routeColor}`) : null;
      return { mode, name, color, from: leg.from?.name || '', to: leg.to?.name || '', minutes: Math.round((leg.duration || 0) / 60), coords: legCoords(leg, mode, name, city) };
    }),
  }));
  const best = bestOf(routes);
  return { ...best, minutes: Math.round(best.minutes) };
}

export const transitous = { id: 'transitous', name: 'Transitous', configured: () => true, plan };
