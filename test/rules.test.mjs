import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { GENERATED, hasGenerated } from './helpers/paths.mjs';
import { cellToLatLng, gridDisk } from 'h3-js';
import { NONE, commuteScoreOf, pickTop, priceScoreOf, weightedFit } from '../src/scoring.ts';

// The method text in the Sources dialog says: "10 minutes scores 100, 45 scores 50, 90 scores 0"
test('commute score matches the method text', () => {
  assert.equal(commuteScoreOf(0), 100);
  assert.equal(commuteScoreOf(10), 100);
  assert.equal(commuteScoreOf(45), 50);
  assert.equal(commuteScoreOf(90), 0);
  assert.equal(commuteScoreOf(120), 0, 'an unreachable place counts 120 minutes');
  let last = 101;
  for (let m = 0; m <= 120; m += 3) { const s = commuteScoreOf(m); assert.ok(s <= last, `rises at ${m} min`); last = s; }
});

// "100 at <= 10 EUR/m2, 0 at >= 25 EUR/m2"
test('rent score matches the method text and ignores the flat size', () => {
  assert.equal(priceScoreOf(10), 100);
  assert.equal(priceScoreOf(5), 100);
  assert.equal(priceScoreOf(25), 0);
  assert.equal(priceScoreOf(40), 0);
  assert.equal(priceScoreOf(17.5), 50);
});

test('rent score follows the scale a city sets, not the shared one', () => {
  assert.equal(priceScoreOf(18, 18, 27), 100);
  assert.equal(priceScoreOf(27, 18, 27), 0);
  assert.equal(priceScoreOf(22.5, 18, 27), 50);
  assert.equal(priceScoreOf(30, 18, 27), 0);
});

// "Top matches: the five best-scoring hexagons, at least 1.5 km apart"
test('pickTop: best first, at least the separation apart, slivers skipped', () => {
  // a 30 x 30 grid, 500 m apart; the score rises towards the south-east corner
  const side = 30, n = side * side;
  const pos = (i) => [52.4 - Math.floor(i / side) * 0.0045, 13.3 + (i % side) * 0.0074];
  const fit = Float32Array.from({ length: n }, (_, i) => Math.floor(i / side) + (i % side) * 0.5);
  const near = Array.from({ length: n }, (_, i) => {
    const out = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const y = Math.floor(i / side) + dy, x = (i % side) + dx;
      if (y >= 0 && y < side && x >= 0 && x < side) out.push(y * side + x);
    }
    return out;
  });
  const top = pickTop(fit, near, pos, 5, 1500);
  assert.equal(top.length, 5);
  for (let k = 1; k < top.length; k++) assert.ok(top[k].v <= top[k - 1].v, 'sorted by score');
  for (let a = 0; a < top.length; a++) for (let b = a + 1; b < top.length; b++) {
    const [la, loa] = pos(top[a].i), [lb, lob] = pos(top[b].i);
    assert.ok(Math.hypot((la - lb) * 111000, (loa - lob) * 68000) >= 1500, 'separated');
  }
  assert.ok(near[top[0].i].length >= 10, 'not a sliver');
  assert.notEqual(fit[top[0].i], NONE);
});

// "A hexagon from a district not listed yet takes the place when it scores within 8 points of the best one left"
test('pickTop with districts: a wide high-scoring district does not fill the list', () => {
  const side = 40, n = side * side;
  const pos = (i) => [52.4 - Math.floor(i / side) * 0.0045, 13.3 + (i % side) * 0.0074];
  // a broad plateau of 82 in the west (district W), a smaller one at 76 (M) and a weak one at 60 (E)
  const dist = (i) => ((i % side) < 20 ? 'W' : (i % side) < 30 ? 'M' : 'E');
  const fit = Float32Array.from({ length: n }, (_, i) => { const d = dist(i); return d === 'W' ? 82 + (i % 3) * 0.1 : d === 'M' ? 76 + (i % 3) * 0.1 : 60; });
  const near = Array.from({ length: n }, (_, i) => {
    const out = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const y = Math.floor(i / side) + dy, x = (i % side) + dx;
      if (y >= 0 && y < side && x >= 0 && x < side) out.push(y * side + x);
    }
    return out;
  });
  const plain = pickTop(fit, near, pos, 5, 1500);
  assert.ok(plain.every((t) => dist(t.i) === 'W'), 'without districts the plateau fills the list');
  const mixed = pickTop(fit, near, pos, 5, 1500, dist);
  assert.equal(dist(mixed[0].i), 'W', 'the best spot still leads');
  assert.ok(mixed.some((t) => dist(t.i) === 'M'), 'a close district gets a place');
  assert.ok(!mixed.some((t) => dist(t.i) === 'E'), 'a district 22 points behind does not');
  assert.equal(mixed.length, 5, 'the list is still full');
  for (let a = 0; a < mixed.length; a++) for (let b = a + 1; b < mixed.length; b++) {
    const [la, loa] = pos(mixed[a].i), [lb, lob] = pos(mixed[b].i);
    assert.ok(Math.hypot((la - lb) * 111000, (loa - lob) * 68000) >= 1500, 'still separated');
  }
});

const CELLS = GENERATED && path.join(GENERATED, 'cells.json');
test('real data: the top matches are real scores, sorted, and barely tie at one decimal', { skip: !hasGenerated }, () => {
  const cells = JSON.parse(readFileSync(CELLS, 'utf8'));
  const weights = { transit_access: 85, center: 60, safety: 95, calm: 50, building_age: 15, density: 35, wohnlage: 45, amenities: 65, restaurants: 20, landmarks: 10 };
  const n = cells.ids.length;
  const { fit } = weightedFit(Object.entries(weights).filter(([id]) => cells.m[id]).map(([id, w]) => ({ w, s: cells.m[id].s })), n);
  const idx = new Map(cells.ids.map((id, i) => [id, i]));
  const near = cells.ids.map((id) => gridDisk(id, 2).map((h) => idx.get(h)).filter((x) => x != null));
  const top = pickTop(fit, near, (i) => cellToLatLng(cells.ids[i]), 5, 1500);
  assert.equal(top.length, 5);
  // two spots in different neighbourhoods can still land on the same decimal (83.5 and 83.5 without rent); a crowd of them cannot
  assert.ok(new Set(top.map((t) => t.v.toFixed(1))).size >= 4, `top five at one decimal: ${top.map((t) => t.v.toFixed(1)).join(' ')}`);
  for (let k = 1; k < top.length; k++) assert.ok(top[k].v <= top[k - 1].v);
  assert.ok(top.every((t) => t.v < 100), 'nobody shows 100');
});
