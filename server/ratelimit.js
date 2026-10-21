/** Fixed-window per-IP limiter. In-memory: fine for one small App Engine instance. */
export function rateLimit(perMinute) {
  const hits = new Map();
  setInterval(() => hits.clear(), 60_000).unref();
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (n > perMinute) return res.status(429).json({ error: 'rate_limited' });
    next();
  };
}
