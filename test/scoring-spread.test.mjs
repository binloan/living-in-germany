// The scores must keep telling places apart. The overall score stays unrounded because many hexes share a metric score (a police
// figure counts for a whole district); a scale that is too wide or too narrow would squeeze the scores together or pile
// them up at 0 or 100. A metric is scored on its scale in data/metrics.json unless the city sets its own, and this runs for every listed city
// that has generated data. A city that breaks these bounds has a unit or join problem, or needs a scale of its own: see
// ADDING_A_CITY.md, step 8 ("Check that the scores work in this city").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { weightedFit, NONE } from '../src/scoring.ts';
import { CITIES, ROOT, cityIndex } from './helpers/paths.mjs';

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
// A source that publishes one value per large district (a city survey with 13 districts) cannot give 15 different scores: the city's
// metric file then says how many source areas there are (`sourceAreas`), and three quarters of that number is the bound instead (a few
// districts may share a value).
const grain = (metric, generated) => {
  const areas = generated.find((x) => x.id === metric)?.sourceAreas;
  return areas ? Math.min(15, Math.ceil(areas * 0.75)) : 15;
};
const defs = read(path.join(ROOT, 'data', 'metrics.json')).filter((d) => !d.dynamic && !d.overlay);

const sd = (v) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); };
const scored = (s) => s.filter((x) => x != null);

for (const id of cityIndex.cities) {
  const file = path.join(CITIES, id, 'generated', 'cells.json');
  const skip = !fs.existsSync(file) && `no generated data for ${id}: run \`npm run data -- --all --city ${id}\``;
  const cells = skip ? null : read(file);
  const generatedDefs = skip ? [] : read(path.join(CITIES, id, 'generated', 'metrics.json'));

  test(`${id}: every metric spreads over the scale, not squeezed together, not piled up at one end`, { skip }, () => {
    for (const d of defs) {
      if (!cells.m[d.id]) continue; // the city leaves this metric out
      const s = scored(cells.m[d.id].s);
      const at = (end) => s.filter((x) => x === end).length / s.length;
      assert.ok(sd(s) > 12, `${id}/${d.id}: standard deviation ${sd(s).toFixed(1)}`);
      // landmarks is a bonus most places do not get, so most of the city is 0 by design
      if (d.id !== 'landmarks') assert.ok(at(0) < 0.55 && at(100) < 0.45, `${id}/${d.id}: ${(at(0) * 100).toFixed(0)}% at 0, ${(at(100) * 100).toFixed(0)}% at 100`);
      assert.ok(new Set(s).size >= grain(d.id, generatedDefs), `${id}/${d.id}: only ${new Set(s).size} different scores`);
    }
  });

  test(`${id}: the overall score tells places apart, for all priorities and for a few`, { skip }, () => {
    const all = Object.fromEntries(defs.filter((d) => cells.m[d.id]).map((d) => [d.id, d.weight]));
    const few = Object.fromEntries(Object.entries({ transit_access: 85, safety: 90, calm: 50, density: 25, wohnlage: 60, amenities: 55 }).filter(([m]) => cells.m[m]));
    for (const [name, w] of Object.entries({ 'all priorities': all, 'a few priorities': few })) {
      const { fit } = weightedFit(Object.entries(w).map(([m, wt]) => ({ w: wt, s: cells.m[m].s })), cells.ids.length);
      const v = [...fit].filter((x) => x !== NONE).sort((a, b) => b - a);
      const exact = new Set(v.map((x) => x.toFixed(4))).size;
      const span = v[Math.floor(v.length * 0.05)] - v[Math.floor(v.length * 0.95)];
      assert.ok(sd(v) > 10, `${id}, ${name}: standard deviation ${sd(v).toFixed(1)}`);
      assert.ok(span > 30, `${id}, ${name}: the middle 90% span only ${span.toFixed(1)} points`);
      assert.ok(exact / v.length > 0.3, `${id}, ${name}: only ${exact} different overall scores for ${v.length} hexes`);
      assert.ok(v[0] - v[99] > 5, `${id}, ${name}: the best 100 hexes span only ${(v[0] - v[99]).toFixed(1)} points`);
      // the top of the list is not one block of identical scores
      assert.equal(new Set(v.slice(0, 10).map((x) => x.toFixed(4))).size, 10, `${id}, ${name}: ties in the top 10`);
    }
  });
}
