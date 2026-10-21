/** Score colour schemes, 0..100. Each stop is [score, [r, g, b]]. */
type Rgb = [number, number, number];
type Stop = [number, Rgb];

export interface Scheme {
  id: string;
  label: string;
  stops: Stop[];
  /** alpha 0..255 for a score; sequential schemes fade low scores, diverging ones stay solid */
  alpha: (score: number) => number;
}

const fade = (s: number) => Math.round(150 + (s / 100) * 90);
const solid = () => 205;

export const SCHEMES: Scheme[] = [
  {
    id: 'plum', label: 'Plum', alpha: fade,
    stops: [[0, [246, 227, 236]], [25, [238, 176, 203]], [50, [213, 101, 159]], [75, [156, 43, 132]], [100, [75, 15, 102]]],
  },
  {
    id: 'ryg', label: 'Red–Green', alpha: solid,
    stops: [[0, [200, 46, 46]], [25, [236, 126, 58]], [50, [247, 211, 84]], [75, [140, 196, 82]], [100, [38, 145, 78]]],
  },
  {
    id: 'viridis', label: 'Blue–Yellow', alpha: solid,
    stops: [[0, [68, 1, 84]], [25, [59, 82, 139]], [50, [33, 145, 140]], [75, [94, 201, 98]], [100, [253, 231, 37]]],
  },
  {
    id: 'heat', label: 'Yellow–Red', alpha: fade,
    stops: [[0, [255, 247, 205]], [30, [253, 208, 115]], [60, [240, 120, 60]], [85, [196, 38, 38]], [100, [112, 14, 36]]],
  },
];

let current = SCHEMES[0];
export function setScheme(id: string) { current = SCHEMES.find((s) => s.id === id) ?? SCHEMES[0]; }
export const getScheme = () => current;

export function rampRgb(score: number, scheme: Scheme = current): Rgb {
  const s = Math.max(0, Math.min(100, score));
  const stops = scheme.stops;
  for (let i = 1; i < stops.length; i++) {
    const [s1, c1] = stops[i];
    if (s <= s1) {
      const [s0, c0] = stops[i - 1];
      const t = (s - s0) / (s1 - s0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t].map(Math.round) as Rgb;
    }
  }
  return stops[stops.length - 1][1];
}

/** RGBA for deck.gl. */
export function rampRgba(score: number): [number, number, number, number] {
  const [r, g, b] = rampRgb(score);
  return [r, g, b, current.alpha(Math.max(0, Math.min(100, score)))];
}

export const rampCss = (score: number, scheme: Scheme = current) => {
  const [r, g, b] = rampRgb(score, scheme);
  return `rgb(${r} ${g} ${b})`;
};

export const gradientOf = (scheme: Scheme = current, angle = '90deg') =>
  `linear-gradient(${angle}, ${scheme.stops.map(([s, [r, g, b]]) => `rgb(${r} ${g} ${b}) ${s}%`).join(', ')})`;
