# The demo city

**Exampleton** and **Sampleburg** do not exist. The areas, lines, stops and scores are invented by the scripts in `example/steps/` (offline, a few seconds); the map under them and the address search are real. This is what the app shows while there is no `cities/` folder of your own, and the template for one:

```bash
cp -r cities.example cities     # then edit cities/cities.json and cities/example/
```

Once `cities/cities.json` lists a city, the demo is not used any more. Layout:

```
cities/cities.json            which cities are switched on, and the default
cities/<id>/city.json         the manifest
cities/<id>/metrics.json      the city's own descriptions of its data sources
cities/<id>/seed/ sources/    hand-kept inputs and the source descriptions shown in the app
cities/<id>/steps/            the scripts that know where this city's data comes from
cities/<id>/test/             optional tests of your city (npm run test:cities)
cities/ratings/<name>.mjs     optional restaurant-ratings providers (RATINGS_PROVIDER=pack/<name>; another folder: RATINGS_PACK_DIR)
```

In `example/steps/`: `areas.mjs` (areas and hex grid), `zones.mjs` (price zones), `transit.mjs` (lines and stops), `metrics.mjs` (one number per hex and metric). They write the files a real city's steps write; replace what they read, keep what they write. `_synthetic.mjs` holds the invented geography and is not needed once the data is real.

`raw/ cache/ generated/ runtime/` appear next to them when you run the pipeline; add them to the `.gitignore` of your cities repository.
