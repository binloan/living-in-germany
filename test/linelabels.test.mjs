// Labels of lines that share tracks: one label per stretch, naming every line that runs there.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineLabels } from '../src/linelabels.ts';

// a track along a parallel of latitude: 0.001 degrees of longitude are about 70 m at 50 N
const along = (from, to, lat) => Array.from({ length: Math.round((to - from) / 0.001) + 1 }, (_, i) => [10 + from + i * 0.001, lat]);
const line = (mode, name, coords) => ({ properties: { mode, name }, geometry: { type: 'MultiLineString', coordinates: coords } });

test('two lines that share a stretch get one label naming both, and one label of their own where they part', () => {
  // A runs 0 to 0.06, B runs 0.02 to 0.08 on the same track (about 1.4 km shared)... then B leaves to the north
  const a = line('S', 'S5', [along(0, 0.06, 50)]);
  const b = line('S', 'S8', [[...along(0.02, 0.04, 50), ...along(0.041, 0.08, 50.01)]]);
  const { features } = lineLabels([a, b]);
  const keys = features.map((f) => f.properties.key);
  assert.ok(keys.includes('S5|S8'), keys.join(' '));
  assert.ok(keys.includes('S5'));
  assert.ok(keys.includes('S8'));
  assert.equal(keys.filter((k) => k === 'S5|S8').length, 1, 'the shared stretch is labelled once, not once per line');
  const shared = features.find((f) => f.properties.key === 'S5|S8');
  assert.deepEqual(JSON.parse(shared.properties.names), ['S5', 'S8']);
  assert.equal(shared.properties.n, 2);
  // the label of one line alone never sits where another line runs
  const only = features.find((f) => f.properties.key === 'S5');
  assert.ok(only.geometry.coordinates.every(([lon]) => lon < 10.02 || lon > 10.04), 'S5 alone is outside the shared part');
});

test('names are sorted as numbers, kinds are kept apart, and a short crossing does not split a label', () => {
  const lines = [line('T', '10', [along(0, 0.05, 50)]), line('T', '9', [along(0, 0.05, 50)]), line('U', 'U1', [along(0, 0.05, 50)])];
  // a third tram crossing for one sample only
  lines.push(line('T', '7', [[[10.025, 49.999], [10.025, 50.001]]]));
  const { features } = lineLabels(lines);
  const t = features.filter((f) => f.properties.mode === 'T').map((f) => f.properties.key);
  assert.deepEqual([...new Set(t.filter((k) => k !== '7'))], ['9|10'], 'trams sorted 9 before 10');
  assert.ok(!t.some((k) => k.includes('|') && k.split('|').includes('7')), 'the crossing tram is not mixed into the stretch');
  assert.deepEqual([...new Set(features.filter((f) => f.properties.mode === 'U').map((f) => f.properties.key))], ['U1'], 'a U-Bahn line on the same track is not part of the tram label');
});

test('a feed without lines, or a line of one point, gives no labels', () => {
  assert.deepEqual(lineLabels([]).features, []);
  assert.deepEqual(lineLabels([line('S', 'S1', [[[10, 50]]])]).features, []);
});
