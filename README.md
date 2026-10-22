# Living in Germany

Full-screen map that scores the neighbourhoods of a city by your priorities and commute places. Click any spot for district, address, per-metric score, nearest stations and line types. Every dataset is listed under Sources in the app.

Highlights: hex heatmap with four colour schemes, top 10 areas, commute places weighted by importance (direct trains win), the best route to each place drawn on the map while a spot is selected, station hover cards listing S/U/tram/regional lines, thick labelled transit lines.

Stack: Vite + vanilla TypeScript, MapLibre GL, deck.gl (H3 hex heat layer), Express. Hosted on Google App Engine standard, runs locally the same way.

**This repository is the app, without any real city.** The cities (their data sources, the scripts that know where to get the data, their texts) live in a `cities/` folder that is not part of the repository. It can be a repository of its own, private if you like; clone it to `cities/` (no submodule needed). Until you do, the app shows **Exampleton**, a demo city from `cities.example/`: invented places, lines and numbers, made offline on the first start, and meant as the template for your own city.

## Run locally

```bash
npm install
cp .env.example .env        # set CONTACT_EMAIL at least
npm run dev                 # http://localhost:8080 : the demo city, made on the first start (a few seconds, no download)
npm test                    # tests: scoring, data pipeline helpers, server, client logic (node:test, no browser needed)
npm run test:cities         # the tests that live with your cities (cities/<id>/test/), if you wrote any
```

AI coding agents: start with [AGENTS.md](AGENTS.md).

For your own city, copy `cities.example/` to `cities/` and replace its steps with ones that read real sources (see [ADDING_A_CITY.md](ADDING_A_CITY.md)), then `npm run data -- --all` downloads and builds it (often 100 MB or more). The demo steps are working code: they write exactly the files a real city does.

`npm run build && npm start` serves the production build.

## Cities

The app is built for several cities. Nothing in the server, the pipeline or the browser code names a city: a city is a folder in `cities/`.

```
cities/cities.json                which cities are switched on, and the default
cities/<id>/city.json             the manifest: name, places it covers, bounding box, map view, search bias,
                                  city centre, commute presets, its own words for the shared texts, rent collection, data pipeline
cities/<id>/metrics.json          the city's own descriptions of its data sources
cities/<id>/seed/ sources/        hand-kept inputs (landmark list, photo picks, starting rents), source descriptions
cities/<id>/steps/                the scripts that know where this city's data comes from (areas, zones, crime or a resident survey, noise ...)
cities/<id>/test/                 tests of the city, run with npm run test:cities
cities/<id>/raw/ cache/ generated/ runtime/    built or collected, never committed
cities/ratings/<name>.mjs         optional restaurant-ratings providers of your own (another folder: RATINGS_PACK_DIR)
```

The browser asks for a city by its address (`/<id>`) and loads `/data/<id>/`. With more than one city, a first visit to the front page shows the start screen ("I'm looking to live in ...", a hexagon silhouette of the selected city, from `generated/shape.json`, which the build writes and `GET /api/cities` serves); a city in the address or one chosen before goes straight to loading, and the Info dialog has "Change city". With one city there is no question; `/?choose` previews the start screen. The loading lines are shared ones plus the city's own (`splash` in its manifest). In the browser, priorities, weights and how the map looks are the visitor's and shared by all cities; commute places, saved spots and area notes are kept per city (`living-in-germany.v1.<id>`). What was saved before there were cities moved to the first city. Every server endpoint that depends on the city takes `?city=<id>` (the default city without it, `400 unknown_city` for one that does not exist), and every pipeline script takes `--city <id>`. The criteria, the weights and the interface are the same for every city; only the data differs. **To add a city, follow [ADDING_A_CITY.md](ADDING_A_CITY.md)** (which files to create, what they must contain, how to build and check it). The pipeline works the same way. `pipeline.steps` in the manifest lists the scripts `npm run data -- --all` runs for the city, in order. Code that is the same for every city lives in `scripts/data/` and `scripts/data/metrics/` (OpenStreetMap metrics, the timetable feed from `pipeline.gtfs`, centre distance, landmarks, photos); code that knows a city's sources (its areas, crime, noise, residential quality, census use, and `pipeline.zones`, which says where one rent counts) lives in `cities/<id>/steps/`, next to the city; its imports of the shared helpers read `#data/lib.mjs`, `#data/zensus.mjs`. A metric the city has no step for is not built, and the app leaves it out.

## Settings

All project settings live in `.env` (gitignored). `.env.example` lists every key. The browser never sees `.env`; it reads public values from `GET /api/config`. `app.yaml` is generated from `.env` and also gitignored.

## Data pipeline

Offline, no database. `npm run data` merges per-metric caches into the city's `generated/` folder (`cities/<id>/generated/`; `-- --city <id>` picks another city). To rebuild everything from the sources:

```bash
npm run data -- --all
```

| Stage | File | Output |
|---|---|---|
| Areas + hex grid (H3 res 9) | `cities/<id>/steps/areas.mjs` | areas, cells |
| Transit | `scripts/data/metrics/transit_*.mjs` | transit access, speed, lines, stations |
| Statistics | `cities/<id>/steps/stat_*.mjs` | safety (or perceived safety from a resident survey), population age, density, residential quality |
| Census grid | `scripts/data/zensus.mjs` (reader), `scripts/data/metrics/zensus_*.mjs` (steps for any city) | density, age of residents and age of buildings from the Zensus 2022 100 m grid, which exists for all of Germany |
| Environment | `cities/<id>/steps/env_*.mjs` (noise, building age), `scripts/data/metrics/env_*.mjs` (green space, amenities) | noise, building age, green space, amenities |
| Tracks | `scripts/data/02-rail-graph.mjs` | OSM track graph (`rail-graph.json`) for route geometry; redraws the map lines from OSM and closes the holes route relations leave (stations, missing ways) |
| Photos | `scripts/data/03-images.mjs` | `images.json`: up to three freely licensed Wikimedia Commons photos per price zone for the spot card (author and licence included). Pick your own per zone in `cities/<id>/seed/image-overrides.json` (`{"<zone id>": ["File name.jpg"]}`, an empty list hides the zone's photos) and rerun; run after `build.mjs` |
| Landmarks | `scripts/data/04-pois.mjs` (`npm run data:pois`) | `pois.json`: round photo pins for famous places (Map tab, "Landmarks"). The list is `cities/<id>/seed/pois.json` (German Wikipedia titles, rank 1-3 decides from which zoom a pin shows; position and lead photo come from the article, author and licence from Commons). Add a place by adding a line and rerunning |
| Restaurants | `scripts/data/05-ratings.mjs` (`npm run data:ratings`), `metrics/env_restaurants.mjs` | OSM restaurants within 600 m times a quality factor: the average rating of the 20 most popular restaurants of the area, from a ratings service **you choose**. The repo ships none: copy `scripts/data/ratings/template.mjs`, fill in the service of your choice (check its terms of use), and name it in `RATINGS_PROVIDER` in `.env` (`pack/<name>` is a file `<name>.mjs` in `cities/ratings/`, or in the folder `RATINGS_PACK_DIR` names). A request counter refuses more than the provider's monthly limit or `RATINGS_MAX_REQUESTS`; `--dry-run` counts first. Only one average per area is kept, not the ratings, and the provider's name, license and attribution go to the Sources list. Without a provider the metric is simply left out. Run `npm run data` afterwards |
| City centre | `scripts/data/metrics/geo_center.mjs` | straight-line distance to the centre of the city (`centre` in the manifest; no download) |
| Merge | `scripts/data/build.mjs` | `cells.json`, `metrics.json`, `sources.json`, `district-borders.json`, `zones.json` |

Metric definitions (label, unit, direction, default weight, the default `scale` that turns a value into 0 to 100 (a city can set its own), the descriptions that are the same everywhere) are in `data/metrics.json`; a city adds its own descriptions of its sources in `cities/<id>/metrics.json`, and the `{placeholders}` of the shared texts (the timetable name, what its price zones are called ...) are filled from `texts` in its `city.json`. A text the city does not define stops the build. Source URLs, licenses and attribution are in `cities/<id>/sources/*.json` and shown in the app. Raw downloads go to `cities/<id>/raw/` (gitignored).

The scale is the same for every city, so a score means the same everywhere and cities can be compared; the build refuses a metric without one. The kinds of line a city has (S, U, T, R) and what it calls them are `modes` in its `city.json`, and which route types of its timetable feed they are is `pipeline.gtfs.routeTypes`.

No open data exists for rent. Visitors add average rents per m² (from a source they trust) by clicking the map; the Profile tab holds the flat size you expect, which turns the per-m² rents into the monthly rent shown on the map (the ranking uses the per-m² price, so it does not depend on the size); a price counts for its whole **price zone**: a district or neighbourhood as the city's zones module defines it, from `cities/<id>/generated/zones.json`. Several reports in one zone are averaged. The Rent Price layer greys out zones that still have no price (with a "needs rent" tag), and rent only counts in the overall score once **every** zone has one. Rents are **shared by all visitors** and stored on the server (see below); they feed the Rent Price score. A cleanliness tag per area stays in your browser, as do commute places, saved spots and weights (export/import in the Map tab).

## Shared rent prices

The server keeps the rents (`/api/prices`, `server/prices.js`). Locally they go to `cities/<id>/runtime/prices.json` (gitignored). On App Engine the disk is per instance, so the default there is **Firestore** (native mode); `npm run deploy:setup` creates the database. `PRICE_STORE`, `PRICE_COLLECTION` and `PRICE_WRITES_PER_MIN` are in `.env.example`. Optional starting values (`cities/<id>/seed/rents.json`, not part of the repo; the format is in [ADDING_A_CITY.md](ADDING_A_CITY.md)) go on the list with `npm run seed:prices`; it skips what is already there. There is no login: anyone can add, change or delete a price. The server only accepts positions inside the city and rents of 2-100 EUR per m², caps the list and limits writes per IP. Put the app behind a login (IAP, say) if that is too open.

## Deploy

```bash
# .env: GCP_PROJECT_ID (required), GAE_REGION, GAE_SERVICE, ...
gcloud auth login           # once
npm run deploy              # sets up the project if needed, builds, writes app.yaml from .env, runs gcloud app deploy
```

`npm run deploy` first runs `scripts/gcp-setup.mjs`, which only changes what is missing: it checks the gcloud login, the project and billing, enables the APIs, creates the App Engine app and the Firestore database, and grants the permissions. `npm run deploy:setup -- --check` lists what it would do and changes nothing; `npm run deploy:quick` skips the setup once the project is ready. `.gcloudignore` uploads only what runs: `server/`, `dist/`, `cities/cities.json`, each city's `city.json` and `generated/` folder, and package files.

## Live services

Basemap OpenFreeMap, address search Photon, reverse lookup Nominatim (max 1 request/s, cached). The commute heat field comes from Transitous (non-commercial use, contact in User-Agent from `CONTACT_EMAIL`): one call per commute place (cached 24 h). Local trains only: S-Bahn, U-Bahn, tram, RB and RE. ICE, IC and EC are excluded because the Deutschlandticket does not cover them (the generic `RAIL` mode of Transitous contains them, so it is not requested).

The route drawn from a selected spot to each commute place (`server/route.js`, providers in `server/routing/`) comes from the timetable service of the city's own region when the manifest names one (`routing.provider`), and from Transitous otherwise or when that service fails or finds no route. The one provider so far is the VBB (`server/routing/vbb.js`, the HAFAS ReST API of the Verkehrsverbund Berlin-Brandenburg), for a city that names `"routing": { "provider": "vbb" }`. Its trips are limited to S-Bahn, U-Bahn, tram and regional trains, and a trip that still contains an ICE or IC is dropped. The VBB service needs an access ID and server address that the VBB issues on request: put them into `VBB_API_URL` and `VBB_ACCESS_ID`. Until both are set the provider stays off and every route comes from Transitous.

When the local service fails (an error, a timeout, a refused key) it is left alone for `ROUTE_COOLDOWN_MIN` minutes and the stand-in answers are cached for 15 minutes, so it is tried again soon; its own answers are cached for 6 h. The spot card says who planned the routes. `ROUTE_SOURCE=transitous` switches the local service off. The server logs at startup which way each city goes. The commute heat field always comes from Transitous. Coordinates of pinned commute places and selected spots are sent to Transitous and, for routes, to the local service.

## Overall score

`src/scoring.ts` (no imports, so it is tested without a browser): the overall score of a hex is the **plain weighted mean** of the enabled metric scores (missing data skipped, weights renormalised). Anyone can recompute it from the weights and the bars in the spot card. Ranked lists show one decimal, so near-ties are not hidden by rounding. Only the **map colours** are stretched (`shadeRange` / `shade`: the 3rd to 99.5th percentile of the city fill the ramp), because means cluster in the middle of 0..100. `npm test` guards the maths on synthetic data and on `cities/<id>/generated/cells.json`.

## Licence

The code is under the [MIT licence](LICENSE). The data is not: it is built from open sources, each with its own licence and attribution (OpenStreetMap is ODbL, the statistics and the timetable feed have their own), listed in `cities/*/sources/*.json` and under Sources in the app. If you publish a build, keep that attribution with it.
