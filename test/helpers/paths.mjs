// Where the tests find a city and its generated data. One place, so moving the data only changes this file.
// Your own cities are not part of this repository: without them the tests look at the demo city of cities.example/ (once it is made:
// `npm run data -- --all`, or start the server once), and the tests that live with a city (cities/<id>/test/) run with `npm run test:cities`.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES, DEMO, readCityIndex } from '../../scripts/data/paths.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export { CITIES, DEMO };
/** The cities that are switched on, `{ default, cities: [] }`: yours, else the demo. */
export const cityIndex = readCityIndex();
/** The city the tests look at: CITY in the environment, else the default one; null when there is none. */
export const CITY = process.env.CITY || cityIndex.default;
export const CITY_DIR = CITY ? path.join(CITIES, CITY) : null;
export const GENERATED = CITY_DIR && path.join(CITY_DIR, 'generated');
export const GOLDEN = CITY_DIR && path.join(CITY_DIR, 'test', 'golden');
export const hasGenerated = !!CITY_DIR && fs.existsSync(path.join(GENERATED, 'cells.json'));
export const hasCache = !!CITY_DIR && fs.existsSync(path.join(CITY_DIR, 'cache', 'cells.base.json'));

/** The sample city of cities.example/, which the tests use as a stand-in for a real one. */
export const EXAMPLE_DIR = path.join(ROOT, 'cities.example', 'example');
export const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'));
export const sampleCity = readJson(EXAMPLE_DIR, 'city.json');
/** Every city folder to check: the sample one and the ones in cities/. */
export const cityDirs = [...new Set([EXAMPLE_DIR, ...cityIndex.cities.map((id) => path.join(CITIES, id))])];

/** The URL the browser asks a generated file under, and the file that answers it. */
export const dataUrl = (name, city = CITY) => `/data/${city}/${name}`;
export const fileForDataUrl = (url) => path.join(GENERATED, url.slice(`/data/${CITY}/`.length));

export const sha256 = (bufferOrFile) => createHash('sha256').update(typeof bufferOrFile === 'string' ? fs.readFileSync(bufferOrFile) : bufferOrFile).digest('hex');

export const readGolden = (name) => JSON.parse(fs.readFileSync(path.join(GOLDEN, name), 'utf8'));
/** Compares with a golden file; with UPDATE_GOLDEN=1 it writes the file instead (only do that on purpose). */
export function matchGolden(name, actual, assert) {
  const file = path.join(GOLDEN, name);
  if (process.env.UPDATE_GOLDEN) { fs.mkdirSync(GOLDEN, { recursive: true }); fs.writeFileSync(file, JSON.stringify(actual, null, 2) + '\n'); return; }
  assert.deepEqual(actual, JSON.parse(fs.readFileSync(file, 'utf8')));
}
