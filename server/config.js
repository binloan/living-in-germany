import 'dotenv/config';

const env = process.env;
const trim = (u) => u.replace(/\/+$/, '');

export const config = {
  port: Number(env.PORT) || 8080,
  contactEmail: env.CONTACT_EMAIL || '',
  rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN) || 120,
  transitousUrl: trim(env.TRANSITOUS_URL || 'https://api.transitous.org'),
  // Where single routes come from (server/routing/): "auto" asks the city's own timetable service first when it has one and is set up,
  // Transitous otherwise; "transitous" never asks the local one. Commute times for the whole map always come from Transitous.
  routeSource: env.ROUTE_SOURCE === 'transitous' ? 'transitous' : 'auto',
  routeCooldownMin: Number(env.ROUTE_COOLDOWN_MIN) || 10, // how long a local service is left alone after a failure
  // VBB (Berlin): the address of its HAFAS ReST server and the access key, both sent by VBB after a request to api@vbb.de
  vbbApiUrl: trim(env.VBB_API_URL || ''),
  vbbAccessId: env.VBB_ACCESS_ID || '',
  photonUrl: trim(env.PHOTON_URL || 'https://photon.komoot.io'),
  nominatimUrl: trim(env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org'),
  // shared rent prices: a JSON file locally, Firestore on App Engine (see server/prices.js)
  priceStore: env.PRICE_STORE || (env.GAE_ENV ? 'firestore' : 'file'),
  priceFile: env.PRICE_FILE || '', // empty: each city keeps its prices in its own data folder
  priceCollection: env.PRICE_COLLECTION || '', // empty: the collection named in the city's manifest
  // a named database: the (default) one of a project is in Datastore mode once App Engine created it
  priceDatabase: env.PRICE_DATABASE || '', // empty: the database named in the city's manifest (prices.database), else "prices"
  priceWritesPerMin: Number(env.PRICE_WRITES_PER_MIN) || 20,
  gcpProject: env.GOOGLE_CLOUD_PROJECT || env.GCP_PROJECT_ID || '',
  userAgent: `berlin-transport/0.1 (${env.CONTACT_EMAIL || 'no-contact-set'})`,
  // What the browser may know, apart from the city it looks at (server/cities.js). Never put secrets here.
  public: {
    basemapStyleUrl: env.BASEMAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron',
  },
};
