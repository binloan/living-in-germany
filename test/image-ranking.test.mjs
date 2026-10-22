import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageRank } from '../scripts/data/image-ranking.mjs';

test('image ranking rewards useful categories and penalises unsuitable subjects', () => {
  const neutral = imageRank('Neutral.jpg', 0, [], []);
  const street = imageRank('Street.jpg', 0, ['Street views of Example'], []);
  const animal = imageRank('Animal.jpg', 0, ['Animals of Example'], []);

  assert.equal(neutral, 0);
  assert.equal(street, -25);
  assert.equal(animal, 30);
  assert.ok(street < neutral && neutral < animal, 'lower ranks put streets before neutral images and animals last');
});

test('image ranking keeps the article-image and distance preferences', () => {
  const articles = ['Lead.jpg', 'Second.jpg'];
  assert.equal(imageRank('Lead.jpg', 0, [], articles), -30);
  assert.equal(imageRank('Second.jpg', 0, [], articles), -28.5);
  assert.equal(imageRank('Nearby.jpg', 600, [], articles), 10);
});
