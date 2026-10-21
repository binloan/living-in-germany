import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import 'dotenv/config';
import { config } from './config.js';
import { cities, citySummary, cityOf, cityPath, defaultCity, demo, publicCity } from './cities.js';
import { rateLimit } from './ratelimit.js';
import { searchRouter } from './geocode.js';
import { commuteRouter } from './commute.js';
import { routeRouter } from './route.js';
import { describeRouting } from './routing/index.js';
import { pricesRouter } from './prices.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');

// The demo city has no data until it is made: invented and offline, a few seconds, on the first start only.
if (demo && defaultCity && !fs.existsSync(cityPath(defaultCity, 'generated', 'cells.json'))) {
  console.log('Making the demo city (invented data, no download)...');
  const made = spawnSync(process.execPath, [path.join(root, 'scripts', 'data', 'build.mjs'), '--all'], { stdio: 'inherit', cwd: root });
  if (made.status !== 0) console.warn('The demo city could not be made; see above.');
}
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(compression());
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/healthz', (_req, res) => res.type('text').send('ok'));
app.get('/api/cities', (_req, res) => res.json([...cities.values()].map(citySummary)));
app.use('/api', cityOf);
app.get('/api/config', (req, res) => {
  const { city } = req;
  res.json({ ...config.public, center: city.map.center, bounds: city.map.bounds, city: publicCity(city), cities: [...cities.values()].map((c) => ({ id: c.id, name: c.name, default: c === defaultCity })) });
});
app.use('/api', rateLimit(config.rateLimitPerMin));
app.use('/api', searchRouter);
app.use('/api', commuteRouter);
app.use('/api', routeRouter);
app.use('/api', pricesRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// each city's generated files are served at /data/<city id>/
for (const city of cities.values()) {
  app.use(`/data/${city.id}`, express.static(cityPath(city, 'generated'), { maxAge: 0, etag: true, index: false, fallthrough: false }));
}
app.use('/data', (_req, res) => res.status(404).json({ error: 'not_found' })); // never the app's HTML in place of a data file

if (dev) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(dist)) console.warn('dist/ missing: run `npm run build` first');
  // App Engine stamps every deployed file with the same modified time, so an ETag built from size + time cannot tell two builds of
  // index.html apart (hashed file names keep its size). Browsers then kept a stale index.html pointing at assets that no longer exist.
  // The page is therefore never cached; the hashed files under /assets never change and can be cached for good.
  app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '1y', immutable: true, index: false, fallthrough: false }));
  app.use(express.static(dist, { index: false, etag: false, lastModified: false, cacheControl: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
  // sent from memory, so its ETag is a hash of the content and changes with every build
  const indexHtml = fs.existsSync(path.join(dist, 'index.html')) ? fs.readFileSync(path.join(dist, 'index.html'), 'utf8') : '';
  app.get('/{*splat}', (_req, res) => res.set('Cache-Control', 'no-cache').type('html').send(indexHtml));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.code || 'server_error' });
});

// Express 5 hands a failed listen to the callback instead of throwing, and in dev the Vite socket keeps the process alive: without this a
// busy port left a server that was not listening and a log line saying it was.
const server = app.listen(config.port);
server.once('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use by another program. Stop it, or set PORT in .env.` : err);
  process.exit(1);
});
server.once('listening', () => {
  console.log(`berlin-transport ${dev ? 'dev' : 'prod'} on http://localhost:${config.port}`);
  if (demo) console.warn('Showing the demo city (invented places and numbers). Your own cities go in cities/: see ADDING_A_CITY.md.');
  if (!config.contactEmail) console.warn('CONTACT_EMAIL not set: external services may reject requests (see .env.example)');
  for (const line of describeRouting(cities.values())) console.log(line);
});
