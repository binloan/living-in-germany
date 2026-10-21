import { Router } from 'express';
import { parseLatLon } from './cities.js';
import { TtlCache } from './cache.js';
import { planRoute, ttlFor } from './routing/index.js';

export const routeRouter = Router();
const cache = new TtlCache(600, 6 * 3_600_000);
const inflight = new Map();

/** GET /api/route?lat&lon&toLat&toLon -> best weekday-morning itinerary to the commute place (see server/routing/) */
routeRouter.get('/route', async (req, res, next) => {
  try {
    const { city } = req;
    const from = parseLatLon(req.query, city);
    const to = parseLatLon({ lat: req.query.toLat, lon: req.query.toLon }, city);
    if (!from || !to) return res.status(400).json({ error: 'bad_coords' });
    const key = `${city.id}:${from.lat.toFixed(4)},${from.lon.toFixed(4)}>${to.lat.toFixed(4)},${to.lon.toFixed(4)}`;
    let out = cache.get(key);
    if (!out) {
      let job = inflight.get(key);
      if (!job) {
        job = planRoute(from, to, city).finally(() => inflight.delete(key));
        inflight.set(key, job);
      }
      out = await job;
      cache.set(key, out, ttlFor(out));
    }
    res.json(out);
  } catch (e) { next(e); }
});
