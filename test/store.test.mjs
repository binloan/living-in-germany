// What the browser keeps: priorities and settings for the visitor, commute places, saved spots and notes for each city.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { installFakeDom } from './helpers/fake-dom.mjs';

installFakeDom();
let data = new Map();
globalThis.localStorage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
const { store } = await import('../src/store.ts');

const WEIGHTS = { safety: 80, calm: 35 };
const point = (id, share = 100) => ({ id, name: id, lat: 52.5, lon: 13.4, share });
const bookmark = (id) => ({ id, lat: 52.5, lon: 13.4, name: id, sub: '' });
const stored = (key) => JSON.parse(localStorage.getItem(key));
const open = (city, first = 'berlin') => store.init(WEIGHTS, city, first);

beforeEach(() => { data = new Map(); });

test('commute places, saved spots and notes belong to the city', () => {
  open('berlin');
  store.setP({ commute: [point('hbf')], bookmarks: [bookmark('a')], notes: { x: { clean: 'clean' } } });
  open('hamburg');
  assert.deepEqual([store.p.commute, store.p.bookmarks, store.p.notes], [[], [], {}], 'another city starts empty');
  store.setP({ commute: [point('hh')], bookmarks: [bookmark('b')] });
  open('berlin');
  assert.deepEqual(store.p.commute.map((p) => p.id), ['hbf']);
  assert.deepEqual(store.p.bookmarks.map((b) => b.id), ['a']);
  assert.deepEqual(store.p.notes, { x: { clean: 'clean' } });
  open('hamburg');
  assert.deepEqual(store.p.commute.map((p) => p.id), ['hh']);
});

test('priorities, weights and how the map looks stay with the visitor in every city', () => {
  open('berlin');
  store.setP({ weights: { safety: 10, calm: 90 }, heatOpacity: 0.4, flatSize: 65 });
  open('hamburg');
  assert.deepEqual([store.p.weights.safety, store.p.weights.calm, store.p.heatOpacity, store.p.flatSize], [10, 90, 0.4, 65]);
});

test('the shared settings no longer carry the per-city parts', () => {
  open('berlin');
  store.setP({ commute: [point('hbf')], bookmarks: [bookmark('a')], flatSize: 70 });
  const shared = stored('berlin-fit.v1');
  assert.equal(shared.flatSize, 70);
  for (const k of ['commute', 'bookmarks', 'notes']) assert.ok(!(k in shared), `${k} is kept per city`);
  assert.deepEqual(stored('berlin-fit.v1.berlin').commute.map((p) => p.id), ['hbf']);
});

test('what was saved before there were cities belongs to the first city, whichever city opens first', () => {
  const legacy = { weights: { safety: 55 }, commute: [point('old')], bookmarks: [bookmark('old')], notes: { y: { clean: 'dirty' } }, flatSize: 48 };
  data.set('berlin-fit.v1', JSON.stringify(legacy));
  open('hamburg'); // the visitor happens to open the other city first
  assert.deepEqual([store.p.commute, store.p.bookmarks], [[], []]);
  assert.equal(store.p.weights.safety, 55, 'weights come along for every city');
  store.setP({ flatSize: 50 }); // the shared settings are rewritten here: the old data must already be safe
  open('berlin');
  assert.deepEqual(store.p.commute.map((p) => p.id), ['old']);
  assert.deepEqual(store.p.bookmarks.map((b) => b.id), ['old']);
  assert.deepEqual(store.p.notes, { y: { clean: 'dirty' } });
});

test('the old data moves once: emptying a city afterwards does not bring it back', () => {
  data.set('berlin-fit.v1', JSON.stringify({ commute: [point('old')], bookmarks: [], notes: {} }));
  open('berlin');
  store.setP({ commute: [] });
  data.set('berlin-fit.v1', JSON.stringify({ commute: [point('old')], bookmarks: [], notes: {} })); // an older tab writes the old shape again
  open('berlin');
  assert.deepEqual(store.p.commute, []);
});

test('a browser that cannot store anything still works', () => {
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  try {
    open('berlin');
    store.setP({ commute: [point('x')] });
    assert.deepEqual(store.p.commute.map((p) => p.id), ['x']);
  } finally { globalThis.localStorage = saved; }
});
