// Nothing of one city may reach another: every city has its own price store, and the boxes inside which prices are accepted do not overlap.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CITIES, cityIndex, readJson } from './helpers/paths.mjs';

const manifests = cityIndex.cities.map((id) => readJson(CITIES, id, 'city.json'));

test('every listed city has its own price collection', () => {
  const stores = manifests.map((c) => `${c.prices?.database ?? 'prices'}/${c.prices?.collection}`);
  assert.ok(manifests.every((c) => c.prices?.collection), 'each manifest names its prices.collection');
  assert.equal(new Set(stores).size, stores.length, `price stores are shared: ${stores.join(', ')}`);
});

test('the boxes of the listed cities do not overlap', () => {
  const overlap = (a, b) => a.w < b.e && b.w < a.e && a.s < b.n && b.s < a.n;
  for (const [i, a] of manifests.entries()) {
    for (const b of manifests.slice(i + 1)) assert.ok(!overlap(a.bbox, b.bbox), `${a.id} and ${b.id} overlap: a price would be accepted in both`);
  }
});
