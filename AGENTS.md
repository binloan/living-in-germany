# Guide for AI agents

This file is for coding agents (and people who prefer a short map) working on **Living in Germany**: a full-screen map that scores the neighbourhoods of a German city by the visitor's priorities and commute places. It covers two jobs: **adding a city** and **maintaining the code**. Read [README.md](README.md) first for what the app does and [ADDING_A_CITY.md](ADDING_A_CITY.md) for the full, step by step guide to a city; this file tells you how the pieces fit and where the traps are.

## The one idea to hold on to

The app is **city-independent**. Nothing in `server/`, `src/` or the shared pipeline names a city. A city is a folder of data plus a few small scripts, kept **outside this repository** in `cities/` (it can be a repository of its own). Without it the app shows an invented demo city from `cities.example/`, so a fresh clone runs: `npm install && npm run dev`.

Consequences for you:

- Never add a real city's data, manifest or step scripts to this repository. The only city here is the invented one in `cities.example/`.
- Never hard-code a city (a name, a coordinate, an id, a data source) in shared code. If shared code needs something city-specific, it belongs in the city's manifest (`cities/<id>/city.json`) and shared code reads it from there.
- The criteria, weights and interface are the same for every city; only the data differs.

## Map of the repository

```
src/                 client (Vite + vanilla TypeScript, MapLibre GL, deck.gl/H3). scoring.ts has no imports on purpose.
server/              Express: /api/* (cities, config, search, commute, route, prices), serves each city's generated files at /data/<id>/
server/routing/      route providers: Transitous (default) and regional services a manifest can name (routing.provider)
scripts/data/        the shared data pipeline: lib.mjs, build.mjs (the merge), metrics/*.mjs (steps that work for any city), ratings/
scripts/             deploy, Google Cloud setup, seed-prices
data/metrics.json    the metric definitions every city shares: label, direction, default weight, the fixed scale, texts with {placeholders}
cities.example/      the demo city and the template for a real one
test/                tests that need no real city
cities/              YOUR cities (not part of the repository; layout below)
```

A city folder:

```
cities/cities.json            the cities switched on, and the default
cities/<id>/city.json         manifest: name, places, bbox, map view, centre, commute presets, modes, texts, splash, pipeline, routing, prices
cities/<id>/metrics.json      the city's own descriptions of its data sources
cities/<id>/seed/ sources/    hand-kept inputs and the source texts shown in the app's Sources dialog
cities/<id>/steps/            scripts that know where this city's data comes from
cities/<id>/test/             optional tests; run with `npm run test:cities`
cities/<id>/raw cache generated runtime/   built or collected: never commit
```

`scripts/data/paths.mjs` (pipeline, scripts, tests) and `server/cities.js` (server) decide which folder is used: `cities/` when its `cities.json` lists a city, otherwise `cities.example/`. The server duplicates the rule on purpose, because the deployed app does not carry `scripts/`: **the server must never import from `scripts/`**.

## Adding a city

Read `ADDING_A_CITY.md` for the details. The path, in short:

1. **Start from the demo.** `cp -r cities.example cities`, then rename `cities/example` to your city's id (lower case, `hamburg`) and edit `cities/cities.json`. The demo steps invent data; yours replace what they read and keep what they write.
2. **Decide what the city has.** Go through `data/metrics.json` and, for each metric, write down the real source. Choose per metric: leave it out (the honest default; the app hides it), stand in for it with another metric (`proxy`), or fill gaps by interpolation (only if you will explain it in the info text). Nothing in the app requires any particular metric.
3. **Write the manifest** (`city.json`), with every field. `cities.example/example/city.json` shows them all.
4. **Write `steps/areas.mjs`:** the named areas and the H3 resolution 9 hex grid. It writes `cache/areas.geo.json`, `cache/cells.base.json` and `generated/areas.json`; the contract is in the template.
5. **Write `steps/zones.mjs`:** the price zones (the area one average rent counts for) and the zone of every hex.
6. **One step per metric** that has no shared step. Shared steps (`scripts/data/metrics/*.mjs`) cover transit from a GTFS feed, centre distance, OpenStreetMap amenities and green space, landmarks, and the Zensus 2022 grid for density, building age and population age (the grid exists for all of Germany). A step ends with `writeMetric(id, { [h3 id]: number }, { unit, note })` and lists itself in `pipeline.steps`.
7. **Describe your sources:** `sources/_shared.json` and `sources/<metric>.json` (name, URL, license, attribution, date accessed, note) and `metrics.json` for the metric texts. Every number in the app must trace to a cited source.
8. **Build and check:** `npm run data -- --all`, then `npm test` and `npm run test:cities`. The spread test (`test/scoring-spread.test.mjs`) runs for every listed city: each metric must spread over its scale (a source with few areas declares `sourceAreas` in the city's `metrics.json`), and the overall score must tell places apart. A failure usually means a wrong unit, a wrong join, or a count where a rate was meant. Fix the step first; if the data is right and the city lies outside the default scales, give the metric a `scale` of the city's own in its `metrics.json`.

Rules that apply to every city:

- **Be honest about gaps.** Missing data shows as missing, is excluded from that hex's score, and the weights renormalise. Never invent a value to fill a hole without saying so in the info text.
- **Scales have a shared default.** Every scored metric has a `scale` in `data/metrics.json`. The app shows one city at a time, so a score says where a place stands within its city, and a city whose data lies in another range sets its own `scale` for that metric in its `metrics.json` (see `ADDING_A_CITY.md`, step 6). Do not change the shared scale for one city: it moves every city and the golden files.
- **Check licenses before you use or publish data.** Open data usually allows reuse with attribution; a portal's listings often do not. The Sources dialog must carry each license and attribution.
- **No secrets in a city folder that will be committed.** Keys and contact addresses live in `.env` (gitignored).
- Steps import shared helpers through the package alias: `import { RAW, writeMetric } from '#data/lib.mjs'`. The alias works because `cities/` sits inside this package's scope, so do not give `cities/` a `package.json`.
- A step named `steps/x.mjs` in the manifest is the city's own (`cities/<id>/steps/x.mjs`); any other name is a shared step in `scripts/data/`.
- Hand-edited files in `sources/` are never overwritten by the pipeline (`writeSources` skips existing files).

## Restaurant ratings

The restaurants metric needs ratings from a service the builder chooses; the repository ships none. `scripts/data/ratings/template.mjs` states the contract (a provider returns the ratings and review counts of the restaurants around a point). Put a provider in `scripts/data/ratings/<name>.mjs` or `cities/ratings/<name>.mjs` (another folder: set `RATINGS_PACK_DIR`), set `RATINGS_PROVIDER` (`<name>` or `pack/<name>`), run `npm run data:ratings`. Read the service's terms first: some forbid storing or showing their data. The run is metered (a monthly request counter) and its results are costly to recreate; do not delete `cities/<id>/cache/ratings/`. Without a provider the metric is simply left out.

## Maintaining the code

**Commands**

```bash
npm run dev                  # server + Vite, http://localhost:8080 (PORT in .env); builds the demo city on first start
npm run build && npm start   # production build
npm test                     # tests that need no real city (they use the demo once it is built)
npm run test:cities          # tests that live with your cities: cities/*/test/*.test.mjs
npm run typecheck
npm run data                 # merge the metric caches of the default city (add -- --city <id>)
npm run data -- --all        # run the city's steps (downloads, slow), then merge
npm run data -- --step name  # run only the steps called name, no merge
```

Run `npm test`, `npm run test:cities` (if you have cities) and `npm run typecheck` before you call a change done. In PowerShell `--` is swallowed by npm; use `npm run deploy:quick` rather than `npm run deploy -- --skip-setup`.

**Golden tests.** The city tests pin generated files by hash and pin the top matches of a few priority sets. After a change to shared pipeline code, rerun `npm run data -- --all` for your cities and compare: the output must stay the same unless the change is meant to alter it. `UPDATE_GOLDEN=1` rewrites goldens written through `matchGolden`; use it only on purpose and read the diff. Some goldens are compared with `deepEqual` and need a hand edit when a shared text changes.

**Where things live, and what not to cross**

- Scoring (`src/scoring.ts`): the overall score is the plain weighted mean of the enabled metrics (missing data skipped, weights renormalised). Only the map colours are stretched. Tests guard the maths.
- Weights and the profile are shared by all cities; commute places, saved spots and notes are kept per city in the browser (`living-in-germany.v1.<id>`). Changing a storage key loses visitors' saved data: migrate it, as `migrateLegacyStorage` does.
- The commute heat field always comes from Transitous (live, cached); single routes may come from a regional service a manifest names, with Transitous as the backup. Only local trains count (S, U, tram, RB, RE): ICE, IC and EC are dropped.
- Rent has no open source: visitors add average rents per zone and the server shares them (a file locally, Firestore on App Engine). The server checks position, value range and a write rate limit; there is no login.
- The browser never sees `.env`. Public settings come from `GET /api/config`; never put a secret there.

**Conventions**

- Match the surrounding code: naming, comment density (sparse, explaining why), idiom. New files follow their neighbours.
- Many files use CRLF line endings; keep a file's endings when you edit it. If an edit must match multi-line text exactly, normalise `\r\n` first, replace, and convert back.
- The UI is English, light theme only, place names in German. Numbers are shown exactly and every one traces to a cited source; the colour ramp is never the only carrier of a value. Keep the design consistent with what is already there.
- Keep documentation current in the same change: `README.md` for visitors, `ADDING_A_CITY.md` when the contract for cities changes, `cities.example/` when a template drifts from it.
- Commit messages are Conventional Commits: `type(scope): imperative summary`, at most 72 characters, a body only when the why is not obvious. One logical change per commit.

**Security and privacy**

- Never commit `.env`, `app.yaml`, keys, tokens or personal addresses. `.env.example` lists every setting without values.
- External services (Transitous, Nominatim, Photon, the basemap) have usage policies; the app sends a contact address in its user agent (`CONTACT_EMAIL`). Respect their rate limits and caching.
- Coordinates of pinned commute places and selected spots are sent to Transitous and, for routes, to the regional service. Do not add analytics or new third parties without a human's decision.

## When to stop and ask a human

- Before anything irreversible or outward-facing: pushing, publishing, deleting data, rewriting history, deploying.
- Before changing a shared scale, a metric's definition, the scoring maths, or a storage key.
- Before adding a data source whose license you cannot read, or data a portal's terms may forbid republishing.
- When a new city's scores do not spread and the cause is not a bug in your step.
- When tests fail for a reason you cannot explain: report the failure and its output; do not skip or weaken the test.
