import { inCity } from './city';
import type { CitySummary, PricePoint } from './types';

export interface SearchHit {
  label: string;
  detail: string;
  lat: number;
  lon: number;
  kind: string;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(inCity(path), { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Every city with its silhouette, for the start screen. Needs no city, so no `city` parameter. */
export async function listCities(): Promise<CitySummary[]> {
  const res = await fetch('/api/cities');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const search = (q: string, signal?: AbortSignal) =>
  get<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`, signal);

const reverseCache = new Map<string, Promise<{ address: string; locality: string }>>();
export function reverse(lat: number, lon: number) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  let p = reverseCache.get(key);
  if (!p) {
    p = get<{ address: string; locality: string }>(`/api/reverse?lat=${lat}&lon=${lon}`);
    p.catch(() => reverseCache.delete(key));
    reverseCache.set(key, p);
  }
  return p;
}

export interface CommuteTimes {
  minutes: Int16Array; // -1 = unreachable
  transfers: Uint8Array;
  transferMin: number; // minutes one transfer counts for in the score
}

export const commuteMinutes = (lat: number, lon: number) =>
  get<{ minutes: number[]; transfers: number[]; transferMin: number }>(`/api/commute?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`).then((r): CommuteTimes => ({
    minutes: Int16Array.from(r.minutes),
    transfers: Uint8Array.from(r.transfers),
    transferMin: r.transferMin,
  }));

export interface RouteLeg {
  mode: 'W' | 'S' | 'U' | 'T' | 'R' | 'B' | 'F';
  name: string;
  color: string | null;
  from: string;
  to: string;
  minutes: number;
  coords: [number, number][];
}
export interface Route {
  none?: boolean;
  minutes?: number;
  transfers?: number;
  legs?: RouteLeg[];
  /** Who planned it: the name of the city's own timetable service (VBB) or of Transitous. */
  source?: string;
  /** The name of the city's own service that was meant to plan it and could not, when Transitous stepped in. */
  fallbackFor?: string;
}

const routeCache = new Map<string, Promise<Route>>();
/** Best weekday-morning itinerary from a spot to a commute place. */
export function route(from: { lat: number; lon: number }, to: { lat: number; lon: number }) {
  const key = `${from.lat.toFixed(4)},${from.lon.toFixed(4)}>${to.lat.toFixed(4)},${to.lon.toFixed(4)}`;
  let p = routeCache.get(key);
  if (!p) {
    p = get<Route>(`/api/route?lat=${from.lat.toFixed(5)}&lon=${from.lon.toFixed(5)}&toLat=${to.lat.toFixed(5)}&toLon=${to.lon.toFixed(5)}`);
    p.catch(() => routeCache.delete(key));
    routeCache.set(key, p);
  }
  return p;
}

/** Average rents shared by every visitor (server/prices.js). */
async function priceRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(inCity(path), { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const j = await res.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(j?.message ?? (res.status === 429 ? 'Too many changes, try again in a minute' : `Server said ${res.status}`));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
export const listPrices = () => priceRequest<{ prices: PricePoint[] }>('GET', '/api/prices').then((r) => r.prices);
export const createPrice = (p: { lat: number; lon: number; value: number }) => priceRequest<{ price: PricePoint }>('POST', '/api/prices', p).then((r) => r.price);
export const updatePrice = (id: string, value: number) => priceRequest<{ price: PricePoint }>('PATCH', `/api/prices/${encodeURIComponent(id)}`, { value }).then((r) => r.price);
export const deletePrice = (id: string) => priceRequest<void>('DELETE', `/api/prices/${encodeURIComponent(id)}`);
