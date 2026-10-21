import type { AreaNote, Bookmark, CommutePoint, Mode, PricePoint } from './types';
import { setScheme } from './ramp';
import { STORAGE, storageGet, storageSet } from './util';

export interface Persisted {
  weights: Record<string, number>;
  enabled: Record<string, boolean>;
  heat: string; // 'fit' or metric id
  heatOn: boolean;
  panelCollapsed: boolean;
  scheme: string;
  heatOpacity: number;
  minScore: number;
  lines: Record<Mode, boolean>;
  showAreaNames: boolean;
  showNotes: boolean;
  showDistricts: boolean;
  showPrices: boolean;
  showPois: boolean;
  /** expected size of the flat in m²: turns the reported EUR/m² into a monthly rent */
  flatSize: number;
  commute: CommutePoint[];
  bookmarks: Bookmark[];
  notes: Record<string, AreaNote>;
}

export type PaneId = 'priorities' | 'matches' | 'compare';

export interface Selection {
  lat: number;
  lon: number;
}

export interface StationFocus {
  name: string;
  lines: string[];
}

export interface Transient {
  /** a clicked station: heat hidden, only its lines stay lit */
  focus: StationFocus | null;
  pane: PaneId | null;
  /** the Layers panel (popover on desktop, sheet on a phone) is open */
  layers: boolean;
  selection: Selection | null;
  sourcesOpen: boolean;
  /** desktop: the compare view across the bottom is open (the side panel keeps its own tab) */
  dock: boolean;
  /** shared rents from the server, not stored in this browser */
  prices: PricePoint[];
}

type Key = keyof Persisted | keyof Transient;
type Listener = (changed: Set<Key>) => void;

const KEY = `${STORAGE}.v1`;

/**
 * What belongs to one city and is stored per city: commute places, saved spots and area notes. Everything else (priorities and
 * weights, how the map looks, the flat size) is about the visitor and is shared by all cities.
 */
type Own = Pick<Persisted, 'commute' | 'bookmarks' | 'notes'>;
const ownKey = (cityId: string) => `${KEY}.${cityId}`;

function readOwn(cityId: string): Own | null {
  try {
    const raw = localStorage.getItem(ownKey(cityId));
    if (!raw) return null;
    const j = JSON.parse(raw);
    return { commute: Array.isArray(j.commute) ? j.commute : [], bookmarks: Array.isArray(j.bookmarks) ? j.bookmarks : [], notes: j.notes && typeof j.notes === 'object' ? j.notes : {} };
  } catch { return null; }
}

/** Before there were cities these were kept with the other settings. They were about the one city there was, the first one. */
function moveLegacyToFirstCity(shared: Persisted, firstCityId: string) {
  const has = shared.commute?.length || shared.bookmarks?.length || Object.keys(shared.notes ?? {}).length;
  if (!has || readOwn(firstCityId)) return;
  storageSet(ownKey(firstCityId), { commute: shared.commute ?? [], bookmarks: shared.bookmarks ?? [], notes: shared.notes ?? {} });
}

/** A new visitor starts with every priority off and at 0: nothing is scored until they pick what matters. */
const defaults = (ids: string[]): Persisted => ({
  weights: Object.fromEntries(ids.map((id) => [id, 0])),
  enabled: Object.fromEntries(ids.map((id) => [id, false])),
  heat: 'fit',
  heatOn: true,
  panelCollapsed: false,
  scheme: 'ryg',
  heatOpacity: 0.85,
  minScore: 0,
  lines: { S: true, U: true, T: true, R: true },
  showAreaNames: false,
  showNotes: false,
  showDistricts: false,
  showPrices: false,
  showPois: false,
  flatSize: 50,
  commute: [],
  bookmarks: [],
  notes: {},
});

/** Make shares valid: migrate old trips/week values, fill gaps, sum to 100. */
export function normalizeShares(points: (CommutePoint & { perWeek?: number })[]): CommutePoint[] {
  if (!points.length) return [];
  const raw = points.map((p) => (typeof p.share === 'number' ? p.share : (p.perWeek ?? 1)));
  const sum = raw.reduce((a, b) => a + b, 0);
  const shares = sum > 0 ? raw.map((v) => (v / sum) * 100) : raw.map(() => 100 / points.length);
  const rounded = shares.map((v) => Math.round(v));
  rounded[rounded.length - 1] += 100 - rounded.reduce((a, b) => a + b, 0);
  return points.map((p, i) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, share: Math.max(0, rounded[i]) }));
}

/** Set one point's share and scale the others proportionally so the total stays 100. */
export function setShare(points: CommutePoint[], id: string, value: number): CommutePoint[] {
  if (points.length === 1) return [{ ...points[0], share: 100 }];
  const v = Math.min(100, Math.max(0, Math.round(value)));
  const others = points.filter((p) => p.id !== id);
  const otherSum = others.reduce((a, p) => a + p.share, 0);
  const rest = 100 - v;
  const next = points.map((p) => {
    if (p.id === id) return { ...p, share: v };
    return { ...p, share: otherSum > 0 ? (p.share / otherSum) * rest : rest / others.length };
  });
  return normalizeShares(next);
}

class Store {
  p!: Persisted;
  t: Transient = { focus: null, pane: null, layers: false, selection: null, sourcesOpen: false, dock: false, prices: [] };
  /** rents an earlier version kept in this browser: uploaded once to the shared list */
  legacyPrices: { lat: number; lon: number; value: number }[] = [];
  private listeners = new Set<Listener>();
  /** the weight a priority gets when it is switched on from 0 */
  private defaultWeights: Record<string, number> = {};

  /** The city whose commute places, saved spots and notes this holds. */
  private cityId = '';

  /** `cityId` is the city on the screen, `firstCityId` the one that data from before there were cities belongs to. */
  init(defaultWeights: Record<string, number>, cityId: string, firstCityId: string) {
    this.cityId = cityId;
    this.defaultWeights = defaultWeights;
    const base = defaults(Object.keys(defaultWeights));
    const saved = storageGet<Persisted>(KEY, base);
    moveLegacyToFirstCity(saved, firstCityId);
    Object.assign(saved, readOwn(cityId) ?? { commute: [], bookmarks: [], notes: {} });
    saved.weights = { ...defaultWeights, ...saved.weights };
    saved.lines = { ...base.lines, ...saved.lines };
    saved.commute = normalizeShares(saved.commute as (CommutePoint & { perWeek?: number })[]);
    const old = (saved as unknown as { prices?: { lat: number; lon: number; value: number }[] }).prices;
    if (Array.isArray(old)) this.legacyPrices = old;
    delete (saved as unknown as { prices?: unknown }).prices;
    this.p = saved;
    setScheme(saved.scheme);
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setP(patch: Partial<Persisted>) {
    Object.assign(this.p, patch);
    if (patch.scheme) setScheme(patch.scheme); // before listeners run, so every colour reads the new scheme
    this.persist();
    this.emit(Object.keys(patch) as Key[]);
  }

  private persist() {
    const { commute, bookmarks, notes, ...shared } = this.p;
    storageSet(KEY, shared);
    storageSet(ownKey(this.cityId), { commute, bookmarks, notes });
  }

  setT(patch: Partial<Transient>) {
    Object.assign(this.t, patch);
    this.emit(Object.keys(patch) as Key[]);
  }

  /** Every priority off and at 0, as for a new visitor, and the map back on the overall score (a single priority's layer would stay behind). */
  clearWeights() {
    const { weights, enabled } = defaults(Object.keys(this.defaultWeights));
    this.setP({ weights, enabled, heat: 'fit' });
  }

  /** Switch a priority on or off. Switching on from 0 gives it its usual weight, so it counts at once. */
  setOn(id: string, on: boolean) {
    const patch: Partial<Persisted> = { enabled: { ...this.p.enabled, [id]: on } };
    if (on && !(this.p.weights[id] > 0)) patch.weights = { ...this.p.weights, [id]: this.defaultWeights[id] ?? 50 };
    this.setP(patch);
  }

  /** Set a priority's weight; any weight above 0 switches it on. */
  setWeight(id: string, w: number) {
    const patch: Partial<Persisted> = { weights: { ...this.p.weights, [id]: w } };
    if (w > 0 && !this.isOn(id)) patch.enabled = { ...this.p.enabled, [id]: true };
    this.setP(patch);
  }

  isOn(id: string) {
    return this.p.enabled[id] !== false;
  }

  exportJson() {
    const { notes, commute, weights, enabled, bookmarks, flatSize } = this.p;
    return JSON.stringify({ version: 2, notes, commute, weights, enabled, bookmarks, flatSize }, null, 2);
  }

  importJson(text: string) {
    const j = JSON.parse(text);
    const patch: Partial<Persisted> = {};
    if (j.notes && typeof j.notes === 'object') patch.notes = j.notes;
    if (Array.isArray(j.commute)) patch.commute = normalizeShares(j.commute);
    if (j.weights) patch.weights = { ...this.p.weights, ...j.weights };
    if (j.enabled) patch.enabled = j.enabled;
    if (Array.isArray(j.bookmarks)) patch.bookmarks = j.bookmarks;
    if (typeof j.flatSize === 'number' && j.flatSize >= 10 && j.flatSize <= 500) patch.flatSize = j.flatSize;
    this.setP(patch);
  }

  private emit(keys: Key[]) {
    const set = new Set(keys);
    for (const l of this.listeners) l(set);
  }
}

export const store = new Store();
