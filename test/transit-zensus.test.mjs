// Reading a timetable feed and the Zensus grid for any city: route types to kinds of line, grid coordinates to hexes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { routeMode, multimodalAccess } from '../scripts/data/metrics/transit_lib.mjs';
import { laeaToLonLat, lonLatToLaea } from '../scripts/data/zensus.mjs';
import { cityDirs } from './helpers/paths.mjs';

const read = (...p) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'));
test('route types: a city says its own codes, a kind without codes is never drawn', () => {
  const standard = { U: [1], T: [0, [900, 906]], R: [2, [100, 199]] };
  assert.equal(routeMode(standard, 1), 'U');
  assert.equal(routeMode(standard, 0), 'T');
  assert.equal(routeMode(standard, 903), 'T');
  assert.equal(routeMode(standard, 2), 'R');
  assert.equal(routeMode(standard, 109), 'R');
  assert.equal(routeMode({ U: [] }, 1), null);
});

test('route types: a code can be limited to routes whose short name matches, so S-Bahn and regional trains of one code part', () => {
  const frankfurt = { S: [{ code: 2, name: '^S\\d+$' }], R: [2] };
  assert.equal(routeMode(frankfurt, 2, 'S6'), 'S');
  assert.equal(routeMode(frankfurt, 2, 'S14'), 'S');
  assert.equal(routeMode(frankfurt, 2, 'RB58'), 'R');
  assert.equal(routeMode(frankfurt, 2, 'SB12'), 'R', 'a name that only starts with S is not an S-Bahn line');
  assert.equal(routeMode(frankfurt, 2, undefined), 'R');
  assert.equal(routeMode(frankfurt, 3, 'S6'), null, 'the name only counts together with the code');
});

test('bus and ferry lines add to transit access but earn no mode bonus', () => {
  const cells = { ids: ['a'], lat: [53.5], lon: [10] };
  const at = (mode, g, dph = 6) => ({ lat: 53.5, lon: 10, g, mode, dph });
  const score = (entries) => multimodalAccess(cells, entries).out.a;
  assert.equal(score([at('S', 'S1')]), 9);
  assert.equal(score([at('B', 'B5')]), 3);
  assert.equal(score([at('S', 'S1'), at('B', 'B5'), at('F', 'F62')]), 15, 'S 9 + bus 3 + ferry 3, no bonus');
  assert.equal(score([at('S', 'S1'), at('U', 'U1')]), 23, 'S 9 + U 9 + 5 for the second rail mode');
});

test('every city lists only kinds of line it also gives route types for, and the other way round', () => {
  const kinds = ['S', 'U', 'T', 'R'];
  for (const dir of cityDirs) {
    const c = read(dir, 'city.json'), id = c.id;
    const named = Object.keys(c.modes);
    assert.ok(named.length && named.every((m) => kinds.includes(m)), `${id}: modes are S, U, T or R`);
    assert.deepEqual(Object.keys(c.pipeline.gtfs.routeTypes).sort(), named.slice().sort(), `${id}: route types for exactly the listed kinds`);
    assert.ok(Object.keys(c.pipeline.gtfs.accessRouteTypes ?? {}).every((k) => ['B', 'F'].includes(k)), `${id}: accessRouteTypes name only B and F`);
    assert.ok(c.texts.modeList, `${id}: texts.modeList`);
  }
});

test('Zensus grid coordinates: the projection origin and a round trip over several cities', () => {
  const [lon, lat] = laeaToLonLat(4321000, 3210000);
  assert.ok(Math.abs(lon - 10) < 1e-6 && Math.abs(lat - 52) < 1e-6);
  const [x0, y0] = lonLatToLaea(10, 52);
  assert.ok(Math.abs(x0 - 4321000) < 1e-3 && Math.abs(y0 - 3210000) < 1e-3);
  for (const [lo, la] of [[13.4132, 52.5219], [13.067, 52.3918], [12.8, 52.2], [13.85, 52.72], [9.99, 53.55], [11.57, 48.14]]) {
    const [back, lat2] = laeaToLonLat(...lonLatToLaea(lo, la));
    assert.ok(Math.abs(back - lo) < 1e-8 && Math.abs(lat2 - la) < 1e-8, `${lo},${la}`);
  }
  // a step of 100 m east is about 0.0015 degrees of longitude at this latitude
  const [a] = laeaToLonLat(4553600, 3270000), [b] = laeaToLonLat(4553700, 3270000);
  assert.ok(b - a > 0.0013 && b - a < 0.0017);
});
