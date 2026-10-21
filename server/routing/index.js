import { config } from '../config.js';
import { transitous } from './transitous.js';
import { vbb } from './vbb.js';

/**
 * Where the route from a spot to a commute place comes from. Transitous covers every city. A city whose region runs a timetable
 * service of its own names it in its manifest (`routing.provider`, e.g. "vbb" for Berlin) and that one is asked first; Transitous
 * answers when it is not set up, fails or finds no route. After a failure the local provider is left alone for a while.
 */
const LOCAL = { vbb };

const downUntil = new Map(); // provider id -> time until which it is not asked
export const resetCooldowns = () => downUntil.clear();

/** One line per city that names a provider of its own: whether it is used, for the log at startup. */
export function describeRouting(cities, local = LOCAL) {
  const lines = [];
  for (const city of cities) {
    const p = local[city.routing?.provider];
    if (!city.routing?.provider) continue;
    if (!p) lines.push(`[route] ${city.id}: unknown routing provider "${city.routing.provider}", Transitous only`);
    else if (config.routeSource !== 'auto') lines.push(`[route] ${city.id}: Transitous only (ROUTE_SOURCE=${config.routeSource})`);
    else if (!p.configured()) lines.push(`[route] ${city.id}: ${p.name} is not set up (${p.needs ?? 'its settings'} missing), Transitous only`);
    else lines.push(`[route] ${city.id}: ${p.name} first, Transitous as the backup`);
  }
  return lines;
}

/** The city's own provider when there is one, it is configured and asking it is allowed. */
function localFor(city, providers) {
  const p = providers[city.routing?.provider];
  return config.routeSource === 'auto' && p?.configured() ? p : null;
}

/**
 * `{ minutes, transfers, legs, source }`, or `{ none: true, source }`. `source` is the name of who planned it; `fallbackFor` is
 * the name of the local provider that was meant to and could not, so the page can say so.
 */
export async function planRoute(from, to, city, { local = LOCAL, fallback = transitous } = {}) {
  const p = localFor(city, local);
  if (p && Date.now() >= (downUntil.get(p.id) ?? 0)) {
    try {
      const route = await p.plan(from, to, city);
      if (route) return { ...route, source: p.name };
    } catch (e) {
      downUntil.set(p.id, Date.now() + config.routeCooldownMin * 60_000);
      console.warn(`[route] ${p.name} could not plan a route, using ${fallback.name} for ${config.routeCooldownMin} min: ${e.code ?? ''} ${e.message ?? e}`.trim());
    }
  }
  const route = await fallback.plan(from, to, city);
  const out = route ? { ...route, source: fallback.name } : { none: true, source: fallback.name };
  return p ? { ...out, fallbackFor: p.name } : out;
}

/** How long an answer may be reused: an answer from the stand-in is kept briefly, so the local provider is asked again soon. */
export const ttlFor = (route) => (route.fallbackFor ? 15 * 60_000 : undefined);
