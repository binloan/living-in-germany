import type { CityShape } from './types';

/** Radius of a hexagon on the start and loading screens, in SVG units. */
export const HEX_R = 17;
const W = Math.sqrt(3) * HEX_R;

export interface Layout {
  width: number;
  height: number;
  /** centre of each hexagon of the silhouette */
  hexes: { c: number; r: number; x: number; y: number }[];
  /** names written below a place of the city */
  labels: { name: string; x: number; y: number }[];
}

/** An oval of hexagons, for a city whose silhouette is not built (yet). */
function fallbackShape(): CityShape {
  const cols = 13, rows = 8, cells: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5 + (r % 2 ? 0.5 : 0)) / cols, y = (r + 0.5) / rows;
      if (((x - 0.5) / 0.42) ** 2 + ((y - 0.5) / 0.46) ** 2 < 1) cells.push([c, r]);
    }
  }
  return { cols, rows, cells, places: [] };
}

/** Where the hexagons of a silhouette go: pointy-top, every second row shifted by half a hexagon. */
export function layoutOf(shape: CityShape | null): Layout {
  const s = shape && shape.cells.length ? shape : fallbackShape();
  const hexes = s.cells.map(([c, r]) => ({ c, r, x: c * W + (r % 2 ? W : W / 2), y: r * 1.5 * HEX_R + HEX_R }));
  const labels = s.places.map((p) => ({ name: p.name, x: p.x * HEX_R, y: p.y * HEX_R }));
  const width = s.cols * W + W / 2;
  const height = Math.max((s.rows - 1) * 1.5 * HEX_R + 2 * HEX_R, ...labels.map((l) => l.y + 6));
  return { width, height, hexes, labels };
}

/** The lines every city shares on the loading screen; a city's own come first, so its first line is the first one shown. */
export const SHARED_QUIPS = [
  'Measuring the walk to the nearest Döner…',
  'Negotiating with Schienenersatzverkehr…',
  'Teaching hexagons about rent…',
  'Looking for a flat under 10 €/m². Still looking…',
  'Rating every park by dog-per-square-metre…',
  'Calling the Hausverwaltung. On hold…',
];
export const SHARED_POKES = ['great bakery', 'quiet courtyard', 'loud, but charming', 'a park, finally', 'rent: "negotiable"', 'cyclists everywhere', 'a tree you could hug'];
export const linesOf = (own: string[] | undefined, shared: string[]) => [...(own ?? []), ...shared];
