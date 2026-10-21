/** Tiny TTL + size-capped cache (insertion order eviction). */
export class TtlCache {
  constructor(max = 500, ttlMs = 3_600_000) {
    this.max = max;
    this.ttl = ttlMs;
    this.map = new Map();
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.exp < Date.now()) { this.map.delete(key); return undefined; }
    return e.value;
  }
  set(key, value, ttlMs = this.ttl) {
    this.map.delete(key);
    this.map.set(key, { value, exp: Date.now() + ttlMs });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}

/** Runs async tasks one at a time, at least `gapMs` apart (Nominatim: max 1 req/s). */
export class SerialQueue {
  constructor(gapMs) {
    this.gap = gapMs;
    this.tail = Promise.resolve();
    this.last = 0;
  }
  run(fn) {
    const job = this.tail.then(async () => {
      const wait = this.last + this.gap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try { return await fn(); } finally { this.last = Date.now(); }
    });
    this.tail = job.catch(() => {});
    return job;
  }
}
