/**
 * Overall score maths, kept free of imports so `npm test` can run it without a browser or bundler.
 */

/** Marks a cell without a score. */
export const NONE = -1;

/** The colour ramp spreads the 3rd..99.5th percentile of the city over its full range. */
export const LOW_PERCENTILE = 0.03;
export const HIGH_PERCENTILE = 0.995;

/** One scored input: its weight and its 0..100 score per cell (NONE or null = no data). */
export interface Weighted {
  w: number;
  s: ArrayLike<number | null | undefined>;
}

/**
 * The overall score of every cell: the weighted mean of the scores that exist, nothing else. Metrics without data are skipped and the
 * weights renormalised, so a cell is never penalised for missing data. Anyone can recompute it from the weights and the metric scores.
 */
export function weightedFit(inputs: Weighted[], cellCount: number): { fit: Float32Array; used: Uint8Array } {
  const fit = new Float32Array(cellCount).fill(NONE);
  const used = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    let sum = 0, wsum = 0, n = 0;
    for (const a of inputs) {
      const s = a.s[i];
      if (s == null || s === NONE) continue;
      sum += s * a.w; wsum += a.w; n++;
    }
    if (wsum > 0) fit[i] = sum / wsum;
    used[i] = n;
  }
  return { fit, used };
}

/** Where the overall scores of the city lie, for colouring. Means cluster in the middle of 0..100, so the colours need a stretch the numbers must not have. */
export interface ShadeRange { lo: number; hi: number }

export function shadeRange(fit: ArrayLike<number>): ShadeRange | null {
  const vals: number[] = [];
  for (let i = 0; i < fit.length; i++) if (fit[i] !== NONE) vals.push(fit[i]);
  if (vals.length < 20) return null;
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * LOW_PERCENTILE)], hi = vals[Math.floor(vals.length * HIGH_PERCENTILE)];
  return hi - lo < 1e-6 ? null : { lo, hi };
}

/** Score to colour position 0..100. Display only: it never leaves the colour ramp. */
export function shade(v: number, range: ShadeRange | null): number {
  if (!range) return v;
  return Math.min(100, Math.max(0, ((v - range.lo) / (range.hi - range.lo)) * 100));
}

/** The faster the better: 100 at <=10 min, 50 at 45 min, 0 at 90 min. */
export function commuteScoreOf(min: number) {
  if (min <= 10) return 100;
  if (min <= 45) return 100 - (50 * (min - 10)) / 35;
  if (min <= 90) return 50 - (50 * (min - 45)) / 45;
  return 0;
}

/**
 * Rent score on the rent per m² (so the size of the flat never changes the ranking): 100 at or below `best`, 0 at or above `worst`.
 * The defaults are the shared scale; a city whose rents lie elsewhere sets its own in its metrics.json, so a score tells how a rent
 * compares within the city.
 */
export const PRICE_BEST = 10;
export const PRICE_WORST = 25;
export const priceScoreOf = (eurPerSqm: number, best = PRICE_BEST, worst = PRICE_WORST) => Math.min(100, Math.max(0, ((worst - eurPerSqm) / (worst - best)) * 100));

/** A spot from a district the list does not have yet beats the best spot by up to this many points. */
export const GROUP_TOLERANCE = 8;

/**
 * The best spots: highest overall score first, one per neighbourhood (at least `sepM` metres apart). Ties go to the better surrounding.
 * `near[i]` holds the hexes around hex i (itself included); a hex with fewer than 10 scored neighbours is a sliver at the edge and is skipped.
 * With `groupOf` (the district of a hex) a wide area of high scores does not fill the list: each place goes to the best spot of a district
 * not listed yet, as long as it scores within `tolerance` points of the best spot left; otherwise the best spot left takes it.
 */
export function pickTop(fit: ArrayLike<number>, near: ArrayLike<ArrayLike<number>>, latLon: (i: number) => [number, number], count = 5, sepM = 1500, groupOf?: (i: number) => string, tolerance = GROUP_TOLERANCE): { i: number; v: number }[] {
  const cand: { i: number; v: number; around: number }[] = [];
  for (let i = 0; i < fit.length; i++) {
    const v = fit[i];
    if (v === NONE) continue;
    let sum = 0, n = 0;
    for (const j of Array.from(near[i])) if (fit[j] !== NONE) { sum += fit[j]; n++; }
    if (n < 10) continue;
    cand.push({ i, v, around: sum / n });
  }
  cand.sort((a, b) => b.v - a.v || b.around - a.around);
  const out: { i: number; v: number }[] = [];
  const picked: [number, number][] = [];
  const used = new Set<string>();
  const taken = new Set<number>();
  const apart = (i: number) => {
    const [lat, lon] = latLon(i);
    return picked.every(([la, lo]) => Math.hypot((lat - la) * 111_000, (lon - lo) * 68_000) >= sepM);
  };
  while (out.length < count) {
    let best: (typeof cand)[number] | null = null;
    let fresh: (typeof cand)[number] | null = null;
    for (const c of cand) {
      if (taken.has(c.i)) continue;
      if (best && (!groupOf || c.v < best.v - tolerance)) break;
      if (!apart(c.i)) continue;
      best ??= c;
      if (groupOf && !used.has(groupOf(c.i))) { fresh = c; break; }
    }
    const c = fresh ?? best;
    if (!c) break;
    taken.add(c.i);
    picked.push(latLon(c.i));
    if (groupOf) used.add(groupOf(c.i));
    out.push({ i: c.i, v: c.v });
  }
  return out;
}
