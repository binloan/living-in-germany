// Makes up a number for every hex and metric, so the demo has something to show. These are NOT measurements.
// A real city has one step per metric that reads a real source and ends the same way: writeMetric(id, { [h3 id]: number }, { unit, note }).
// The ids are those of data/metrics.json; the build turns the numbers into 0..100 with the fixed scale of each metric.
import { CITY, ROOT, haversineM, loadAreas, loadCells, readJson, writeMetric } from '#data/lib.mjs';
import path from 'node:path';
import { hash, noise } from './_synthetic.mjs';

const cells = loadCells();
const areas = loadAreas().features;
const better = Object.fromEntries(readJson(path.join(ROOT, 'data', 'metrics.json')).map((d) => [d.id, d.better]));
const MAX_KM = 12; // about the distance from the centre to the far end of the city

/** 0 at the centre of the city, 1 at MAX_KM. */
const far = (i) => Math.min(1, haversineM(cells.lat[i], cells.lon[i], CITY.centre.lat, CITY.centre.lon) / 1000 / MAX_KM);
const clamp = (x) => Math.max(0, Math.min(1, x));
// value noise sits around the middle; stretch it so the good and the bad parts of town really differ
const stretch = (v) => clamp(0.5 + (v - 0.5) * 1.8);

// How each metric is made up: `lean` > 0 means better in the centre, < 0 better outside; `blocky` how much is the same for a whole area
// (like a police figure per district); `scale` is the range of data/metrics.json, which the numbers are spread over.
const FIELDS = {
  transit_access: { unit: 'pts', scale: [0, 50], lean: 0.8, blocky: 0, curve: 2, note: 'Made-up transit access.' },
  safety: { unit: 'offences per 100,000 residents', scale: [4000, 16000], lean: 0.4, blocky: 0.4, note: 'Made-up offences per 100,000 residents.' },
  calm: { unit: 'dB', scale: [40, 60], lean: 0.6, blocky: 0, note: 'Made-up noise level.' },
  building_age: { unit: 'year', scale: [1920, 2000], lean: -0.5, blocky: 0.3, note: 'Made-up age of the buildings.' },
  density: { unit: 'residents per hectare', scale: [0, 180], lean: 0.7, blocky: 0.2, note: 'Made-up density.' },
  wohnlage: { unit: 'pts', scale: [0, 100], lean: 0.3, blocky: 0.4, note: 'Made-up residential quality.' },
  amenities: { unit: 'pts', scale: [0, 35], lean: 0.7, blocky: 0, note: 'Made-up amenities.' },
  restaurants: { unit: 'restaurants x quality', scale: [0, 20], lean: 0.8, blocky: 0, curve: 2, note: 'Made-up restaurants.' },
  landmarks: { unit: 'pts', scale: [0, 1.5], lean: 0.5, blocky: 0, curve: 4, note: 'Made-up landmarks.' },
  pop_age: { unit: 'years', scale: [37, 50], lean: -0.3, blocky: 0.5, note: 'Made-up mean age of the residents.' },
  green: { unit: '% green', scale: [0, 100], lean: -0.7, blocky: 0, note: 'Made-up green space.' },
};

for (const [id, f] of Object.entries(FIELDS)) {
  const raw = {};
  cells.ids.forEach((h, i) => {
    // a part every metric shares (a good part of town is good in most ways), a part of its own
    const local = stretch(0.4 * noise(cells.lat[i], cells.lon[i], id, 0.03) + 0.6 * noise(cells.lat[i], cells.lon[i], 'shared', 0.07));
    const blocky = hash(id, areas[cells.area[i]].properties.id);
    const g = (1 - f.blocky) * local + f.blocky * blocky;
    const jitter = (hash(id, h) - 0.5) * 0.25; // every hex a little different from its neighbours
    const mix = clamp(0.5 + (g - 0.5) * 1.2 + f.lean * (0.5 - far(i)) * 0.8 + jitter);
    // mix is how good the hex is; a metric where lower is better counts down from the top of its range
    const t = mix ** (f.curve ?? 1);
    raw[h] = better[id] === 'lower' ? f.scale[1] - (f.scale[1] - f.scale[0]) * t : f.scale[0] + (f.scale[1] - f.scale[0]) * t;
  });
  writeMetric(id, raw, { unit: f.unit, note: `${f.note} Synthetic demo data, not a measurement.` });
}
