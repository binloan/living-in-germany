// A ratings provider tells the pipeline how well rated the restaurants around a point are. Which service you ask is your choice:
// copy this file to scripts/data/ratings/<name>.mjs (or to cities/ratings/<name>.mjs, which is not part of this repository), fill it in and set
// RATINGS_PROVIDER=<name> (or pack/<name>) in .env. Check the terms of the service you pick: some forbid storing or showing their data.
// Then run `npm run data:ratings` and `npm run data`. Without a provider the restaurants metric is simply left out.

/** Where the ratings come from. Shown in the app's Sources list, so keep it true: name, license and attribution are the service's own. */
export const source = {
  name: 'Name of the service',
  url: 'https://example.org/api-docs',
  license: 'Terms of use or license of the data',
  attribution: 'Text the service wants shown, if any',
  note: 'Average rating of the most popular restaurants of each area, fetched once.',
};

/** Optional. The most requests per calendar month; the runner counts them and refuses to go beyond. RATINGS_MAX_REQUESTS overrides it. */
// export const maxRequestsPerMonth = 900;

/** Optional. Return a message when the provider cannot run yet (a missing key, say), else null. */
// export const notReady = () => (process.env.MY_KEY ? null : 'MY_KEY missing in .env');

/**
 * Ratings of up to 20 restaurants around a point, the most popular first. `rating` is 1 to 5 (null when unrated), `reviews` how many
 * people rated. One call per area; the runner shrinks the ratings towards 4.0 for places with few reviews and keeps one average per area.
 * @param {{ lat: number, lon: number, radius: number }} where radius in metres
 * @returns {Promise<{ rating: number | null, reviews: number }[]>}
 */
export async function ratingsNear({ lat, lon, radius }) {
  throw new Error(`not implemented (${lat}, ${lon}, ${radius})`);
}
