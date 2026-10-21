import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express, { Router } from 'express';
import { config } from './config.js';
import { cityPath, defaultCity, inBox, regionOf } from './cities.js';
import { rateLimit } from './ratelimit.js';

/**
 * Average rents (EUR per m² and month) that every visitor sees and can add to. A price is { id, lat, lon, value }.
 * Two stores behind one interface: a JSON file (local runs) and Firestore (App Engine, where the disk is
 * per instance and not shared). Picked by PRICE_STORE, default: firestore on App Engine, file otherwise.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_PRICES = 2000;
const VALUE_MIN = 2; // EUR per m² and month
const VALUE_MAX = 100;
const round2 = (v) => Math.round(v * 100) / 100;

// PRICE_FILE, PRICE_DATABASE and PRICE_COLLECTION in .env name the default city's store; every other city has its own file and collection
function fileStore(city) {
  const file = config.priceFile && city === defaultCity ? path.resolve(root, config.priceFile) : cityPath(city, 'runtime', 'prices.json');
  let items = [];
  try { items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(items));
    fs.renameSync(`${file}.tmp`, file);
  };
  return {
    name: `file ${path.relative(root, file)}`,
    async list() { return items; },
    async create(p) { const item = { id: crypto.randomUUID(), ...p }; items.push(item); save(); return item; },
    async update(id, value) { const it = items.find((x) => x.id === id); if (!it) return null; it.value = value; save(); return it; },
    async remove(id) { const n = items.length; items = items.filter((x) => x.id !== id); if (items.length !== n) save(); return items.length !== n; },
  };
}

async function firestoreStore(city) {
  const { Firestore } = await import('@google-cloud/firestore');
  const database = (config.priceDatabase && city === defaultCity ? config.priceDatabase : city.prices.database) || 'prices';
  const db = new Firestore({ ...(config.gcpProject && { projectId: config.gcpProject }), databaseId: database });
  const collection = (config.priceCollection && city === defaultCity ? config.priceCollection : city.prices.collection);
  const col = db.collection(collection);
  let cache = null; // reads are cheap to repeat: keep the list a few seconds
  const fresh = () => { cache = null; };
  const toItem = (d) => ({ id: d.id, lat: d.get('lat'), lon: d.get('lon'), value: d.get('value') });
  return {
    name: `firestore ${database} / "${collection}"`,
    async list() {
      if (cache && Date.now() - cache.at < 5000) return cache.items;
      const snap = await col.limit(MAX_PRICES + 1).get();
      cache = { at: Date.now(), items: snap.docs.map(toItem) };
      return cache.items;
    },
    async create(p) { const ref = await col.add({ ...p, at: Date.now() }); fresh(); return { id: ref.id, ...p }; },
    async update(id, value) {
      const ref = col.doc(id);
      try { await ref.update({ value, at: Date.now() }); } catch (e) { if (e.code === 5) return null; throw e; }
      fresh();
      return toItem(await ref.get());
    },
    async remove(id) {
      const ref = col.doc(id);
      if (!(await ref.get()).exists) return false;
      await ref.delete();
      fresh();
      return true;
    },
  };
}

const stores = new Map(); // city id -> its price store, opened on first use
async function getStore(city) {
  if (!stores.has(city.id)) {
    const store = config.priceStore === 'firestore' ? await firestoreStore(city) : fileStore(city);
    stores.set(city.id, store);
    console.log(`rent prices (${city.id}): ${store.name}`);
  }
  return stores.get(city.id);
}

const bad = (res, msg) => res.status(400).json({ error: 'bad_request', message: msg });
const isId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s);
const num = (v) => (typeof v === 'number' ? v : NaN);

export const pricesRouter = Router();
const writeLimit = rateLimit(config.priceWritesPerMin);
pricesRouter.use('/prices', express.json({ limit: '2kb' }));
pricesRouter.use('/prices', (req, res, next) => (req.method === 'GET' ? next() : writeLimit(req, res, next)));

pricesRouter.get('/prices', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ prices: await (await getStore(req.city)).list() });
  } catch (e) { next(e); }
});

pricesRouter.post('/prices', async (req, res, next) => {
  try {
    const lat = num(req.body?.lat), lon = num(req.body?.lon), value = round2(num(req.body?.value));
    if (!inBox(req.city, lat, lon)) return bad(res, `Position is outside ${regionOf(req.city)}`);
    if (!(value >= VALUE_MIN && value <= VALUE_MAX)) return bad(res, `Rent must be between ${VALUE_MIN} and ${VALUE_MAX} EUR per m²`);
    const s = await getStore(req.city);
    if ((await s.list()).length >= MAX_PRICES) return res.status(409).json({ error: 'full', message: 'Too many prices stored' });
    res.status(201).json({ price: await s.create({ lat: +lat.toFixed(5), lon: +lon.toFixed(5), value }) });
  } catch (e) { next(e); }
});

pricesRouter.patch('/prices/:id', async (req, res, next) => {
  try {
    const value = round2(num(req.body?.value));
    if (!isId(req.params.id)) return bad(res, 'Bad id');
    if (!(value >= VALUE_MIN && value <= VALUE_MAX)) return bad(res, `Rent must be between ${VALUE_MIN} and ${VALUE_MAX} EUR per m²`);
    const item = await (await getStore(req.city)).update(req.params.id, value);
    if (!item) return res.status(404).json({ error: 'not_found' });
    res.json({ price: item });
  } catch (e) { next(e); }
});

pricesRouter.delete('/prices/:id', async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return bad(res, 'Bad id');
    const ok = await (await getStore(req.city)).remove(req.params.id);
    res.status(ok ? 204 : 404).end();
  } catch (e) { next(e); }
});
