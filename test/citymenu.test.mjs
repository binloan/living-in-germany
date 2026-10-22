// The keys of the city picker (src/ui/citymenu.ts): which option an arrow key or a typed letter lands on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installFakeDom } from './helpers/fake-dom.mjs';

installFakeDom();
const { moveIndex, matchIndex } = await import('../src/ui/citymenu.ts');

test('arrow, Home and End keys stop at the ends of the list', () => {
  assert.equal(moveIndex('ArrowDown', 0, 3), 1);
  assert.equal(moveIndex('ArrowDown', 2, 3), 2);
  assert.equal(moveIndex('ArrowUp', 2, 3), 1);
  assert.equal(moveIndex('ArrowUp', 0, 3), 0);
  assert.equal(moveIndex('Home', 2, 3), 0);
  assert.equal(moveIndex('End', 0, 3), 2);
  assert.equal(moveIndex('a', 0, 3), null, 'other keys are not for the list');
  assert.equal(moveIndex('ArrowDown', 0, 0), null, 'an empty list has nowhere to go');
});

test('typing finds the city that starts with the letters, wrapping round', () => {
  const names = ['Berlin', 'Bremen', 'Hamburg', 'Hannover'];
  assert.equal(matchIndex(names, 'h', 0), 2);
  assert.equal(matchIndex(names, 'h', 2), 3, 'the same letter again steps to the next one');
  assert.equal(matchIndex(names, 'h', 3), 2, 'and round to the first');
  assert.equal(matchIndex(names, 'ha', 2), 2, 'a longer word stays on a name that still fits');
  assert.equal(matchIndex(names, 'han', 2), 3);
  assert.equal(matchIndex(names, 'B', 3), 0, 'capitals count as small letters');
  assert.equal(matchIndex(names, 'x', 0), -1);
});
