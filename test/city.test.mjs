// The city definition the app reads: what its words say, how it is found in an address, how the server is told which one.
// Runs on the sample city of cities.example/; the words of a real city are tested with the city (cities/<id>/test/).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installFakeDom } from './helpers/fake-dom.mjs';
import { sampleCity } from './helpers/paths.mjs';

installFakeDom();
const { city, cityFromPath, inCity, modeLabel, modes, region, regionOr, regionSlash, setCity } = await import('../src/city.ts');
const { coverageNote } = await import('../src/coverage.ts');
const { publicCity, regionOf, parseLatLon, inBox } = await import('../server/cities.js');
const { config } = await import('../server/config.js');

const sample = publicCity(sampleCity);

test('the words the app builds from the city', () => {
  setCity(sample);
  assert.equal(region(), 'Exampleton and Sampleburg');
  assert.equal(regionOr(), 'Exampleton or Sampleburg');
  assert.equal(regionSlash(), 'Exampleton / Sampleburg');
  assert.equal(regionOf(sampleCity), 'Exampleton and Sampleburg');
  assert.equal(`Living in ${city().name}`, 'Living in Exampleton');
});

test('a city with one or three places reads right too', () => {
  setCity({ ...sample, municipalities: ['Hamburg'] });
  assert.deepEqual([region(), regionOr(), regionSlash()], ['Hamburg', 'Hamburg', 'Hamburg']);
  setCity({ ...sample, municipalities: ['Köln', 'Leverkusen', 'Bonn'] });
  assert.deepEqual([region(), regionOr(), regionSlash()], ['Köln, Leverkusen, and Bonn', 'Köln, Leverkusen, or Bonn', 'Köln / Leverkusen / Bonn']);
  setCity(sample);
});

test('the city comes from the first part of the address', () => {
  assert.equal(cityFromPath('/'), null);
  assert.equal(cityFromPath(''), null);
  assert.equal(cityFromPath('/example'), 'example');
  assert.equal(cityFromPath('/Hamburg/'), 'hamburg');
  assert.equal(cityFromPath('/example/anything/else'), 'example');
});

test('requests to the server name the city', () => {
  setCity(sample);
  assert.equal(inCity('/api/prices'), '/api/prices?city=example');
  assert.equal(inCity('/api/commute?lat=50&lon=10'), '/api/commute?lat=50&lon=10&city=example');
});

test('coverage wording: which places a priority lacks, and the numbers', () => {
  const places = ['Exampleton', 'Sampleburg'];
  assert.equal(coverageNote(places, { Exampleton: 1, Sampleburg: 0 }), 'Exampleton only. Coverage: Exampleton 100%, Sampleburg 0%.');
  assert.equal(coverageNote(places, { Exampleton: 0.1, Sampleburg: 0.824 }), 'Sampleburg only. Coverage: Exampleton 10%, Sampleburg 82%.');
  assert.equal(coverageNote(places, { Exampleton: 0.1, Sampleburg: 0.2 }), 'Exampleton only. Coverage: Exampleton 10%, Sampleburg 20%.');
  assert.equal(coverageNote(['A', 'B', 'C'], { A: 1, B: 0.5, C: 0 }), 'A and B only. Coverage: A 100%, B 50%, C 0%.');
});

test('the server: positions inside the box, what the browser may know', () => {
  assert.equal(inBox(sampleCity, 50, 10), true);
  assert.equal(inBox(sampleCity, 50, 11), false);
  assert.equal(inBox(sampleCity, NaN, 10), false);
  assert.deepEqual(parseLatLon({ lat: '50', lon: '10' }, sampleCity), { lat: 50, lon: 10 });
  assert.equal(parseLatLon({ lat: 'x', lon: '10' }, sampleCity), null);
  assert.equal('prices' in publicCity(sampleCity), false);
  assert.equal(JSON.stringify(config.public).includes('example'), false, 'the public settings name no city');
});

test('the kinds of line are the city\'s own words, in its order; a kind it does not list gets a plain name', () => {
  setCity(sample);
  assert.deepEqual(modes(), ['S', 'U', 'T', 'R']);
  assert.deepEqual(modes().map(modeLabel), ['S-Bahn', 'Metro', 'Tram', 'Regional']);
  setCity({ ...sample, modes: { U: 'Stadtbahn', T: 'Strassenbahn' } });
  assert.deepEqual(modes(), ['U', 'T']);
  assert.equal(modeLabel('U'), 'Stadtbahn');
  assert.equal(modeLabel('S'), 'Suburban rail');
  setCity(sample);
});
