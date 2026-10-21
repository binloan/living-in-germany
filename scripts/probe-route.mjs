// Asks the VBB server for one trip and shows the answer's shape next to what the app makes of it. Run it once when the access key arrives:
//   VBB_API_URL=... VBB_ACCESS_ID=... node scripts/probe-route.mjs [fromLat fromLon toLat toLon]
// The field names in server/routing/vbb.js come from the general HAFAS ReST interface and have not been checked against a live answer yet.
import { config } from '../server/config.js';
import { tripUrl, convertTrip } from '../server/routing/vbb.js';

if (!config.vbbApiUrl || !config.vbbAccessId) {
  console.error('Set VBB_API_URL and VBB_ACCESS_ID (in .env or the environment) first.');
  process.exit(1);
}
const [fa, fo, ta, to] = process.argv.slice(2).map(Number);
const from = { lat: fa || 52.4565, lon: fo || 13.3045 }; // Botanischer Garten, Lichterfelde
const dest = { lat: ta || 52.5251, lon: to || 13.3694 }; // Berlin Hbf

const res = await fetch(tripUrl(from, dest), { headers: { 'User-Agent': config.userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
const text = await res.text();
console.log('HTTP', res.status, res.headers.get('content-type'));
let data;
try { data = JSON.parse(text); } catch { console.log('not JSON:', text.slice(0, 300)); process.exit(1); }
console.log('top-level keys:', Object.keys(data).join(', '));
if (data.errorCode) console.log('error:', data.errorCode, data.errorText ?? '');
const trips = [data.Trip ?? []].flat();
console.log(trips.length, 'trips');
if (trips[0]) {
  const legs = [trips[0].LegList?.Leg ?? []].flat();
  console.log('trip keys:', Object.keys(trips[0]).join(', '));
  console.log('leg keys:', [...new Set(legs.flatMap((l) => Object.keys(l)))].join(', '));
  console.log('first ride leg:', JSON.stringify(legs.find((l) => l.type === 'JNY'), null, 1).slice(0, 1800));
}
for (const t of trips) {
  const r = convertTrip(t, from, dest, { id: 'probe' });
  console.log(r ? `${r.minutes} min, ${r.transfers} transfers: ${r.legs.map((l) => (l.mode === 'W' ? `walk ${l.minutes}` : `${l.name || l.mode} ${l.minutes}`)).join(' > ')}` : 'dropped (long-distance train or not drawable)');
}
