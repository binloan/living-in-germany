// The shape of the synthetic demo city, shared by its steps. Everything here is made up: no real place, no real number.
// A real city has no such file; its steps read real sources instead (see ADDING_A_CITY.md).

// Two places on a grid of square "areas" of about 1.5 km: Exampleton (10 x 8 areas) and Sampleburg (6 x 5), a gap of one area between them.
export const STEP = { lat: 0.0135, lon: 0.021 }; // degrees for 1.5 km at this latitude
export const ORIGIN = { lat: 49.946, lon: 9.895 };
export const PLACES = [
  { name: 'Exampleton', col0: 0, cols: 10, row0: 0, rows: 8, prefix: 'E' },
  { name: 'Sampleburg', col0: 12, cols: 6, row0: 1, rows: 5, prefix: 'S' },
];

const FIRST = ['North', 'South', 'East', 'West', 'Old', 'New', 'Upper', 'Lower', 'Green', 'Mill', 'Harbour', 'Linden', 'Castle', 'Brook', 'Stone', 'Maple', 'Market', 'Hill', 'Lake', 'Fair'];
const SECOND = ['Quarter', 'Heights', 'Gate', 'Fields', 'Row', 'Park', 'End', 'Side'];
/** A made-up district name for district number k (unique for as long as there are fewer than 160). */
export const districtName = (k) => `${FIRST[k % FIRST.length]} ${SECOND[Math.floor(k / FIRST.length) % SECOND.length]}`;

/** The corners of area (col, row), west, south, east, north. */
export const areaBox = (col, row) => [ORIGIN.lon + col * STEP.lon, ORIGIN.lat + row * STEP.lat, ORIGIN.lon + (col + 1) * STEP.lon, ORIGIN.lat + (row + 1) * STEP.lat];

// ---- deterministic noise: the same numbers on every machine, so the demo looks the same everywhere
export function hash(...parts) {
  let h = 2166136261;
  for (const p of parts.join('|')) { h ^= p.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
/** Smooth value noise in 0..1 at a point; `scale` is the size of a blob in degrees of latitude. */
export function noise(lat, lon, seed, scale = 0.05) {
  const x = lon / (scale * 1.55), y = lat / scale;
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const v = (a, b) => hash(seed, ix + a, iy + b);
  return (v(0, 0) * (1 - fx) + v(1, 0) * fx) * (1 - fy) + (v(0, 1) * (1 - fx) + v(1, 1) * fx) * fy;
}
