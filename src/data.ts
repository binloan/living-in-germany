import { inkOn } from './util';
import type { AreaFeature, CityInfo, Mode, CellsFile, Metric, Photo, Poi, PublicConfig, SourcesFile, Station } from './types';

export interface Dataset {
  config: PublicConfig;
  city: CityInfo;
  cells: CellsFile;
  metrics: Metric[];
  areas: { type: 'FeatureCollection'; features: AreaFeature[] };
  districts: { name: string; c: [number, number] }[];
  lines: GeoJSON.FeatureCollection<GeoJSON.Geometry, { mode: string; name: string; color: string; ink: string }>;
  districtBorders: GeoJSON.FeatureCollection;
  /** one outline per district, property `name` */
  districtOutlines: GeoJSON.FeatureCollection;
  /** price zones, and the zone of every hex */
  zones: { id: string; name: string; city: string; district: string; c: [number, number]; exempt?: boolean }[];
  cellZone: Uint16Array;
  /** photos per price zone id, empty until the city's images.json exists */
  images: Record<string, Photo[]>;
  /** landmarks for orientation, empty until the city's pois.json exists */
  pois: Poi[];
  /** union of everything that is scored, null when the data file is missing */
  outline: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  stations: Station[];
  sources: SourcesFile;
  cellIndex: Map<string, number>;
  /** line name -> official colour */
  lineColor: Map<string, string>;
  /** line name -> transit type */
  lineMode: Map<string, Mode>;
}

async function getJson<T>(url: string, optional = false): Promise<T | null> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    if (optional) return null;
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  return res.json();
}

/** The settings and the city's definition. A city the server does not know (or none) gives the default city. */
async function loadConfig(cityId: string | null): Promise<PublicConfig> {
  if (cityId) {
    const res = await fetch(`/api/config?city=${encodeURIComponent(cityId)}`, { cache: 'no-cache' });
    if (res.ok) return res.json();
  }
  return (await getJson<PublicConfig>('/api/config'))!;
}

/** Loads one city: `cityId` is the id from the address (`/berlin`), null for the default city. */
export async function loadDataset(cityId: string | null, onProgress?: (done: number, total: number, what: string) => void): Promise<Dataset> {
  let done = 0;
  const total = 14;
  const config = await loadConfig(cityId);
  onProgress?.(++done, total, 'settings');
  const base = `/data/${config.city.id}`;
  const get = <T>(file: string, what: string, optional = false) => getJson<T>(`${base}/${file}`, optional).then((r) => { onProgress?.(++done, total, what); return r; });
  const [cells, metrics, areas, districts, lines, stationsFile, sources, districtBorders, outline, zonesFile, images, districtOutlines, pois] = await Promise.all([
    get<CellsFile>('cells.json', 'hex grid'),
    get<Metric[]>('metrics.json', 'metrics'),
    get<Dataset['areas']>('areas.json', 'neighbourhoods'),
    get<Dataset['districts']>('districts.json', 'districts'),
    get<Dataset['lines']>('transit-lines.json', 'transit lines', true),
    get<{ stops: Station[] }>('stations.json', 'stations', true),
    get<SourcesFile>('sources.json', 'sources'),
    get<GeoJSON.FeatureCollection>('district-borders.json', 'borders', true),
    get<Dataset['outline']>('outline.json', 'outline', true),
    get<{ zones: Dataset['zones']; cell: number[] }>('zones.json', 'price zones'),
    get<Dataset['images']>('images.json', 'photos', true),
    get<GeoJSON.FeatureCollection>('district-outlines.json', 'district outlines', true),
    get<Poi[]>('pois.json', 'landmarks', true),
  ]);
  const ds: Dataset = {
    config,
    city: config.city,
    cells: cells!,
    metrics: metrics!.filter((m) => !m.missing), // a metric whose data has not been built yet (e.g. restaurants before `npm run data:ratings`) stays out of the UI
    areas: areas!,
    districts: districts!,
    lines: lines ?? { type: 'FeatureCollection', features: [] },
    stations: stationsFile?.stops ?? [],
    sources: sources!,
    districtBorders: districtBorders ?? { type: 'FeatureCollection', features: [] },
    districtOutlines: districtOutlines ?? { type: 'FeatureCollection', features: [] },
    outline: outline ?? null,
    zones: zonesFile!.zones,
    cellZone: Uint16Array.from(zonesFile!.cell),
    images: images ?? {},
    pois: pois ?? [],
    cellIndex: new Map(cells!.ids.map((id, i) => [id, i])),
    lineColor: new Map(),
    lineMode: new Map(),
  };
  for (const f of ds.lines.features) {
    f.properties.ink = inkOn(f.properties.color);
    ds.lineColor.set(f.properties.name, f.properties.color);
    ds.lineMode.set(f.properties.name, f.properties.mode as Mode);
  }
  return ds;
}
