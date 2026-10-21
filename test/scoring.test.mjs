import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { GENERATED, hasGenerated } from './helpers/paths.mjs';
import { NONE, shade, shadeRange, weightedFit } from '../src/scoring.ts';

const f32 = (a) => Float32Array.from(a);

test('weightedFit: weighted mean, missing data skipped and weights renormalised', () => {
  const { fit, used } = weightedFit([
    { w: 80, s: [100, 50, null] },
    { w: 20, s: [0, NONE, null] },
  ], 3);
  assert.equal(fit[0], 80); // (100*80 + 0*20) / 100
  assert.equal(fit[1], 50); // second metric has no data: first one alone decides
  assert.equal(fit[2], NONE); // nothing has data
  assert.deepEqual([...used], [2, 1, 0]);
});

test('weightedFit: a zero weight never counts', () => {
  const { fit, used } = weightedFit([{ w: 0, s: [90] }, { w: 10, s: [40] }], 1);
  assert.equal(fit[0], 40);
  assert.equal(used[0], 2); // it has data, it just carries no weight
});

test('weightedFit: the overall score is exactly what the weights and metric scores say', () => {
  const w = [85, 60, 95, 50];
  const s = [[0], [30], [87], [22]];
  const { fit } = weightedFit(w.map((x, k) => ({ w: x, s: s[k] })), 1);
  const by_hand = (85 * 0 + 60 * 30 + 95 * 87 + 50 * 22) / (85 + 60 + 95 + 50);
  assert.ok(Math.abs(fit[0] - by_hand) < 1e-4, `${fit[0]} vs ${by_hand}`);
});

test('shade: only colours are stretched: monotonic, bounded, the spread of the city fills the ramp', () => {
  const raw = Array.from({ length: 2000 }, (_, i) => 30 + (i / 2000) * 40 + (i < 40 ? -i * 0.3 : 0) + (i > 1990 ? (i - 1990) * 2 : 0));
  const fit = f32(raw);
  const range = shadeRange(fit);
  assert.ok(range && range.lo > Math.min(...raw) && range.hi < Math.max(...raw));
  let last = -1;
  for (const v of [...raw].sort((a, b) => a - b)) {
    const s = shade(v, range);
    assert.ok(s >= 0 && s <= 100 && s >= last, `shade ${s} for ${v}`);
    last = s;
  }
  assert.equal(shade(range.lo, range), 0);
  assert.equal(shade(range.hi, range), 100);
  assert.equal(shade(55, null), 55, 'without a range the score is used as it is');
});

test('shade: too few cells or one single value gives no range', () => {
  assert.equal(shadeRange(f32([10, 20, 30])), null);
  assert.equal(shadeRange(f32(new Array(100).fill(42))), null);
});

// Regression on the real data. The first version ranked the means onto 0..100 and clamped the 3rd and 99.5th percentile: Spandau Mitte
// (weighted mean 19) showed 0 and the top matches all showed 100. Numbers are now the plain mean.
const CELLS = GENERATED && path.join(GENERATED, 'cells.json');
test('real data: scores are the plain weighted mean, nothing is clamped to 0 or 100', { skip: !hasGenerated }, () => {
  const cells = JSON.parse(readFileSync(CELLS, 'utf8'));
  const weights = { transit_access: 85, center: 60, safety: 95, calm: 50, building_age: 15, density: 35, wohnlage: 45, amenities: 65, restaurants: 20, landmarks: 10 };
  const n = cells.ids.length;
  const ids = Object.keys(weights).filter((id) => cells.m[id]);
  const { fit } = weightedFit(ids.map((id) => ({ w: weights[id], s: cells.m[id].s })), n);

  // recompute a hex by hand from the metric scores
  for (const i of [0, 1234, 5000, n - 1]) {
    let s = 0, w = 0;
    for (const id of ids) { const v = cells.m[id].s[i]; if (v == null) continue; s += v * weights[id]; w += weights[id]; }
    if (w > 0) assert.ok(Math.abs(fit[i] - s / w) < 1e-3, `hex ${i}: ${fit[i]} vs ${s / w}`);
  }

  const vals = [...fit].filter((v) => v !== NONE);
  assert.ok(vals.every((v) => v >= 0 && v <= 100));
  assert.equal(vals.filter((v) => v === 0).length, 0, 'no hex is clamped to 0');
  assert.equal(vals.filter((v) => v === 100).length, 0, 'no hex is clamped to 100');

  // the hex Spandau Mitte lies in: low transit, about 19 of 100
  const spandau = [...fit].findIndex((v, i) => v > 0 && Math.abs((cells.m.center.raw[i] ?? 0) - 12.2) < 0.06 && Math.abs((cells.m.safety.raw[i] ?? 0) - 13099) < 5 && cells.m.transit_access.s[i] === 0);
  if (spandau >= 0) assert.ok(fit[spandau] > 10 && fit[spandau] < 30, `Spandau Mitte shows ${fit[spandau]}`);

  // the best hexes differ, and to one decimal (what the list shows) the top ten are almost all different
  const best = [...vals].sort((a, b) => b - a).slice(0, 10);
  assert.ok(new Set(best.map((v) => v.toFixed(1))).size >= 6, `top ten at one decimal: ${best.map((v) => v.toFixed(1)).join(' ')}`);
});
