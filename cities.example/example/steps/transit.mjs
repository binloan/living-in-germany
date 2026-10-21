// Draws a made-up transit network: four lines and their stops. A real city builds these from its timetable feed
// (scripts/data/metrics/transit_gtfs.mjs, `pipeline.gtfs` in the manifest), which also scores the transit access.
//
//   generated/transit-lines.json  FeatureCollection; Feature.properties { mode: 'S'|'U'|'T'|'R', name, color }, a (Multi)LineString
//   generated/stations.json       { fields, stops: [[lat, lon, name, modes, [line names]], ...] }
import path from 'node:path';
import { GEN, writeJson } from '#data/lib.mjs';
import { ORIGIN, STEP } from './_synthetic.mjs';

// positions are in areas of the grid (column, row), so the lines cross where the cities are
const at = (col, row) => [+(ORIGIN.lat + row * STEP.lat).toFixed(5), +(ORIGIN.lon + col * STEP.lon).toFixed(5)];
const STOPS = {
  Central: at(5, 4), 'West Halt': at(0.5, 4), 'Mill Road': at(2.5, 4), 'Fair Cross': at(7.5, 4), 'East End': at(9.5, 4),
  'Sampleburg West': at(12.5, 3), 'Sampleburg Central': at(15, 3), 'Sampleburg East': at(17.5, 3),
  'North Harbour': at(5, 0.5), 'Lake Gate': at(5, 2), 'Stone Park': at(5, 6), 'South End': at(5, 7.5),
  'Old Row': at(1, 1), 'Linden Gate': at(3, 2.5), 'Hill Side': at(7, 5.5), 'Brook End': at(9, 7),
  'West Junction': at(1.5, 7),
};
const LINES = [
  { mode: 'S', name: 'S1', color: '#2e8b57', stops: ['West Halt', 'Mill Road', 'Central', 'Fair Cross', 'East End', 'Sampleburg West', 'Sampleburg Central', 'Sampleburg East'] },
  { mode: 'U', name: 'U1', color: '#1f5fbf', stops: ['North Harbour', 'Lake Gate', 'Central', 'Stone Park', 'South End'] },
  { mode: 'T', name: 'T1', color: '#d6352b', stops: ['Old Row', 'Linden Gate', 'Central', 'Hill Side', 'Brook End'] },
  { mode: 'R', name: 'R1', color: '#777777', stops: ['West Junction', 'Central', 'Sampleburg Central'] },
];

const features = LINES.map((l) => ({
  type: 'Feature',
  properties: { mode: l.mode, name: l.name, color: l.color },
  geometry: { type: 'MultiLineString', coordinates: [l.stops.map((s) => [STOPS[s][1], STOPS[s][0]])] },
}));
writeJson(path.join(GEN, 'transit-lines.json'), { type: 'FeatureCollection', features });

const MODE_ORDER = 'SUTR';
const stops = Object.entries(STOPS).map(([name, [lat, lon]]) => {
  const serving = LINES.filter((l) => l.stops.includes(name));
  const modes = [...new Set(serving.map((l) => l.mode))].sort((a, b) => MODE_ORDER.indexOf(a) - MODE_ORDER.indexOf(b)).join('');
  return [lat, lon, name, modes, serving.map((l) => l.name)];
});
writeJson(path.join(GEN, 'stations.json'), { fields: ['lat', 'lon', 'name', 'modes', 'lines'], stops });
console.log(`transit: ${LINES.length} lines, ${stops.length} stops`);
