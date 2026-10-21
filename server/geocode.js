import { Router } from 'express';
import { config } from './config.js';
import { parseLatLon } from './cities.js';
import { TtlCache, SerialQueue } from './cache.js';

export const searchRouter = Router();
const searchCache = new TtlCache(500, 3_600_000);
const reverseCache = new TtlCache(2000, 24 * 3_600_000);
const nominatimQueue = new SerialQueue(1100);
const headers = { 'User-Agent': config.userAgent, Accept: 'application/json' };

async function getJson(url, ms = 8000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw Object.assign(new Error(`upstream ${res.status}`), { status: 502, code: 'upstream_error' });
  return res.json();
}

const compact = (parts) => parts.filter(Boolean).join(', ');

/** GET /api/search?q=... -> [{ label, detail, lat, lon, kind }] (Photon, biased to the city) */
searchRouter.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 120);
    if (q.length < 2) return res.json([]);
    const { city } = req;
    const key = `${city.id}:${q.toLowerCase()}`;
    const hit = searchCache.get(key);
    if (hit) return res.json(hit);
    const url = new URL('/api/', config.photonUrl);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '12');
    url.searchParams.set('lang', 'de');
    url.searchParams.set('lat', String(city.search.lat));
    url.searchParams.set('lon', String(city.search.lon));
    url.searchParams.set('bbox', `${city.bbox.w},${city.bbox.s},${city.bbox.e},${city.bbox.n}`);
    const data = await getJson(url);
    const out = (data.features || []).map((f) => {
      const p = f.properties || {};
      const street = p.street ? `${p.street}${p.housenumber ? ' ' + p.housenumber : ''}` : '';
      const label = p.name || street || p.city || '';
      const detail = compact([p.name && street ? street : '', [p.postcode, p.district || p.city].filter(Boolean).join(' ')]);
      return { label, detail, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], kind: p.osm_value || p.type || '' };
    }).filter((r) => r.label);
    const seen = new Set();
    const unique = out.filter((r) => { const k = r.label + '|' + r.detail; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
    searchCache.set(key, unique);
    res.json(unique);
  } catch (e) { next(e); }
});

/** GET /api/reverse?lat&lon -> { address, locality } (Nominatim, cached, max 1 req/s) */
searchRouter.get('/reverse', async (req, res, next) => {
  try {
    const p = parseLatLon(req.query, req.city);
    if (!p) return res.status(400).json({ error: 'bad_coords' });
    const key = `${req.city.id}:${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    const hit = reverseCache.get(key);
    if (hit) return res.json(hit);
    const url = new URL('/reverse', config.nominatimUrl);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', p.lat.toFixed(6));
    url.searchParams.set('lon', p.lon.toFixed(6));
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', 'de');
    const data = await nominatimQueue.run(() => getJson(url));
    const a = data.address || {};
    const road = a.road || a.pedestrian || a.footway || a.path || a.cycleway || '';
    const out = {
      address: road ? `${road}${a.house_number ? ' ' + a.house_number : ''}` : (data.name || ''),
      locality: [a.postcode, a.suburb || a.city_district || a.village || a.town || a.city].filter(Boolean).join(' '),
    };
    reverseCache.set(key, out);
    res.json(out);
  } catch (e) { next(e); }
});
