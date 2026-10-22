// The metric descriptions: shared definitions, the city's own texts on top, placeholders filled from the manifest.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fillTexts, resolveMetricDefs } from '../scripts/data/metric-defs.mjs';
import { EXAMPLE_DIR, ROOT, cityDirs, sampleCity } from './helpers/paths.mjs';

const read = (...p) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'));
const shared = read(ROOT, 'data', 'metrics.json');
const city = sampleCity; // any city will do: the texts are the city's, the rest is shared
const overrides = read(EXAMPLE_DIR, 'metrics.json');

test('no placeholder is left in the finished texts', () => {
  for (const d of resolveMetricDefs(shared, overrides, city.texts, 'example')) {
    for (const k of ['label', 'hint', 'info', 'note']) assert.ok(!/[{}]/.test(d[k] ?? ''), `${d.id}.${k}`);
  }
});

test('a city text that is missing is an error, not "{name}" in the app', () => {
  assert.throws(() => fillTexts('Source: {timetable}.', {}, 'x'), /no text "timetable"/);
  assert.throws(() => resolveMetricDefs(shared, {}, {}, 'nowhere'), /nowhere: metric transit_access, info: the city has no text/);
});

test('a city can only describe metrics that exist', () => {
  assert.throws(() => resolveMetricDefs(shared, { safty: { info: 'x' } }, city.texts, 'example'), /"safty", which is not a metric/);
});

test('a metric the city does not describe keeps the shared definition, and falls back to its hint in the app', () => {
  const defs = resolveMetricDefs(shared, {}, city.texts, 'example');
  const safety = defs.find((d) => d.id === 'safety');
  assert.equal(safety.info, undefined);
  assert.ok(safety.hint);
  assert.equal(safety.proxy, undefined);
});

test('every metric that is scored has a default scale, and a city may set its own', () => {
  for (const d of shared.filter((m) => !m.dynamic)) {
    assert.ok(Array.isArray(d.scale) && d.scale.length === 2 && d.scale[0] !== d.scale[1], `${d.id} needs a scale in data/metrics.json`);
  }
  const own = resolveMetricDefs(shared, { safety: { scale: [2500, 9000] } }, city.texts, 'example');
  assert.deepEqual(own.find((d) => d.id === 'safety').scale, [2500, 9000]);
  assert.deepEqual(own.find((d) => d.id === 'calm').scale, shared.find((d) => d.id === 'calm').scale, 'other metrics keep the shared scale');
  for (const bad of [[1], [1, 1], ['a', 2], 5, [1, null]]) {
    assert.throws(() => resolveMetricDefs(shared, { safety: { scale: bad } }, city.texts, 'example'), /scale of "safety" in metrics.json must be two different numbers/);
  }
});

test('every city (the sample one and yours) has the texts the shared descriptions ask for', () => {
  for (const dir of cityDirs) {
    const city = read(dir, 'city.json');
    const own = fs.existsSync(path.join(dir, 'metrics.json')) ? read(dir, 'metrics.json') : {};
    resolveMetricDefs(shared, own, city.texts, city.id);
  }
});
