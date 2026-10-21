import { latLngToCell } from 'h3-js';
import type { Dataset } from './data';
import { haversine } from './util';

/** A station this close counts as a landmark of a spot. */
const STATION_NEAR_M = 550;

export interface PlaceLabel {
  /** subdistrict: "Moabit West", Potsdam's Stadtteil. The bold name of a spot. */
  name: string;
  /** Berlin district ("Mitte") or Potsdam group ("Potsdam Babelsberg") */
  district: string;
  /** "Moabit West · Mitte": what to show as the main title */
  title: string;
  /** the planning-area name (street-like, "Elberfelder Straße"), with the station nearby if there is one */
  detail: string;
  /** index into ds.cells, null outside Berlin and Potsdam */
  cell: number | null;
}

const clean = (name: string) => name.replace(/\s*\[.*\]$/, '');

/** Closest station within `maxM`; rail stops beat tram stops by a 250 m head start. */
export function stationNear(ds: Dataset, lat: number, lon: number, maxM: number) {
  let best: { name: string; d: number } | null = null;
  let bestScore = Infinity;
  for (const s of ds.stations) {
    if (Math.abs(s[0] - lat) > maxM / 111_000 || Math.abs(s[1] - lon) > maxM / 68_000) continue;
    const d = haversine(lat, lon, s[0], s[1]);
    if (d > maxM) continue;
    const score = d - (/[SUR]/.test(s[3]) ? 250 : 0);
    if (score < bestScore) { bestScore = score; best = { name: clean(s[2]), d }; }
  }
  return best;
}

export function placeLabel(ds: Dataset, lat: number, lon: number): PlaceLabel {
  const cell = ds.cellIndex.get(latLngToCell(lat, lon, ds.cells.res)) ?? null;
  const area = cell != null ? ds.areas.features[ds.cells.area[cell]].properties : null;
  const station = stationNear(ds, lat, lon, STATION_NEAR_M);
  const near = station ? `near ${station.name}` : '';
  if (!area) {
    const where = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    return { name: station?.name ?? where, district: '', title: station?.name ?? where, detail: '', cell };
  }
  // where a city has a larger area above its planning areas (Berlin's Bezirksregion) that is the name and the planning area the detail
  const name = area.bzrName ?? area.name;
  const district = area.district;
  const detail = [area.name !== name ? area.name : '', near].filter(Boolean).join(' · ');
  return { name, district, title: name === district ? name : `${name} · ${district}`, detail, cell };
}

/** Colours of the saved spots A, B, C ...: distinct from the red-green score ramp. */
export const BOOKMARK_COLORS = ['#6d28d9', '#0e7490', '#c2410c', '#be185d', '#3f6212', '#1d4ed8'];
export const MAX_BOOKMARKS = 5;
