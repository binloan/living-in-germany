// Zensus 2022 100 m grids: population, mean age and buildings by construction year. The statistical offices publish them for all
// of Germany with the same method, so any city can use them for density, age of residents and age of buildings. Cells are
// binned into the H3 hexes of the city by their midpoint.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { unzipSync } from 'fflate';
import { latLngToCell } from 'h3-js';
import { RAW, H3_RES, BROWSER_UA, download } from './lib.mjs';

const BASE = 'https://www.destatis.de/static/DE/zensus/gitterdaten/';
export const ZENSUS = {
  population: { url: BASE + 'Zensus2022_Bevoelkerungszahl.zip', csv: 'Zensus2022_Bevoelkerungszahl_100m-Gitter.csv' },
  age: { url: BASE + 'Durchschnittsalter_in_Gitterzellen.zip', csv: 'Zensus2022_Durchschnittsalter_100m-Gitter.csv' },
  buildings: { url: BASE + 'Gebaeude_nach_Baujahr_in_Mikrozensus_Klassen.zip', csv: 'Zensus2022_Gebaeude_nach_Baujahr_in_MZ_Klassen_100m-Gitter.csv' },
};

/** The ready-made source entries of the three grids, for the sources file of a metric that uses them. */
export const ZENSUS_ATTRIBUTION = '© Statistische Ämter des Bundes und der Länder, Zensus 2022 (Datenlizenz Deutschland – Namensnennung – Version 2.0)';
export const ZENSUS_LICENSE = 'Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0), as stated in the Datensatzbeschreibung';

// ---------- ETRS89-LAEA (EPSG:3035), the grid's coordinate system, and WGS84 lon/lat (Snyder, ellipsoidal oblique Lambert azimuthal equal-area; GRS80)
const A = 6378137, E2 = 0.0066943800229, E = Math.sqrt(E2), RAD = Math.PI / 180;
const qf = (p) => { const s = Math.sin(p); return (1 - E2) * (s / (1 - E2 * s * s) - Math.log((1 - E * s) / (1 + E * s)) / (2 * E)); };
const QP = qf(Math.PI / 2), P0 = 52 * RAD, L0 = 10 * RAD, FE = 4321000, FN = 3210000;
const B0 = Math.asin(qf(P0) / QP), RQ = A * Math.sqrt(QP / 2);
const D = (A * Math.cos(P0) / Math.sqrt(1 - E2 * Math.sin(P0) ** 2)) / (RQ * Math.cos(B0));

export function laeaToLonLat(x, y) {
  const xp = x - FE, yp = y - FN;
  const rho = Math.hypot(xp / D, D * yp);
  if (rho === 0) return [L0 / RAD, P0 / RAD]; // the projection origin itself
  const C = 2 * Math.asin(rho / (2 * RQ));
  const bp = Math.asin(Math.cos(C) * Math.sin(B0) + (D * yp * Math.sin(C) * Math.cos(B0)) / rho);
  const lam = L0 + Math.atan2(xp * Math.sin(C), D * rho * Math.cos(B0) * Math.cos(C) - D * D * yp * Math.sin(B0) * Math.sin(C));
  const q = QP * Math.sin(bp);
  let p = Math.asin(q / 2);
  for (let i = 0; i < 8; i++) {
    const s = Math.sin(p);
    p += ((1 - E2 * s * s) ** 2 / (2 * Math.cos(p))) * (q / (1 - E2) - s / (1 - E2 * s * s) + Math.log((1 - E * s) / (1 + E * s)) / (2 * E));
  }
  return [lam / RAD, p / RAD];
}

export function lonLatToLaea(lon, lat) {
  const b = Math.asin(qf(lat * RAD) / QP), dl = lon * RAD - L0;
  const k = RQ * Math.sqrt(2 / (1 + Math.sin(B0) * Math.sin(b) + Math.cos(B0) * Math.cos(b) * Math.cos(dl)));
  return [FE + k * D * Math.cos(b) * Math.sin(dl), FN + (k / D) * (Math.cos(B0) * Math.sin(b) - Math.sin(B0) * Math.cos(b) * Math.cos(dl))];
}

{ // the two directions must agree, or every cell lands in the wrong hex
  const [lo, la] = laeaToLonLat(4321000, 3210000);
  const [x, y] = lonLatToLaea(13.4, 52.5), [lo2, la2] = laeaToLonLat(x, y);
  if (!(Math.abs(lo - 10) < 1e-6 && Math.abs(la - 52) < 1e-6 && Math.abs(lo2 - 13.4) < 1e-8 && Math.abs(la2 - 52.5) < 1e-8)) throw new Error('LAEA self-test failed');
}

/**
 * A test for "is this grid cell near the city": the box of the city in LAEA coordinates, a little wider than the city (the hexes at
 * its edge reach beyond the box of the outline). The grid files cover all of Germany, so most rows are dropped by this cheap test
 * before any trigonometry is spent on them.
 */
function gridBox(bbox, marginM = 3000) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const lon = bbox.w + ((bbox.e - bbox.w) * i) / 8, lat = bbox.s + ((bbox.n - bbox.s) * i) / 8;
    pts.push(lonLatToLaea(lon, bbox.s), lonLatToLaea(lon, bbox.n), lonLatToLaea(bbox.w, lat), lonLatToLaea(bbox.e, lat));
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - marginM, x1 = Math.max(...xs) + marginM, y0 = Math.min(...ys) - marginM, y1 = Math.max(...ys) + marginM;
  return (x, y) => x > x0 && x < x1 && y > y0 && y < y1;
}

/** Downloads a grid (once, nationwide) and unpacks its CSV; returns the path of the CSV. */
async function gridCsv(grid) {
  const dir = path.join(RAW, 'zensus');
  const zip = await download(grid.url, path.join(dir, path.basename(grid.url)), { headers: { 'User-Agent': BROWSER_UA } });
  const csv = path.join(dir, grid.csv);
  if (!fs.existsSync(csv)) {
    const files = unzipSync(new Uint8Array(fs.readFileSync(zip)), { filter: (f) => f.name.endsWith(grid.csv) });
    const key = Object.keys(files).find((k) => k.endsWith(grid.csv));
    if (!key) throw new Error(`${grid.csv} not in ${zip}`);
    fs.writeFileSync(csv, files[key]);
  }
  return csv;
}

const lines = (csv) => readline.createInterface({ input: fs.createReadStream(csv), crlfDelay: Infinity });
const hexOf = (x, y) => { const [lon, lat] = laeaToLonLat(x, y); return latLngToCell(lat, lon, H3_RES); };

/**
 * Residents per grid cell inside `bbox` (the city's box, { w, s, e, n }).
 * Returns { byCell: grid id -> residents, byHex: H3 hex -> residents }. The grid lists inhabited cells only: a hex or cell that is
 * not in the result has no residents.
 */
export async function populationGrid(bbox) {
  const inBox = gridBox(bbox), byCell = new Map(), byHex = new Map();
  for await (const line of lines(await gridCsv(ZENSUS.population))) {
    const c = line.split(';');
    const x = +c[1], y = +c[2], n = +c[3];
    if (!inBox(x, y) || !(n >= 0)) continue;
    byCell.set(c[0], n);
    const h = hexOf(x, y);
    byHex.set(h, (byHex.get(h) || 0) + n);
  }
  return { byCell, byHex };
}

/**
 * Mean age of the residents per hex: the mean age of every grid cell weighted by its residents (`byCell` of populationGrid).
 * Returns { byHex: hex -> [sum of age times residents, residents], cells, withoutResidents }.
 */
export async function meanAgeGrid(bbox, popByCell) {
  const inBox = gridBox(bbox), byHex = new Map();
  let cells = 0, withoutResidents = 0;
  for await (const line of lines(await gridCsv(ZENSUS.age))) {
    const c = line.split(';');
    const x = +c[1], y = +c[2], age = parseFloat(String(c[3]).replace(',', '.'));
    if (!inBox(x, y) || !(age > 0)) continue;
    const pop = popByCell.get(c[0]);
    if (!(pop > 0)) { withoutResidents++; continue; }
    const h = hexOf(x, y);
    const a = byHex.get(h) || [0, 0];
    a[0] += age * pop; a[1] += pop; byHex.set(h, a);
    cells++;
  }
  return { byHex, cells, withoutResidents };
}

/**
 * The construction year of buildings per hex. The grid counts buildings with dwellings per class of construction year; every class
 * stands for one year (`classYear`, the midpoints the metric documents). Returns { byHex: hex -> [sum of buildings times year,
 * buildings], cells, withoutClasses } with `withoutClasses` the cells that have a total only (suppressed breakdown).
 */
export async function buildingYearGrid(bbox, classYear) {
  const inBox = gridBox(bbox), byHex = new Map();
  let cells = 0, withoutClasses = 0, cols = null;
  for await (const line of lines(await gridCsv(ZENSUS.buildings))) {
    const c = line.split(';');
    if (!cols) { cols = Object.fromEntries(c.map((n, i) => [n.trim(), i])); continue; }
    const x = +c[1], y = +c[2];
    if (!inBox(x, y)) continue;
    let w = 0, ys = 0;
    for (const [k, yr] of Object.entries(classYear)) {
      const n = parseInt(c[cols[k]], 10); // '–' (zero) -> NaN
      if (n > 0) { w += n; ys += n * yr; }
    }
    if (!w) { withoutClasses++; continue; }
    const h = hexOf(x, y);
    const a = byHex.get(h) || [0, 0];
    a[0] += ys; a[1] += w; byHex.set(h, a);
    cells++;
  }
  return { byHex, cells, withoutClasses };
}
