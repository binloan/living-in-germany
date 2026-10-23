# Adding a city

A city is a folder of data plus a few small scripts that know where that city's data comes from. The server, the browser app and the shared pipeline code need no changes for it. The repository holds no real city: the cities live in a `cities/` folder of their own (a repository of its own, private if you like, cloned there; no submodule), and `cities.example/` is the template: a demo city, Exampleton, whose places, lines and numbers are invented by its steps (`npm run dev` shows it). Start with `cp -r cities.example cities`, then replace the invented steps with ones that read real data. Once `cities/cities.json` lists a city, the demo steps aside. The text below was written while building the first city, which stays outside this repository; Exampleton and Sampleburg stand in for its two places. Cities after the first showed gaps that are now options (buses and ferries in transit access, a route type split by line name, leaving empty hexes out of density, a survey source with few areas, a scale of the city's own); section 6 lists the limits that remain.

Read the "Cities" section of the [README](README.md) first for how the pieces fit together.

## 1. What you touch

| | File or folder | What for |
|---|---|---|
| **Create** | `cities/<id>/city.json` | The manifest: name, places, map, centre, presets, texts, pipeline |
| **Create** | `cities/<id>/metrics.json` | The city's own descriptions of its data sources (optional per metric) |
| **Create** | `cities/<id>/seed/` | Hand-kept inputs: landmark list, starting rents, photo picks (all optional) |
| **Create** | `cities/<id>/sources/` | Source descriptions shown in the app (a first draft is written by the steps, then you edit it) |
| **Create** | `cities/<id>/steps/areas.mjs` | Step: the city's areas and the hexagon grid |
| **Create** | `cities/<id>/steps/zones.mjs` | Where one average rent counts (price zones) |
| **Create** | `cities/<id>/steps/*.mjs` | One step per metric that has no shared step (safety, noise, and so on) |
| **Edit** | `cities/cities.json` | Add the id to `cities` (this switches the city on) |
| **Edit, optional** | `package.json` | A `data:areas` shortcut for the new areas step |
| **Generated, never committed** | `cities/<id>/raw`, `cache`, `generated`, `runtime` | Downloads, step results, what the app loads, local rent prices |
| **Never touch** | `server/`, `src/`, `scripts/data/*.mjs`, `scripts/data/metrics/*.mjs`, `data/metrics.json` | Shared for every city (see section 6 for the few exceptions) |

`<id>` is a short lower-case word, `hamburg`. It is the folder name, the address (`/hamburg`) and the `?city=` value.

## 2. Step by step

### Step 1. Decide what the city has

Before writing anything, go through the metrics in `data/metrics.json` and write down, for the new city, where each one comes from:

| Metric | Shared step (nothing to write) | Needs a city step |
|---|---|---|
| `transit_access` | `metrics/transit_run.mjs`, from the city's GTFS feed (also writes the line map and stations) | |
| `commute` | Live from Transitous, covers Germany. Nothing to build | |
| `price` | The shared rent list. Nothing to build; optional starting rents in `seed/rents.json` | |
| `center` | `metrics/geo_center.mjs`, from `centre` in the manifest | |
| `amenities` | `metrics/env_amenities.mjs` (OpenStreetMap) | |
| `green` (map overlay) | `metrics/env_green.mjs` (OpenStreetMap) | |
| `landmarks` | `metrics/geo_landmarks.mjs`, after `04-pois.mjs` and a `seed/pois.json` | |
| `restaurants` | `metrics/env_restaurants.mjs`, after `05-ratings.mjs` (needs a ratings provider of your choice, see `scripts/data/ratings/template.mjs`) | |
| `safety` | | Police statistics of that city |
| `perceived_safety` | | Optional. How safe residents say they feel, from a representative city survey, as a percentage. A city that publishes no police figures below city level can still have it. It is a different thing from `safety`: never fill one from the other. The cells of a survey district share its value, so say so in the metric text |
| `calm` | | The noise map of that state |
| `building_age`, `density`, `pop_age` (overlay) | `metrics/zensus_building_age.mjs`, `zensus_density.mjs`, `zensus_pop_age.mjs`: the Zensus 2022 100 m grid, the same method for all of Germany (2022 census, coarser building classes, no filling of gaps) | Only if the city publishes something better. A state may publish its own (an environment atlas, a residents' register); use the grid for Potsdam only; its steps are in `cities/berlin/steps/` and read the grid through `scripts/data/zensus.mjs` |
| `wohnlage` | | Only if the city publishes a comparable residential-quality index |

For each metric that has no good source, choose one of three, and write it in the manifest or the metric file as described in step 6:

1. **Leave it out.** Do not add a step. The metric is not built and the app does not show it. This is the honest default.
2. **Stand in for it.** A `proxy` in `cities/<id>/metrics.json` lets another metric's score fill the hexagons that have no value (a smaller place next to the main city can take the main city's score). The info text must say so.
3. **Fill the gaps.** Interpolation inside a step (a smaller place's age can be filled this way). Only if you are willing to explain it in the info text and the source description.

Nothing in the app requires a particular metric. The overall score uses whatever the city has, and weights are renormalised.

### Step 2. Create the manifest

`cities/<id>/city.json`. `cities.example/example/city.json` shows every field. Each one:

| Field | Meaning |
|---|---|
| `id` | Same as the folder name |
| `name` | Shown in "Living in …" and in the start screen |
| `municipalities` | The places the scores cover, main city first: `["Hamburg"]`, or `["Exampleton", "Sampleburg"]`. These must be the values of `properties.city` your areas step writes. The first is the main city; the others get a label on the start screen shape. Used for the coverage table, `only` and `proxy.city` |
| `bbox` | `{ w, s, e, n }` in degrees. The server refuses lookups and rent prices outside it, Photon search is limited to it, and the pipeline uses it for landmarks and the rail graph. Make it a little larger than the city |
| `map.center`, `map.bounds`, `map.fallbackBox` | Start view, the box the map cannot be panned far beyond, and the box to fit when the outline is missing. `[lon, lat]` and `[w, s, e, n]` |
| `search` | `{ lat, lon }` that address search is biased to |
| `centre` | `{ name, lat, lon }` of the city centre, for the `center` metric (distance to it) |
| `commutePresets` | `[{ name, lat, lon }]` offered as one-click commute places, usually the main stations and the airport. Put each at the station itself, not at a landmark's reference point: an airport's own coordinates can be a kilometre from its station, too far to walk to, and the whole city then comes out unreachable. A preset may lie outside `bbox` (an airport beyond the city limits matters for where to live): the server accepts commute and route requests at its position, and nowhere else outside the box |
| `modes` | The kinds of line the city has, in the order the app lists them, with the city's own name for each: `{ "S": "S-Bahn", "U": "U-Bahn", "T": "Tram", "R": "Regional" }`. The four letters are fixed (S suburban rail, U underground, T tram, R regional rail); the names are free (`"U": "Stadtbahn"`). Leave a kind out when the city has none: its line switch and legend entry disappear |
| `texts` | The city's words for the shared descriptions: `timetable`, `modeList` (the kinds of line as a phrase, "S-Bahn, U-Bahn, tram and regional"), `centreWhere`, `centrePlace`, `centreExtra`, `zoneKinds`, `zoneNames`, `rentGaps`. Use `""` for `centreExtra` and `rentGaps` when there is nothing to say; a text that is missing stops the build |
| `splash` | `{ quips, pokes }`: the city's own funny lines for the loading screen, added to the shared ones. May be empty lists |
| `routing.provider` | Optional. The timetable service of the city's own region, asked for routes before Transitous: `"vbb"` for the Berlin-Brandenburg region. Leave it out and Transitous plans every route. To add a provider, write `server/routing/<name>.js` (it exports `{ id, name, configured(), plan(from, to, city) }`, copy `vbb.js`) and register it in `server/routing/index.js`. A provider must leave out long-distance trains and answer with `null` when it finds no route. Server side only, the browser never sees it |
| `pipeline.densityOmitEmpty` | Optional, `true` leaves the hexes without residents out of `density`, where the default gives them a perfect score. Use it for a city with a lot of forest, water or airport (more than 45 % of the hexes scoring 100 fails the spread test) |
| `pipeline.steps` | The scripts `npm run data -- --all` runs, in order, as paths relative to `scripts/data/` |
| `pipeline.zones` | The zone module, `cities/<id>/zones.mjs` |
| `pipeline.gtfs` | `{ url, dir, bbox, routeTypes }`: the timetable feed, the folder under `raw/` for it, the box inside which stops are kept (`{ w, s, e, n }`), and which `route_type` codes of the feed are which kind of line: `{ "S": [109], "U": [400], "T": [900], "R": [[100, 199]] }`. A code, or `[from, to]` for a range, or `{ "code": 2, "name": "^S\d+$" }` for a code that counts only for routes whose short name matches (a feed that gives S-Bahn and regional trains one code: list `S` with the name pattern before `R` with the plain code); the first kind that matches wins. Look at the `routes.txt` of the feed: standard GTFS uses 0 tram, 1 subway, 2 rail, the extended codes 100 to 199 rail, 400 to 405 urban rail, 900 to 906 tram. A kind without codes is simply not drawn. Optional `stationMergeM` (default 150): stops of the same name closer than this many metres are one station; raise it where the platforms of one interchange lie further apart. Optional `accessRouteTypes`, same shape, with the kinds `B` (bus) and `F` (ferry), e.g. `{ "B": [3, [700, 799]], "F": [1200] }`: they count towards `transit_access` (weight 0.5 per departure, against 1.5 for S and U; they earn no mode bonus) but are not drawn and not listed as stations. Use it where buses and ferries are part of the city's everyday network and the fare product you score for covers them; leave it out and only rail counts. A city that uses it must also describe the metric in its own `metrics.json` (`transit_access.info`), since the shared text says buses are not counted |
| `prices.collection` | The Firestore collection of the city's rent prices. Must be unique within a database |
| `prices.database` | Optional. The named Firestore database (Native mode) that holds them, created by `npm run deploy:setup`; `"prices"` when left out. Cities may share one |

### Step 3. Switch it on, or not yet

Add `"<id>"` to `cities` in `cities/cities.json`. Do this when the data exists: a listed city appears on the start screen and `npm run deploy` insists on its data. The pipeline scripts take `--city <id>` for any folder, listed or not, so you can build first and list last. `default` stays Berlin unless you change it.

### Step 4. Write the areas step

`cities/<id>/steps/areas.mjs`. The template is `cities.example/example/steps/areas.mjs`, which invents a grid of areas; yours downloads the boundaries, builds one feature per area and makes the hexagon grid (the part from `polygonToCells` on stays as it is). It must write two files in `cache/` and one in `generated/` (all three through `lib.mjs`: `CACHE`, `GEN`):

- `cache/areas.geo.json`: a GeoJSON FeatureCollection with the full-precision polygons. The properties of each feature:
  - `id` (unique, starts with a letter, for example `H0101`), `name` (the bold name of a spot), `kind` (`"Stadtteil"`, `"Planungsraum"` …),
  - `district`: the next level up (a Bezirk, a borough). Districts get their own outlines and borders and are shown in the lists. Every area needs one,
  - `city`: the municipality, one of `municipalities` in the manifest,
  - optional `bzrId` / `bzrName`: a level between area and district. If set, `bzrName` becomes the bold name of a spot and the area name the small line under it.
- `cache/cells.base.json`: `{ res: 9, ids, lat, lon, area }`, the H3 resolution 9 cells whose centre lies inside an area. `area[i]` is the index of the area of cell `i` in `areas.geo.json`.
- `generated/areas.json`: the same areas, simplified (a real step uses `turf.simplify` with tolerance 0.0002 and 5 decimals).

### Step 5. Write the zones module and the rent seed

`cities/<id>/steps/zones.mjs` exports two things (the template is `cities.example/example/steps/zones.mjs`):

```js
export const seedKey = (zone) => string            // how seed/rents.json names a zone
export function assignZones({ areas, cells }) {    // areas = generated/areas.json, cells = cache/cells.base.json
  return { zones, cellZone };                      // zones: [{ id, name, city, district }]
}                                                  // cellZone[i]: index into zones, or -1
```

A price zone is the area one average rent counts for: where rents are published per Ortsteil, a zone is an Ortsteil, not a planning area. If a city publishes rents per Stadtteil, the zones can simply be the areas. Cells you return `-1` for get the zone most of their area has. The build adds each zone's representative point and hexagon count.

`seed/rents.json` is optional starting rents:

```json
{ "source": { "name": "…", "url": "…" }, "unit": "EUR per m² and month",
  "zones": [ { "zone": "<seedKey>", "value": 13.92, "approx": "why this is not the zone's own figure" } ],
  "noData": { "<seedKey>": "why no rent exists here" } }
```

Rent is scored in the browser on its own scale: 100 points at the cheap end, 0 at the expensive end, in euros per m². The shared default is 10 to 25. A city whose rents lie elsewhere sets `"price": { "scale": [cheap, expensive] }` in its `metrics.json`, so that its zones fill the scale (about the cheapest and the dearest zone, rounded); otherwise the whole city sits at one end and the rent layer is one colour. The rent text quotes the scale in use.

A zone under `noData` does not hold back the rent score; `approx` is only a note. `npm run seed:prices -- --city <id> --url https://<your-app>` puts them on the shared list.

### Step 6. The metrics

For each metric you build yourself, write `cities/<id>/steps/<name>.mjs` and add it to `pipeline.steps`. A step ends by calling `writeMetric(id, raw, meta)` from `scripts/data/lib.mjs`:

- `id` is the metric id from `data/metrics.json`,
- `raw` maps **H3 cell id → number** for the cells that have a value. Leave cells out that have none,
- `meta` is `{ unit, note }`, free-form.

The build turns `raw` into a 0 to 100 score by `better` (higher or lower), `transform` and the fixed `scale` `[worst, best-or-top]` of the metric in `data/metrics.json`. The scale is the default of the metric in `data/metrics.json` (taken from Berlin's spread); values beyond it count as 0 or 100. A metric without a scale stops the build. The app shows one city at a time, so a score says where a place stands within its city. If your city's values do not fit (all of them pile up at 0 or 100), first suspect the source or the unit; if the data is right, give the city its own scale for that metric in its `metrics.json` (below). Do not change the shared scale for one city: it moves every city. A step should also write its source description with `writeSources('<metric>.json', …)` (the file is only written if it does not exist, so your hand edits survive).

Then describe the metric for this city in `cities/<id>/metrics.json`, keyed by metric id. Any field of the shared definition can be overridden. The usual ones:

```json
{ "safety": { "info": "How this city's numbers are made, in plain language.", "cityWide": "Sampleburg" },
  "calm":   { "info": "…", "note": "…", "only": "Exampleton", "proxy": { "city": "Sampleburg", "metric": "density" } } }
```

- `info`: the text behind the (i) button; a metric without one shows its short `hint`.
- `only`: the metric exists for this municipality only; other places get no value.
- `proxy`: `{ city, metric }`, the stand-in described in step 1.
- `sourceAreas`: how many areas the source publishes (a survey with 13 districts). The scoring-spread test then asks for three quarters of that many different scores (at most 15) instead of 15. Say in `info` that every hex of an area shows its value.
- `scale`: `[from, to]` in the unit of the metric, used instead of the shared scale for this city only (same order as the shared one: look at the metric in `data/metrics.json`). Use it when the data is right but lies in another range than the shared scale, for example a city far safer than the one the shared scale was drawn from. Take it from the city's own spread the way the shared one was made (about the 5th to the 95th percentile of the cell values, rounded) and say in the metric's source description how it was chosen. A score then says where a place stands within its city; it is not a comparison with another city.
- `cityWide`: names a place for which the step gives one value to the whole place (Sampleburg's crime figure, say). The app only uses it to say so in the priority's note; the step itself has to produce that value.

Shared texts in `data/metrics.json` contain `{placeholders}` that come from `texts` in the manifest. You do not edit that file.

### Step 7. Run the pipeline

```bash
npm run data -- --all --city <id>      # areas, transit, rail graph, all metric steps, then the merge
npm run data:pois -- --city <id>       # landmark pins (needs seed/pois.json); after the merge
npm run data:images -- --city <id>     # photos per price zone; after the merge
npm run data:ratings -- --city <id>    # optional: restaurant ratings (RATINGS_PROVIDER in .env)
npm run data -- --all --city <id>      # again, so the landmark and restaurant steps find their input
```

Photos and landmarks need the zone list the first merge writes, which is why they run after it. The landmark and restaurant steps skip themselves on the first run (their input does not exist yet) and are done by the second `--all`. Raw downloads are cached in `raw/`, so a rerun is fast. Check what ran in the log: a step that cannot find its input prints a warning and the metric is left out.

### Step 8. Check it

1. `npm run typecheck` and `npm test`. The test "every city has the texts the shared descriptions ask for" covers the manifest and metric files of every listed city. `npm run test:cities` runs the tests you keep with your cities (`cities/<id>/test/`).
2. `GET /api/cities` lists the city with a `shape`. Open `/?choose` to see the start screen with it.
3. Open `/<id>`: the map fits the city, the top 10 fills in, spot cards show a district, photos and scores, commute places load (Transitous covers all of Germany) and a route is drawn along the tracks.
4. The Info dialog's coverage table shows what each place has. Check each priority's (i) text.
5. Check a phone (the sheets, the photo viewer) and look for a metric whose scores all look the same (usually a unit or a join that went wrong).
6. **Check that the scores work in this city.** Do not skip this. Every metric is scored against a `scale`: the default in `data/metrics.json`, taken from Berlin's spread, or the city's own (step 6). A city whose values lie well outside the scale in use would pile up at 0 or 100 for that metric and stop telling its places apart. Nothing else warns you, so check it on purpose:
   - Read the merge log (`npm run data -- --city <id>`). Per metric it prints the scale, the share of cells that score 0 and 100, and the coverage per place. A share of more than about half the cells at 0 or at 100 (landmarks excepted: most places have no landmark) is a finding.
   - Run `npm test`. `test/scoring-spread.test.mjs` runs for every listed city with generated data: each metric must keep a spread (standard deviation above 12, at least 15 different scores, under 55 % at 0 and under 45 % at 100) and the overall score must tell places apart (all priorities and a few; no ties in the top 10). If the city has a rent seed, the zones must also use the rent scale (the middle 90 % span over 40 points and come near both ends of it).
   - Open the app on the city, switch on one priority at a time, and look at the heat layer. A map that is one colour (or two) for a priority is a failed check.
   - If it fails, find out why first. Wrong unit, wrong join or a value that is a count instead of a rate are the usual causes: fix the step. If the data is right and the city is simply outside the default range, give that metric a scale of the city's own in its `metrics.json` (step 6). Do not change the shared `scale`: it moves the scores of every city, golden files included (see `test/golden/` and `UPDATE_GOLDEN`). Or leave the metric out for this city (step 1).
   - Write the outcome down (a line in the commit or in this guide's section 6) so the next city starts from it.

Consider adding golden tests for the new city in `cities/<id>/test/` (they run with `npm run test:cities`; `test/helpers/paths.mjs` finds the city and its generated files): hash the generated files and pin the top 10 of a few weight sets, so a later pipeline change shows up.

### Step 9. Deploy

`npm run deploy` builds and uploads `cities/cities.json` and each listed city's `city.json` and `generated/` (`.gcloudignore` is an allowlist for `cities/`: everything else stays out of the upload) and stops if a listed city has no `generated/cells.json`. Rents of the new city go to the Firestore collection named in its manifest, in the same database as the other cities, so give it its own collection name. `PRICE_FILE` and `PRICE_COLLECTION` in `.env` belong to the default city only; other cities use `cities/<id>/runtime/prices.json` locally. After the first deploy: `npm run seed:prices -- --city <id> --url https://<your-app>.appspot.com`.

## 3. Where things go: the contract in one picture

```
cities/cities.json                       ← add the id
cities/<id>/
  city.json                            ← manifest (step 2)
  metrics.json                         ← descriptions (step 6)
  seed/  rents.json  pois.json  image-overrides.json   ← rents.json is optional (see rents.example.json)
  sources/  <metric>.json              ← written once by the steps, then yours
  steps/  areas.mjs  zones.mjs  <metric steps>.mjs   ← import the shared helpers as '#data/lib.mjs'
  test/                                ← optional, npm run test:cities
  raw/ cache/ generated/ runtime/      ← built; list them in the .gitignore of your cities repository
```

The browser asks `GET /api/cities` for the list and the silhouettes, then `GET /api/config?city=<id>` and `/data/<id>/…`. Nothing in `src/` or `server/` lists a city.

## 4. Pitfalls we know from the first city

- Area ids must be unique across the whole city and the zone ids too; both end up in the browser.
- `municipalities` must match the `city` values exactly, including case; a mismatch shows as 0 % coverage.
- The pipeline builds the hexagon grid at H3 resolution 9 (`H3_RES` in `scripts/data/lib.mjs`, about 350 m across). The metric radii and the "about 350 m" in the Info dialog assume it; the browser and server read the resolution from the data.
- A step that rewrites `sources/*.json` would put its first draft over your edits; use `writeSources`.
- The timetable step reads any GTFS feed: the ZIP is unpacked by its central directory (feeds with entries over 4 GB work), `stop_times.txt` columns are found by name (quoted fields are fine), and a feed without `shapes.txt`, or with one that holds only its header line, gets one straight line per stop sequence, which `02-rail-graph` replaces by the path along the OSM tracks through those stops (a feed with shapes keeps its shapes, and the lines are redrawn from the OSM route relations). The tracks are fetched for the whole timetable box (`pipeline.gtfs.bbox`), a stop pair that OSM has no connecting track for is joined by a short straight connector (under 1.5 km) or left open, and a station marker within 200 m of one of its lines moves onto it. A parent station whose position lies more than 100 m from its platforms is replaced by the platforms' mean. A nationwide feed is large (the gtfs.de feed is 295 MB and unpacks to 2.3 GB) and holds only a few weeks of service days; rebuild it shortly before a deploy.
- Running the whole pipeline reproduces the results exactly (the first city's outputs were checked that way). After changing a shared script, rerun `--all` for your cities and compare the hashes in their golden tests.

## 5. Checklist

- [ ] Metric sources written down; leave out, stand in, or fill decided for each
- [ ] `cities/<id>/city.json` with every field, including `modes`, `texts.modeList` and `pipeline.gtfs.routeTypes` (open `routes.txt` of the feed and see which codes it uses)
- [ ] `areas.mjs` and `zones.mjs`, `seedKey` agrees with `seed/rents.json`
- [ ] Metric steps in `pipeline.steps`; each ends in `writeMetric` (and `writeSources`)
- [ ] `cities/<id>/metrics.json` for every metric that is about this city's sources
- [ ] `npm run data -- --all --city <id>`, then pois, images, (ratings), merge again
- [ ] **Scores work in this city** (step 8, point 6): merge log shares at 0 and 100 are sane, `scoring-spread` test passes for the city, one-priority heat maps are not one colour. Not done until this is ticked
- [ ] `cities/cities.json` lists the id
- [ ] `npm run typecheck`, `npm test`, `/api/cities`, `/<id>`, `/?choose`, phone check
- [ ] Deploy and seed rents

## 6. Known limits (these need a decision or code when the new city differs)

- **Default scales come from Berlin's spread.** The `scale` of each metric in `data/metrics.json` is Berlin's own spread (its 5th to 95th percentile, rounded). A city far outside Berlin's range (for example much lower crime or much older buildings) would sit at 0 or 100 for that metric and lose its differentiation, so it sets its own `scale` for that metric in its `metrics.json` (step 6); the other cities are not affected. Rent has a scale too (`price`, in euros per m²). Cities checked so far needed per-city options, listed in the intro. **Every new city must pass step 8, point 6, before it is switched on.** Adjust a shared scale only on purpose: it moves every city, so the golden tests will say so.
- **Colours of the kinds of line** (S green, U blue, T red, R grey) are fixed in `src/map.ts`; only the names are the city's. The lines keep the colour of their feed. Where the feed gives every line of a kind the same colour, or black or white (read as no colour), a line takes the `colour` of its OSM route relation when it has one, so U1 and U2 are not both "the U-Bahn blue". Regional trains keep one colour. A bare route that is no numbered line (a shuttle named only "U") is left out with a `{ "code": 1, "name": "^U\\d+$" }` entry in `routeTypes`.
- **Distance to the centre** uses one fixed scale (100 within 3 km, 0 from 16 km), meant for a city of Berlin's size. A very large city would score most of itself 0, and a small city never reaches the low end of the scale.
- **Loading screen shape** comes from the outline of the scored area; a city that is very tall and narrow gets a coarse hexagon grid.
