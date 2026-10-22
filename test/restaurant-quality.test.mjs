import assert from 'node:assert/strict';
import test from 'node:test';
import { combineRestaurantAccess, restaurantQualityFactor } from '../scripts/data/restaurant_quality.mjs';

const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('restaurant quality factor keeps the existing bounded rating curve', () => {
  assert.equal(restaurantQualityFactor(4), 0.1);
  closeTo(restaurantQualityFactor(4.35), 0.5);
  assert.equal(restaurantQualityFactor(4.7), 1);
  assert.equal(restaurantQualityFactor(5), 1);
});

test('restaurant access stays missing when restaurants exist but ratings do not', () => {
  assert.equal(combineRestaurantAccess(8, null), null);
  assert.equal(combineRestaurantAccess(8, Number.NaN), null);
  assert.equal(combineRestaurantAccess(0, null), 0);
});

test('restaurant access combines density and rating quality', () => {
  assert.equal(combineRestaurantAccess(10, 4), 1);
  closeTo(combineRestaurantAccess(10, 4.35), 5);
  assert.equal(combineRestaurantAccess(10, 4.7), 10);
});
