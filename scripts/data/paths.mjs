// Where the cities live and how a step named in a city's manifest is found. No side effects, so servers and tools can import it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const hasCities = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'cities.json'), 'utf8')).cities.length > 0; } catch { return false; } };
/** The demo city that ships with the repository: invented places and numbers, used only while there is no cities/ folder of your own. */
export const DEMO_CITIES = path.join(ROOT, 'cities.example');
/** Whether the demo city stands in for your own cities. */
export const DEMO = !hasCities(path.join(ROOT, 'cities'));
/** The folder with the cities (cities.json and one folder per city): your own cities/, which is not part of this repository, else the demo. */
export const CITIES = DEMO ? DEMO_CITIES : path.join(ROOT, 'cities');

/** The index of the cities that are switched on, `{ default, cities: [] }`. */
export const readCityIndex = () => JSON.parse(fs.readFileSync(path.join(CITIES, 'cities.json'), 'utf8'));

/**
 * The file of a step or module named in a city's manifest (`pipeline.steps`, `pipeline.zones`). `steps/areas.mjs` is the city's own
 * (cities/<id>/steps/areas.mjs); anything else is shared and lives in scripts/data/ (`metrics/env_green.mjs`).
 */
export const stepFile = (cityDir, ref) => (ref.startsWith('steps/') ? path.join(cityDir, ref) : path.join(ROOT, 'scripts', 'data', ref));
