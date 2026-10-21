import { TRANSFER_MIN } from '../commute.js';

/** What every routing provider shares: the legs of a route, how routes are compared and how the gaps at both ends are closed. */

export const WALK_M_PER_MIN = 80;

/** Trains the Deutschlandticket does not cover; a route that uses one is never offered. */
const LONG_DISTANCE = /^(ICE?|IC|EC|ECE|EN|NJ|RJX?|TGV|THA|FLX)\b/i;
export const isLongDistance = (name) => LONG_DISTANCE.test((name || '').trim());

/** "S 7" -> "S7", "STR 12" -> "12", "Tram M10" -> "M10": the spelling Transitous and the OSM line refs use. */
export const lineName = (name) => (name || '').replace(/\s*\(.*\)$/, '').replace(/^(STR|Tram|Bus)\s+/i, '').replace(/^([A-Za-z]+)\s+(\d)/, '$1$2').trim();

export const metres = (a, b) => Math.hypot((a[0] - b[0]) * 67_000, (a[1] - b[1]) * 111_000);

/** [lon, lat] rounded to 5 places, or null when the object has no usable position. */
export function lonLat(lon, lat) {
  const x = Number(lon), y = Number(lat);
  return lon != null && lat != null && Number.isFinite(x) && Number.isFinite(y) ? [+x.toFixed(5), +y.toFixed(5)] : null;
}

/** Fewest "perceived" minutes: transfers cost extra, a direct regional train gets a small edge. */
export const cost = (route) => route.minutes + TRANSFER_MIN * route.transfers - (route.transfers === 0 && route.legs.some((l) => l.mode === 'R') ? 2 : 0);
export const bestOf = (routes) => routes.reduce((a, b) => (cost(b) < cost(a) ? b : a));

export function walkLeg(a, b, fromName, toName, minutes) {
  return { mode: 'W', name: '', color: null, from: fromName, to: toName, minutes: Math.max(1, minutes), coords: a && b ? [a, b] : [] };
}

/**
 * The finished route of a provider: its legs, the time from first departure to last arrival and the transfers.
 * A provider may begin or end at a stop instead of at the spot or the place: a walk closes that gap, so the line reaches both
 * and the walk counts in the time. Null when there is no ride at all.
 */
export function assembleRoute(legs, departMs, arriveMs, from, to) {
  const rides = legs.filter((l) => l.mode !== 'W').length;
  if (!rides || !Number.isFinite(departMs) || !Number.isFinite(arriveMs)) return null;
  const start = [from.lon, from.lat], end = [to.lon, to.lat];
  let minutes = Math.round((arriveMs - departMs) / 60_000);
  const first = legs.find((l) => l.coords.length)?.coords[0];
  const last = [...legs].reverse().find((l) => l.coords.length)?.coords.at(-1);
  if (first && legs[0].mode !== 'W' && metres(start, first) > 60) {
    const walk = walkLeg(start, first, '', legs[0].from, Math.round(metres(start, first) / WALK_M_PER_MIN));
    legs.unshift(walk);
    minutes += walk.minutes;
  }
  if (last && legs.at(-1).mode !== 'W' && metres(end, last) > 60) {
    const walk = walkLeg(last, end, legs.at(-1).to, '', Math.round(metres(last, end) / WALK_M_PER_MIN));
    legs.push(walk);
    minutes += walk.minutes;
  }
  return { minutes, transfers: rides - 1, legs };
}

/** Local wall-clock { date: "YYYY-MM-DD", time: "HH:MM" } of an instant in a time zone. */
export function wallClock(iso, timeZone = 'Europe/Berlin') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
