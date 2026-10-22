import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The cities the app knows. `cities/cities.json` lists the ones that are switched on (and the default); each has a manifest,
 * `cities/<id>/city.json`, and its own data next to it. Nothing else in the server names a city. The cities/ folder is not part of
 * the repository: without it the app shows the invented demo city of cities.example/.
 */
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
// Your own cities/ (not part of the repository), else the demo city of cities.example/. Same rule as scripts/data/paths.mjs, which the deployed app does not carry.
const hasCities = (dir) => { try { return readJson(path.join(dir, 'cities.json')).cities.length > 0; } catch { return false; } };
export const demo = !hasCities(path.join(root, 'cities'));
const CITIES = path.join(root, demo ? 'cities.example' : 'cities');
const readCityIndex = () => readJson(path.join(CITIES, 'cities.json'));

const index = readCityIndex();
export const cities = new Map(index.cities.map((id) => [id, readJson(path.join(CITIES, id, 'city.json'))]));
/** The city shown without `?city=`; null while no city is set up. */
export const defaultCity = cities.get(index.default) ?? null;
if (cities.size && !defaultCity) throw new Error(`cities/cities.json: default city "${index.default}" is not in the list`);

/** A file or folder inside a city's data folder. */
export const cityPath = (city, ...parts) => path.join(CITIES, city.id, ...parts);

/** What the browser may know about a city: the manifest without the server-side parts (rent storage, data pipeline). */
export const publicCity = ({ prices, pipeline, routing, ...city }) => city;

/**
 * What the start screen needs of every city, before any city's data is loaded: its name, the places it covers, the silhouette
 * (generated/shape.json, null until the data is built) and its own lines for the loading screen.
 */
const shapes = new Map();
export function citySummary(city) {
  if (!shapes.has(city.id)) {
    const file = cityPath(city, 'generated', 'shape.json');
    shapes.set(city.id, fs.existsSync(file) ? readJson(file) : null);
  }
  return { id: city.id, name: city.name, default: city === defaultCity, municipalities: city.municipalities, shape: shapes.get(city.id), splash: city.splash ?? { quips: [], pokes: [] } };
}

/** Sets `req.city` from `?city=<id>` (the default city without it); an unknown id is refused. */
export function cityOf(req, res, next) {
  if (!cities.size) return res.status(404).json({ error: 'no_cities', message: 'No city is set up: copy cities.example/ to cities/ and follow ADDING_A_CITY.md' });
  const id = req.query.city;
  const city = id == null || id === '' ? defaultCity : cities.get(String(id));
  if (!city) return res.status(400).json({ error: 'unknown_city' });
  req.city = city;
  next();
}

/** Whether a position lies inside the city's bounding box (never for a missing or non-numeric one). */
export const inBox = (city, lat, lon) => lon >= city.bbox.w && lon <= city.bbox.e && lat >= city.bbox.s && lat <= city.bbox.n;

const PRESET_REACH_M = 300;

/** Whether a position is at one of the city's commute presets, which may lie outside the box (an airport beyond the city limits). */
export function atPreset(city, lat, lon) {
  return (city.commutePresets ?? []).some((p) => {
    const dy = (lat - p.lat) * 111_320, dx = (lon - p.lon) * 111_320 * Math.cos((p.lat * Math.PI) / 180);
    return Math.hypot(dx, dy) <= PRESET_REACH_M;
  });
}

/** A position as { lat, lon } when it lies inside the city's bounding box or at one of its commute presets, else null. */
export function parseLatLon(q, city) {
  const lat = Number(q.lat), lon = Number(q.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && (inBox(city, lat, lon) || atPreset(city, lat, lon)) ? { lat, lon } : null;
}

/** The city's places as one phrase, "Exampleton and Sampleburg". */
export const regionOf = (city) => new Intl.ListFormat('en', { type: 'conjunction' }).format(city.municipalities);
