export interface Metric {
  id: string;
  label: string;
  unit: string;
  better: 'higher' | 'lower';
  decimals: number;
  weight: number;
  hint: string;
  dynamic?: boolean;
  fmt?: 'year';
  /** another metric's score stands in for missing cells of this city */
  proxy?: { city: string; metric: string };
  /** one city-wide value is applied to the whole city */
  cityWide?: string;
  /** plain-language explanation shown behind the info icon */
  info?: string;
  /** shown as a map overlay only, never part of the overall score */
  overlay?: boolean;
  prefix?: string;
  missing?: boolean;
  note?: string;
  /** share of the hexes of each municipality that have a value */
  cover?: Record<string, number>;
  anchors?: { lo: number; hi: number };
}

export interface CellsFile {
  res: number;
  ids: string[];
  area: number[];
  m: Record<string, { raw: (number | null)[]; s: (number | null)[] }>;
}

export interface AreaProps {
  id: string;
  name: string;
  district: string;
  /** the municipality the area belongs to */
  city: string;
  kind: string;
  bzrName?: string;
  c: [number, number];
}

export type AreaFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, AreaProps>;

export type Mode = 'S' | 'U' | 'T' | 'R';

/** [lat, lon, name, modes, lines[]] */
export type Station = [number, number, string, string, string[]];

export interface Source {
  name: string;
  url: string;
  license: string;
  attribution: string;
  accessed: string;
  note?: string;
}
/** A landmark shown as a round photo pin (cities/<id>/generated/pois.json). `u` is a 60 px Commons thumbnail. */
export interface Poi {
  id: string;
  name: string;
  /** 1 = visible zoomed out, 2 = district level, 3 = only zoomed in */
  rank: 1 | 2 | 3;
  lat: number;
  lon: number;
  /** Wikipedia article */
  wiki: string;
  u: string;
  /** size of the original photo, in px */
  w: number;
  h: number;
  /** Commons page of the photo, its author and licence */
  page: string;
  by: string;
  lic: string;
}

/** A freely licensed photo of an area (Wikimedia Commons). */
export interface Photo {
  /** image url, 800 px wide */
  u: string;
  w: number;
  h: number;
  /** Commons page of the file */
  page: string;
  by: string;
  lic: string;
  licUrl: string;
}
export interface SourcesFile {
  shared: Source[];
  metrics: Record<string, Source[]>;
}

export interface CommutePoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** share of the commute weight in percent; all points sum to 100 */
  share: number;
}

export type CleanTag = 'dirty' | 'avg' | 'clean';
export interface AreaNote {
  clean?: CleanTag;
}

/** An average rent per square metre (EUR/m², per month) taken from a source the user trusts. It counts for the whole district. */
export interface PricePoint {
  id: string;
  lat: number;
  lon: number;
  value: number;
}

/** A start spot saved for comparison. */
export interface Bookmark {
  id: string;
  lat: number;
  lon: number;
  /** a station or subdistrict: something people can find on a map */
  name: string;
  sub: string;
}

/** The silhouette of a city: a coarse grid of hexagons, the cells inside the city, and names to write below places (cities/<id>/generated/shape.json). */
export interface CityShape {
  cols: number;
  rows: number;
  cells: [number, number][];
  places: { name: string; x: number; y: number }[];
}

/** What the start screen knows of a city before its data is loaded (GET /api/cities). */
export interface CitySummary {
  id: string;
  name: string;
  /** the city shown when nothing else says which */
  default: boolean;
  municipalities: string[];
  shape: CityShape | null;
  /** the city's own lines for the loading screen, added to the shared ones */
  splash: { quips: string[]; pokes: string[] };
}

/** A commute place offered as a one-click preset. */
export interface CommutePreset {
  name: string;
  lat: number;
  lon: number;
}

/** What the app knows about a city (cities/<id>/city.json, the part the browser may see). */
export interface CityInfo {
  id: string;
  name: string;
  /** the places the scores cover, "Exampleton" and "Sampleburg" */
  municipalities: string[];
  bbox: { w: number; s: number; e: number; n: number };
  map: { center: [number, number]; bounds: [number, number, number, number]; fallbackBox: [number, number, number, number] };
  search: { lat: number; lon: number };
  centre: { name: string; lat: number; lon: number };
  commutePresets: CommutePreset[];
  /** The kinds of line the city has, in the order the app lists them, with the city's own name for each ("U" may be called "Stadtbahn"). A kind that is not here is not offered. */
  modes: Partial<Record<Mode, string>>;
  /** the city's own words for the shared texts, e.g. what its price zones are called */
  texts: Record<string, string>;
  splash?: { quips: string[]; pokes: string[] };
}

export interface PublicConfig {
  basemapStyleUrl: string;
  center: [number, number];
  bounds: [number, number, number, number];
  city: CityInfo;
  /** every city the app offers */
  cities: { id: string; name: string; default: boolean }[];
}
