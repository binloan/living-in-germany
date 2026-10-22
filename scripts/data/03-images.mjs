// Picks up to three representative photos per price zone (a district, a neighbourhood ...) from Wikimedia Commons.
// Candidates: the images of the zone's German Wikipedia article, then Commons files geotagged near the zone centre.
// Only freely licensed landscape JPEGs of a useful size are kept; the author and licence travel with each photo.
// Output: cities/<id>/generated/images.json  { [zoneId]: [{ u, w, h, page, by, lic, licUrl }] }
// Hand picks go in cities/<id>/seed/image-overrides.json  { "<zoneId>": ["Example.jpg", ...] } (Commons file names, replace the automatic choice)
// and "<zoneId>": [] hides the photos of a zone. Run after build.mjs (needs zones.json). Responses are cached in cities/<id>/cache/images.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, GEN, SEED, USER_AGENT, readJson, writeJson } from './lib.mjs';
import { imageRank } from './image-ranking.mjs';

const CACHE_DIR = path.join(CACHE, 'images');
fs.mkdirSync(CACHE_DIR, { recursive: true });
const OVERRIDES = path.join(SEED, 'image-overrides.json');
const overrides = fs.existsSync(OVERRIDES) ? readJson(OVERRIDES) : {};
const PER_ZONE = 3;
const GEO_RADIUS_M = 3000;
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

/** The German Wikipedia article of a zone: first title that exists and is no disambiguation page. */
async function articleOf(zone) {
  const titles = [`${zone.city}-${zone.name}`, zone.name, `${zone.name} (${zone.city})`];
  for (const t of titles) {
    const r = await api('de.wikipedia.org', { action: 'query', titles: t, redirects: '1', prop: 'pageprops', ppprop: 'disambiguation' });
    const p = r.query?.pages?.[0];
    if (p && !p.missing && !p.pageprops?.disambiguation) return p.title;
  }
  return null;
}

async function articleImages(title) {
  // in the order the article shows them: the first photos are the ones its editors chose to lead with
  const r = await api('de.wikipedia.org', { action: 'parse', page: title, prop: 'images', redirects: '1' });
  return (r.parse?.images ?? []).map((n) => n.replace(/_/g, ' '));
}

async function nearby(zone) {
  const r = await api('commons.wikimedia.org', { action: 'query', list: 'geosearch', gscoord: `${zone.c[1]}|${zone.c[0]}`, gsradius: String(GEO_RADIUS_M), gsnamespace: '6', gslimit: '150' });
  const found = (r.query?.geosearch ?? []).map((g) => ({ name: g.title.replace(/^File:/, ''), dist: g.dist }));
  // plus whatever Commons finds for the name itself; thinly mapped zones (a village, a new estate) rely on it
  const t = await api('commons.wikimedia.org', { action: 'query', list: 'search', srsearch: `${zone.name} ${zone.city}`, srnamespace: '6', srlimit: '40' });
  for (const x of t.query?.search ?? []) {
    const name = x.title.replace(/^File:/, '');
    if (!found.some((g) => g.name === name)) found.push({ name, dist: GEO_RADIUS_M / 2 });
  }
  return found;
}

/** Licence, size and author of Commons files, 40 per request. */
async function info(names) {
  const out = new Map();
  for (let i = 0; i < names.length; i += 40) {
    const chunk = names.slice(i, i + 40);
    const r = await api('commons.wikimedia.org', {
      action: 'query', titles: chunk.map((n) => `File:${n}`).join('|'), prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata', iiurlwidth: '800', iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|NonFree|Restrictions|Categories',
    });
    for (const p of r.query?.pages ?? []) {
      const ii = p.imageinfo?.[0];
      if (ii) out.set(p.title.replace(/^File:/, ''), ii);
    }
  }
  return out;
}

const plain = (html) => (html ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const SKIP = /karte|map\b|wappen|logo|flagge|plan\b|schild|tafel|grab|stolperstein|portr|poster|plakat|screenshot|diagram|panorama|innen|interior|detail|ausschnitt|luftbild|satellit|portal|grundriss|skizze|historisch|zeichnung|stich|beilage|kanalisation|nacht|night|bahnsteig|bahnhof ?[-_ ]?(innen|halle)|u-bahn|s-bahn|triebzug|stra(ß|ss)enbahn|tram\b|\bbus\b|bvg|haltestelle|treppe|keller|orgel|altar|kanzel|decke|saal|foyer|flur|zimmer|b(ü|u)ro|lobby|eingang|tunnel|garage|friedhof|\b(1[0-9]|20)xx\b|\b(18|19[0-6])\d\b/i;

/** Landscape JPEG, free licence, big enough to look good, no map/logo/portrait. */
function usable(name, ii) {
  const m = ii.extmetadata ?? {};
  if (ii.mime !== 'image/jpeg' || SKIP.test(name)) return null;
  if (ii.width < 1200 || ii.height < 700) return null;
  const ratio = ii.width / ii.height;
  if (ratio < 1.25 || ratio > 2.1) return null;
  if (m.NonFree?.value === 'true' || m.Restrictions?.value) return null;
  const lic = m.LicenseShortName?.value ?? '';
  if (!/^(CC|Public domain|PD|CC0)/i.test(lic) || /\b(NC|ND)\b/i.test(lic)) return null;
  return {
    u: ii.thumburl, w: ii.thumbwidth, h: ii.thumbheight, page: ii.descriptionurl,
    by: plain(m.Artist?.value).slice(0, 80) || 'Unknown', lic, licUrl: m.LicenseUrl?.value ?? '',
    cats: (m.Categories?.value ?? '').split('|'),
  };
}

const { zones } = readJson(path.join(GEN, 'zones.json'));
const out = {};
const pool = {}; // the ten best-ranked candidates per zone, for picking by hand (cities/<id>/cache/images-pool.json)
let withPhotos = 0;
const lacking = [];
for (const z of zones) {
  const forced = overrides[z.id];
  let picks;
  if (forced) {
    const meta = await info(forced);
    picks = forced.map((n) => meta.get(n) && usable(n, meta.get(n))).filter(Boolean);
  } else {
    const title = await articleOf(z);
    const fromArticle = title ? await articleImages(title) : [];
    const near = await nearby(z);
    const cand = new Map(); // name -> metres from the zone centre (0 for the article's own images)
    for (const n of fromArticle) cand.set(n, 0);
    for (const n of near) if (!cand.has(n.name)) cand.set(n.name, n.dist);
    const meta = await info([...cand.keys()]);
    const ok = [...cand.entries()].map(([n, dist]) => ({ n, v: meta.get(n) && usable(n, meta.get(n)), dist })).filter((x) => x.v).map((x) => ({ ...x, rank: imageRank(x.n, x.dist, x.v.cats, fromArticle) })).sort((a, b) => a.rank - b.rank);
    pool[z.id] = ok.slice(0, 10).map((x) => ({ n: x.n, u: x.v.u.replace(/\?.*$/, ''), by: x.v.by }));
    picks = [];
    for (const x of ok) {
      if (picks.some((p) => p.by === x.v.by && p.by !== 'Unknown')) continue; // one photographer per zone keeps the set varied
      picks.push(x.v);
      if (picks.length >= PER_ZONE) break;
    }
  }
  out[z.id] = picks.map(({ cats, ...p }) => ({ ...p, u: p.u.replace(/\?.*$/, '') })); // no tracking query on the url
  if (picks.length) withPhotos++; else lacking.push(`${z.district}/${z.name}`);
  process.stdout.write(`${z.id} ${z.name}: ${picks.length}\n`);
}
writeJson(path.join(GEN, 'images.json'), out);
writeJson(path.join(CACHE, 'images-pool.json'), pool);
console.log(`${withPhotos}/${zones.length} zones with photos`);
if (lacking.length) console.log(`no photo: ${lacking.join(', ')}`);
