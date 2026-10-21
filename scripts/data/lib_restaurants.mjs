// Restaurants (OSM amenity=restaurant) inside the scored grid, shared by 05-ratings.mjs and metrics/env_restaurants.mjs.
// The tiles the amenities metric already downloaded (cities/<id>/raw/osm_amenities, same tiling, they include every restaurant) are reused;
// without them the restaurants are fetched per tile into cities/<id>/raw/osm_restaurants.
import fs from 'node:fs';
import path from 'node:path';
import { latLngToCell } from 'h3-js';
import { RAW, loadCells } from './lib.mjs';
import { overpass, cellsBBox, tiles } from './lib_overpass.mjs';

/** @returns {Promise<{ lat: number, lon: number, cell: number }[]>} cell = index into the hex grid */
export async function loadRestaurants() {
  const cells = loadCells();
  const index = new Map(cells.ids.map((h, i) => [h, i]));
  const seen = new Map();
  const tl = tiles(cellsBBox(), 3, 3, 0);
  for (let t = 0; t < tl.length; t++) {
    const bb = tl[t].join(',');
    const shared = path.join(RAW, 'osm_amenities', `tile_${t}.json`);
    const j = fs.existsSync(shared) ? JSON.parse(fs.readFileSync(shared, 'utf8')) : await overpass(`[out:json][timeout:300];\nnwr["amenity"="restaurant"](${bb});\nout center tags;`, path.join(RAW, 'osm_restaurants', `tile_${t}.json`));
    for (const el of j.elements) {
      const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
      if (lat == null || el.tags?.amenity !== 'restaurant') continue;
      const cell = index.get(latLngToCell(lat, lon, cells.res));
      if (cell != null) seen.set(`${el.type}/${el.id}`, { lat, lon, cell });
    }
  }
  return [...seen.values()];
}
