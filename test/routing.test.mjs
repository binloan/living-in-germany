import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.js';
import { assembleRoute, bestOf, lineName, wallClock } from '../server/routing/lib.js';
import http from 'node:http';
import { describeRouting, planRoute, resetCooldowns, ttlFor } from '../server/routing/index.js';
import { convertTrip } from '../server/routing/vbb.js';

// a city without a rail graph: leg geometry is then the stops themselves
const city = { id: 'no-graph-city' };
const from = { lat: 52.4565, lon: 13.3045 };
const to = { lat: 52.5251, lon: 13.3694 };

// Trips in the shape of the general HAFAS ReST interface. Replace these by recorded answers of the VBB server once the access key
// is there (scripts/probe-route.mjs shows them), and the tests tell whether server/routing/vbb.js reads them right.
const at = (hhmm) => ({ date: '2026-10-21', time: `${hhmm}:00` });
const place = (name, lat, lon, hhmm) => ({ name, lat, lon, ...at(hhmm) });
const stop = (name, lat, lon) => ({ name, lat, lon });
const ride = (name, cls, o, d, stops = []) => ({ type: 'JNY', name, Product: [{ name, cls: String(cls), catOutS: name.replace(/\d+.*/, '') }], Origin: o, Destination: d, Stops: { Stop: stops } });
const walk = (o, d, dist) => ({ type: 'WALK', Origin: o, Destination: d, dist });
const trip = (...Leg) => ({ LegList: { Leg } });

const A = (hhmm) => place('S Botanischer Garten', 52.4569, 13.3066, hhmm);
const B = (hhmm) => place('S+U Mitte', 52.5, 13.35, hhmm);
const C = (hhmm) => place('S+U Hauptbahnhof', 52.525, 13.369, hhmm);

test('a trip becomes walking and ride legs with our mode letters and names', () => {
  const r = convertTrip(trip(
    walk(place('Start', from.lat, from.lon, '08:00'), A('08:03'), 200),
    ride('S7', 1, A('08:05'), B('08:20'), [stop('S Botanischer Garten', 52.4569, 13.3066), stop('Zwischen', 52.48, 13.33), stop('S+U Mitte', 52.5, 13.35)]),
    walk(B('08:20'), B('08:22'), 100),
    ride('U2', 2, B('08:25'), C('08:35')),
  ), from, to, city);
  assert.deepEqual(r.legs.map((l) => l.mode), ['W', 'S', 'W', 'U'], 'the last stop is next to the commute place: no extra walk');
  assert.deepEqual(r.legs.filter((l) => l.mode !== 'W').map((l) => l.name), ['S7', 'U2']);
  assert.equal(r.transfers, 1);
  assert.equal(r.legs[1].coords.length, 3, 'through the stops that the answer lists');
  assert.equal(r.minutes, 35, 'from the start of the first leg to the arrival');
});

test('classes map to our modes, a regional train is R, a tram loses its prefix', () => {
  const r = convertTrip(trip(ride('Tram M10', 4, A('08:00'), B('08:10')), ride('RE1', 64, B('08:12'), C('08:30'))), from, to, city);
  assert.deepEqual(r.legs.filter((l) => l.mode !== 'W').map((l) => [l.mode, l.name]), [['T', 'M10'], ['R', 'RE1']]);
});

test('a trip with an ICE or IC is never offered, whatever the class says', () => {
  assert.equal(convertTrip(trip(ride('ICE 1599', 32, A('08:00'), C('08:30'))), from, to, city), null);
  assert.equal(convertTrip(trip({ type: 'JNY', name: 'IC 2431', Product: [{ name: 'IC 2431', catOutS: 'IC' }], Origin: A('08:00'), Destination: C('08:30') }), from, to, city), null);
});

test('a trip that does not start at the spot or end at the place gets a walk, and it counts', () => {
  const r = convertTrip(trip(ride('S7', 1, A('08:00'), B('08:10'))), from, to, city);
  assert.equal(r.legs[0].mode, 'W');
  assert.deepEqual(r.legs[0].coords[0], [from.lon, from.lat]);
  assert.equal(r.legs.at(-1).mode, 'W');
  assert.deepEqual(r.legs.at(-1).coords.at(-1), [to.lon, to.lat]);
  assert.equal(r.minutes, 10 + r.legs[0].minutes + r.legs.at(-1).minutes, 'ride plus both walks');
});

test('a trip without a ride is dropped', () => {
  assert.equal(convertTrip(trip(walk(A('08:00'), B('08:10'), 900)), from, to, city), null);
  assert.equal(convertTrip({ LegList: { Leg: [] } }, from, to, city), null);
  assert.equal(convertTrip({}, from, to, city), null);
});

test('line names are written the way the track data spells them', () => {
  assert.equal(lineName('S 7'), 'S7');
  assert.equal(lineName('STR 12'), '12');
  assert.equal(lineName('Tram M10'), 'M10');
  assert.equal(lineName('RE 1 (Berlin)'), 'RE1');
});

test('routes are compared by minutes plus transfers, and a direct regional train gets an edge', () => {
  const direct = { minutes: 30, transfers: 0, legs: [{ mode: 'R' }] };
  const change = { minutes: 25, transfers: 1, legs: [{ mode: 'S' }, { mode: 'U' }] };
  assert.equal(bestOf([change, direct]), direct, '30 - 2 beats 25 + 6');
  assert.equal(bestOf([{ minutes: 40, transfers: 0, legs: [{ mode: 'U' }] }, change]), change);
});

test('assembleRoute needs a ride and times', () => {
  assert.equal(assembleRoute([{ mode: 'W', coords: [] }], 0, 60_000, from, to), null);
  assert.equal(assembleRoute([{ mode: 'S', coords: [], from: '', to: '' }], NaN, 60_000, from, to), null);
});

test('wall clock of an instant in Berlin', () => {
  assert.deepEqual(wallClock('2026-10-21T07:00:00Z'), { date: '2026-10-21', time: '09:00' }, 'CEST');
  assert.deepEqual(wallClock('2026-12-02T08:00:00Z'), { date: '2026-12-02', time: '09:00' }, 'CET');
});

// --- which provider answers

const route = (minutes) => ({ minutes, transfers: 0, legs: [{ mode: 'S' }] });
const provider = (name, impl) => ({ id: name.toLowerCase(), name, configured: () => true, calls: 0, plan(...a) { this.calls++; return impl(...a); } });
const cityWith = { id: 'x', routing: { provider: 'local' } };

beforeEach(() => { resetCooldowns(); config.routeSource = 'auto'; });

test('the city\'s own provider answers first', async () => {
  const local = provider('Local', async () => route(20)), fallback = provider('Fallback', async () => route(99));
  const r = await planRoute(from, to, cityWith, { local: { local }, fallback });
  assert.deepEqual([r.source, r.minutes, r.fallbackFor], ['Local', 20, undefined]);
  assert.equal(fallback.calls, 0);
});

test('a failing provider is replaced by the fallback and left alone afterwards', async () => {
  const local = provider('Local', async () => { throw Object.assign(new Error('boom'), { code: 'X' }); }), fallback = provider('Fallback', async () => route(30));
  const warn = console.warn; console.warn = () => {};
  try {
    const r = await planRoute(from, to, cityWith, { local: { local }, fallback });
    assert.deepEqual([r.source, r.fallbackFor], ['Fallback', 'Local']);
    await planRoute(from, to, cityWith, { local: { local }, fallback });
    assert.equal(local.calls, 1, 'not asked again during the cooldown');
    assert.equal(ttlFor(r), 15 * 60_000, 'a stand-in answer is kept briefly');
  } finally { console.warn = warn; }
});

test('no route from the local provider: the fallback tries, and the page is told', async () => {
  const local = provider('Local', async () => null), fallback = provider('Fallback', async () => null);
  const r = await planRoute(from, to, cityWith, { local: { local }, fallback });
  assert.deepEqual(r, { none: true, source: 'Fallback', fallbackFor: 'Local' });
  const again = await planRoute(from, to, cityWith, { local: { local }, fallback });
  assert.equal(local.calls, 2, 'finding nothing is no failure: no cooldown');
  assert.equal(again.none, true);
});

test('a provider that is not set up, a city without one and the switch all lead straight to the fallback', async () => {
  const fallback = provider('Fallback', async () => route(30));
  const off = { ...provider('Local', async () => route(1)), configured: () => false };
  assert.equal((await planRoute(from, to, cityWith, { local: { local: off }, fallback })).fallbackFor, undefined, 'not set up: nobody was meant to answer');
  assert.equal((await planRoute(from, to, { id: 'y' }, { local: { local: off }, fallback })).source, 'Fallback');
  const local = provider('Local', async () => route(1));
  config.routeSource = 'transitous';
  assert.equal((await planRoute(from, to, cityWith, { local: { local }, fallback })).source, 'Fallback');
  assert.equal(local.calls, 0);
});

// --- the switch, end to end: the real VBB provider against a stand-in server

const regional = { id: 'sample', routing: { provider: 'vbb' } };
const unset = (fn) => async () => {
  const keep = { url: config.vbbApiUrl, id: config.vbbAccessId };
  try { await fn(); } finally { config.vbbApiUrl = keep.url; config.vbbAccessId = keep.id; }
};

/** A server that answers like VBB would, remembers what it was asked and can be shut down. */
async function standIn(answer) {
  const asked = [];
  const server = http.createServer((req, res) => {
    asked.push(new URL(req.url, 'http://x'));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(answer));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { asked, url: `http://127.0.0.1:${server.address().port}/restproxy`, close: () => new Promise((r) => server.close(r)) };
}

test('with VBB set up its answer replaces Transitous, asked for local trains arriving at 09:00', unset(async () => {
  const vbbServer = await standIn({ Trip: [trip(walk(place('Start', from.lat, from.lon, '08:20'), A('08:24'), 300), ride('U9', 2, A('08:25'), C('09:00')))] });
  config.vbbApiUrl = vbbServer.url; config.vbbAccessId = 'secret-key';
  const fallback = provider('Transitous', async () => route(99));
  try {
    const r = await planRoute(from, to, regional, { fallback });
    assert.deepEqual([r.source, r.fallbackFor, r.transfers], ['VBB', undefined, 0]);
    assert.equal(fallback.calls, 0, 'Transitous was not asked');
    const q = vbbServer.asked[0];
    assert.equal(q.pathname, '/restproxy/trip');
    assert.equal(q.searchParams.get('accessId'), 'secret-key');
    assert.equal(q.searchParams.get('searchForArrival'), '1');
    assert.equal(q.searchParams.get('time'), '09:00');
    assert.equal(q.searchParams.get('products'), '71', 'S-Bahn, U-Bahn, tram and regional: no ICE or IC');
    assert.equal(q.searchParams.get('originCoordLat'), String(from.lat));
    assert.equal(q.searchParams.get('destCoordLong'), String(to.lon));
  } finally { await vbbServer.close(); }
}));

test('with VBB set up but gone, Transitous answers and the page is told', unset(async () => {
  const vbbServer = await standIn({});
  config.vbbApiUrl = vbbServer.url; config.vbbAccessId = 'k';
  await vbbServer.close();
  const fallback = provider('Transitous', async () => route(30));
  const warn = console.warn; console.warn = () => {};
  try {
    const r = await planRoute(from, to, regional, { fallback });
    assert.deepEqual([r.source, r.fallbackFor], ['Transitous', 'VBB']);
  } finally { console.warn = warn; }
}));

test('VBB without a route (or only with ICE) is no failure: Transitous tries, VBB stays in use', unset(async () => {
  const vbbServer = await standIn({ errorCode: 'SVC_NO_RESULT', errorText: 'no connection' });
  config.vbbApiUrl = vbbServer.url; config.vbbAccessId = 'k';
  const fallback = provider('Transitous', async () => route(30));
  try {
    const r = await planRoute(from, to, regional, { fallback });
    assert.deepEqual([r.source, r.fallbackFor], ['Transitous', 'VBB']);
    await planRoute(from, to, regional, { fallback });
    assert.equal(vbbServer.asked.length, 2, 'no cooldown after an answer of "no connection"');
  } finally { await vbbServer.close(); }
}));

test('without a key the VBB provider stays off, and the startup log says why', unset(async () => {
  config.vbbApiUrl = ''; config.vbbAccessId = '';
  const fallback = provider('Transitous', async () => route(30));
  const r = await planRoute(from, to, regional, { fallback });
  assert.deepEqual([r.source, r.fallbackFor], ['Transitous', undefined], 'nobody was meant to answer: no "unavailable" label');
  assert.match(describeRouting([regional]).join('\n'), /sample: VBB is not set up \(VBB_API_URL and VBB_ACCESS_ID missing\), Transitous only/);
  config.vbbApiUrl = 'http://x'; config.vbbAccessId = 'k';
  assert.match(describeRouting([regional]).join('\n'), /sample: VBB first, Transitous as the backup/);
  config.routeSource = 'transitous';
  assert.match(describeRouting([regional]).join('\n'), /Transitous only \(ROUTE_SOURCE=transitous\)/);
  assert.deepEqual(describeRouting([{ id: 'hamburg' }]), [], 'a city without a provider of its own says nothing');
}));
