// Shared helpers for the offline data pipeline. Run everything from the project root.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import 'dotenv/config';
import { ROOT, CITIES, readCityIndex, stepFile } from './paths.mjs';

export { ROOT, stepFile };
// The city the pipeline builds: `--city <id>` (or CITY in the environment), else the default of cities/cities.json. Its manifest is
// cities/<id>/city.json; everything the pipeline downloads, caches and generates for it lives in that folder.
const cityIndex = readCityIndex();
const argAt = process.argv.findIndex((a) => a === '--city' || a.startsWith('--city='));
export const CITY_ID = (argAt >= 0 ? (process.argv[argAt].split('=')[1] ?? process.argv[argAt + 1]) : process.env.CITY) || cityIndex.default;
// The tests of the shared helpers (route types, the Zensus grid) import this file without any city, which is fine: they touch no folder.
// Everything that builds data needs the city, and stops here with a message when there is none.
const noCityOk = !CITY_ID && !!process.env.NODE_TEST_CONTEXT;
export const CITY_DIR = noCityOk ? null : path.join(CITIES, String(CITY_ID));
if (!noCityOk && (!CITY_ID || !fs.existsSync(path.join(CITY_DIR, 'city.json')))) throw new Error(CITY_ID ? `unknown city "${CITY_ID}": no ${path.join(CITY_DIR, 'city.json')}` : 'no city is set up: copy cities.example/ to cities/ and follow ADDING_A_CITY.md');
/** The manifest of that city. */
export const CITY = noCityOk ? null : JSON.parse(fs.readFileSync(path.join(CITY_DIR, 'city.json'), 'utf8'));
const inCity = (...p) => (noCityOk ? null : path.join(CITY_DIR, ...p));
export const RAW = inCity('raw');
export const CACHE = inCity('cache');
// GEN_DIR points the pipeline at another output folder (the tests merge into a temporary copy).
export const GEN = process.env.GEN_DIR ? path.resolve(process.env.GEN_DIR) : inCity('generated');
export const SEED = inCity('seed');
export const SOURCES = inCity('sources');
export const METRICS_DIR = inCity('cache', 'metrics');
export const H3_RES = 9;
if (!noCityOk) for (const d of [RAW, CACHE, GEN, METRICS_DIR]) fs.mkdirSync(d, { recursive: true });

export const USER_AGENT = `berlin-transport-data/0.1 (${process.env.CONTACT_EMAIL || 'no-contact-set'})`;
// Berlin Polizei blocks non-browser agents.
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Download `url` to `dest` (absolute) unless it already exists. Streams to disk. Retries 3x. */
export async function download(url, dest, { headers = {}, force = false } = {}) {
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const tmp = dest + '.part';
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      fs.renameSync(tmp, dest);
      return dest;
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

/** GET JSON (cached on disk under `cacheFile` if given). */
export async function getJson(url, { cacheFile, headers = {}, method = 'GET', body } = {}) {
  if (cacheFile && fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { method, body, headers: { 'User-Agent': USER_AGENT, ...headers } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const txt = await res.text();
      if (cacheFile) {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, txt);
      }
      return JSON.parse(txt);
    } catch (e) {
      lastErr = e;
      await sleep(2000 * (i + 1));
    }
  }
  throw lastErr;
}

/**
 * Writes the description of a metric's sources to the city's sources/ folder, unless the file exists. Those files are edited by
 * hand once they exist (shorter texts for the Sources dialog), so a rerun of the pipeline must not put the first draft back.
 * Delete a file to get the script's version again.
 */
export function writeSources(name, text) {
  const file = path.join(SOURCES, name);
  if (fs.existsSync(file)) return;
  fs.mkdirSync(SOURCES, { recursive: true });
  fs.writeFileSync(file, text);
}

export const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v));
};

/** Base hex grid produced by 01-areas.mjs: { res, ids[], lat[], lon[], area[] (index into areas[]) } */
export function loadCells() {
  return readJson(path.join(CACHE, 'cells.base.json'));
}
/** Full-precision area polygons produced by 01-areas.mjs (GeoJSON FeatureCollection, WGS84).
 *  Feature.properties: { id, name, district, city: 'Berlin'|'Potsdam', bzrId?, bzrName?, kind } */
export function loadAreas() {
  return readJson(path.join(CACHE, 'areas.geo.json'));
}

/** Metric module output contract. `raw` maps h3 id -> number (omit/null = no data).
 *  `meta` = { unit, note } free-form. Written to cities/<id>/cache/metrics/<id>.json */
export function writeMetric(id, raw, meta = {}) {
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (v == null || Number.isNaN(v)) continue;
    out[k] = Math.round(v * 100) / 100;
    n++;
  }
  writeJson(path.join(METRICS_DIR, `${id}.json`), { id, n, meta, raw: out });
  console.log(`[metric:${id}] ${n} cells with data`);
}

export const haversineM = (lat1, lon1, lat2, lon2) => {
  const R = 6371008.8, d = Math.PI / 180;
  const dLat = (lat2 - lat1) * d, dLon = (lon2 - lon1) * d;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
