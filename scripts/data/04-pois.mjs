// Landmarks for the map: round photo pins that help to find your way around.
// cities/<id>/seed/pois.json lists them by German Wikipedia title; position and photo come from the article (Wikipedia coordinates,
// lead photo), the photo's author and licence from Wikimedia Commons. Only freely licensed photos are kept.
// Output: cities/<id>/generated/pois.json  [{ id, name, rank, lat, lon, wiki, u, page, by, lic }]
// u is a 60 px Commons thumbnail; the client derives the larger ones (120 px for the pin on sharp screens, 500/960 px for the opened card).
// w, h = size of the original, so the client never asks for a thumbnail bigger than the file.
// Responses are cached in cities/<id>/cache/pois. Run after build.mjs; `npm run data:pois`.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, CITY, GEN, ROOT, SEED, USER_AGENT, readJson, writeJson } from './lib.mjs';

const CACHE_DIR = path.join(CACHE, 'pois');
fs.mkdirSync(CACHE_DIR, { recursive: true });
const SEED_POIS = readJson(path.join(SEED, 'pois.json')).pois;
const BBOX = CITY.bbox;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(host, params) {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })}`;
  const file = path.join(CACHE_DIR, crypto.createHash('sha1').update(url).digest('hex') + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      const json = await res.json();
      fs.writeFileSync(file, JSON.stringify(json));
      await sleep(120);
      return json;
    }
    await sleep(1500 * (i + 1));
  }
  throw new Error(`Wikimedia API failed: ${url}`);
}

const plain = (html) => (html ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const SKIP = /karte|map\b|wappen|logo|flagge|plan\b|grundriss|luftbild|satellit|innen|interior|stich|zeichnung|historisch|bundesarchiv|aerial|luft|foyer|zimmer|rundgang|kopfstein|bunker|panoramio|weltzeituhr|innenhof|courtyard|cour_|musiker|eingang|gedenktafel|nacht|night|schnee|snow|einweihung|abflug|dbpb|stolperstein|denkmal|1[0-9]{3}|escalier|treppe|unter_den|cour /i;

/** A freely licensed JPEG with its author and licence, or null. */
async function commonsInfo(name) {
  const r = await api('commons.wikimedia.org', {
    action: 'query', titles: `File:${name}`, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '60',
    iiextmetadatafilter: 'Artist|LicenseShortName|NonFree|Restrictions',
  });
  const ii = r.query?.pages?.[0]?.imageinfo?.[0];
  if (!ii || ii.mime !== 'image/jpeg' || ii.width < 300 || ii.height < 300) return null;
  const m = ii.extmetadata ?? {};
  const lic = m.LicenseShortName?.value ?? '';
  if (m.NonFree?.value === 'true' || m.Restrictions?.value || !/^(CC|Public domain|PD|CC0)/i.test(lic) || /\b(NC|ND)\b/i.test(lic)) return null;
  return { u: ii.thumburl, w: ii.width, h: ii.height, page: ii.descriptionurl, by: plain(m.Artist?.value).slice(0, 80) || 'Unknown', lic };
}

async function articleImages(title) {
  const r = await api('de.wikipedia.org', { action: 'parse', page: title, prop: 'images', redirects: '1' });
  return (r.parse?.images ?? []).map((n) => n.replace(/_/g, ' '));
}

const out = [];
const problems = [];
for (const seed of SEED_POIS) {
  const r = await api('de.wikipedia.org', { action: 'query', titles: seed.wiki, redirects: '1', prop: 'coordinates|pageimages', piprop: 'name', colimit: '1' });
  const p = r.query?.pages?.[0];
  if (!p || p.missing) { problems.push(`${seed.wiki}: no article`); continue; }
  const c = p.coordinates?.[0];
  const lat = seed.lat ?? c?.lat, lon = seed.lon ?? c?.lon;
  if (lat == null || lon == null) { problems.push(`${seed.wiki}: no coordinates`); continue; }
  if (lon < BBOX.w || lon > BBOX.e || lat < BBOX.s || lat > BBOX.n) { problems.push(`${seed.wiki}: outside the map (${lat}, ${lon})`); continue; }
  const candidates = [seed.file, p.pageimage, ...(await articleImages(p.title))].filter(Boolean);
  let photo = null, file = null;
  for (const name of [...new Set(candidates)].slice(0, 30)) {
    if (name !== seed.file && SKIP.test(name)) continue;
    photo = await commonsInfo(name);
    if (photo) { file = name; break; }
  }
  if (!photo) { problems.push(`${seed.wiki}: no free photo`); continue; }
  out.push({
    id: crypto.createHash('sha1').update(p.title).digest('hex').slice(0, 8),
    name: seed.name ?? p.title.replace(/ \(.*\)$/, ''),
    rank: seed.rank ?? 2,
    lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5,
    wiki: `https://de.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
    ...photo, file,
  });
}

writeJson(path.join(GEN, 'pois.json'), out);
console.log(`${out.length}/${SEED_POIS.length} landmarks -> ${path.relative(ROOT, path.join(GEN, "pois.json"))}`);
for (const x of problems) console.log(`  ! ${x}`);
