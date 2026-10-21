// The silhouette of a city for the start and loading screens: built from the outline, laid out as hexagons, words for the loading lines.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShape } from '../scripts/data/shape.mjs';
import { HEX_R, SHARED_QUIPS, layoutOf, linesOf } from '../src/shape.ts';

// a rectangle of about 40 x 20 km, and a second place to its lower left
const rect = (w, s, e, n) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
const outline = rect(10, 50, 10.56, 50.18);

test('the shape fills the outline with hexagons and keeps the stage at most ten rows tall', () => {
  const shape = buildShape(outline, [{ name: 'Elsewhere', points: [[10.1, 50.03], [10.15, 50.05]] }]);
  assert.ok(shape.rows <= 10 && shape.cols >= 3 && shape.cols <= 18);
  assert.ok(shape.cells.length > shape.cols * shape.rows * 0.8, 'a rectangle is almost full');
  const seen = new Set();
  for (const [c, r] of shape.cells) {
    assert.ok(c >= 0 && c < shape.cols && r >= 0 && r < shape.rows, `${c},${r} is on the grid`);
    assert.ok(!seen.has(`${c},${r}`), 'no cell twice');
    seen.add(`${c},${r}`);
  }
  assert.deepEqual(buildShape(outline, [{ name: 'Elsewhere', points: [[10.1, 50.03], [10.15, 50.05]] }]), shape, 'the same outline gives the same shape');
});

test('a place gets its name below the lowest of its points, and never below the grid', () => {
  const shape = buildShape(outline, [{ name: 'Elsewhere', points: [[10.1, 50.03]] }, { name: 'Far', points: [[10.3, 49.5]] }]);
  const bottom = 1.5 * (shape.rows - 1) + 1;
  assert.equal(shape.places.length, 2);
  for (const p of shape.places) assert.ok(p.y <= bottom + 2.3 + 0.01, `${p.name} stays near the grid`);
  assert.ok(shape.places[0].y > 0);
});

test('a tall city gets a coarser grid so that the stage stays the same height', () => {
  const tall = buildShape(rect(10, 50, 10.3, 50.45), []);
  assert.ok(tall.rows <= 10);
  assert.ok(tall.cols < 15);
});

test('layout: pointy-top hexagons, every second row shifted by half a hexagon', () => {
  const W = Math.sqrt(3) * HEX_R;
  const l = layoutOf({ cols: 3, rows: 2, cells: [[0, 0], [2, 1]], places: [{ name: 'X', x: 2, y: 5 }] });
  assert.deepEqual(l.hexes.map(({ x, y }) => [+x.toFixed(2), +y.toFixed(2)]), [[+(W / 2).toFixed(2), HEX_R], [+(2 * W + W).toFixed(2), +(1.5 * HEX_R + HEX_R).toFixed(2)]]);
  assert.equal(l.width, 3 * W + W / 2);
  assert.deepEqual(l.labels, [{ name: 'X', x: 2 * HEX_R, y: 5 * HEX_R }]);
  assert.ok(l.height >= 5 * HEX_R, 'the label is inside the stage');
});

test('layout: a city without a silhouette gets an oval of hexagons', () => {
  const l = layoutOf(null);
  assert.ok(l.hexes.length > 40);
  assert.deepEqual(layoutOf({ cols: 4, rows: 4, cells: [], places: [] }).hexes, l.hexes, 'an empty shape counts as none');
});

test('loading lines: the city\'s own come first, then the ones everybody shares', () => {
  assert.deepEqual(linesOf(['Own'], SHARED_QUIPS).slice(0, 2), ['Own', SHARED_QUIPS[0]]);
  assert.deepEqual(linesOf(undefined, SHARED_QUIPS), SHARED_QUIPS);
});
