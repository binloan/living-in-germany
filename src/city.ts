import type { CityInfo, Mode } from './types';

/**
 * The city the app shows. It is set once, right after the data has loaded and before anything is drawn; everything that names
 * the city (headings, hints, lookups) reads it from here instead of spelling it out.
 */
let current: CityInfo | null = null;

export function setCity(c: CityInfo) { current = c; }
export function city(): CityInfo {
  if (!current) throw new Error('The city is not set yet');
  return current;
}

const list = (type: 'conjunction' | 'disjunction') => new Intl.ListFormat('en', { type }).format(city().municipalities);
/** The places the scores cover, as one phrase: "Berlin and Potsdam". */
export const region = () => list('conjunction');
/** "Berlin or Potsdam" */
export const regionOr = () => list('disjunction');
/** "Berlin / Potsdam" */
export const regionSlash = () => city().municipalities.join(' / ');

const GENERIC_MODE: Record<string, string> = { S: 'Suburban rail', U: 'Metro', T: 'Tram', R: 'Regional rail' };
/** The kinds of line the city has, in the order it lists them. */
export const modes = () => Object.keys(city().modes) as Mode[];
/** What the city calls a kind of line. A route can use a kind the city does not list (a regional train from outside), which gets a plain name. */
export const modeLabel = (m: string) => city().modes[m as Mode] ?? GENERIC_MODE[m] ?? m;

/** The id of the city named by the first part of the address (`/hamburg`), null for the front page. */
export function cityFromPath(pathname = location.pathname): string | null {
  const id = pathname.split('/')[1]?.toLowerCase();
  return id || null;
}

const REMEMBERED = 'berlin-fit.city';
/** The city this browser chose last, null when none. */
export function rememberedCity(): string | null {
  try { return localStorage.getItem(REMEMBERED); } catch { return null; }
}
export function rememberCity(id: string | null) {
  try { if (id) localStorage.setItem(REMEMBERED, id); else localStorage.removeItem(REMEMBERED); } catch { /* private mode */ }
}

/** `path` with the city added to its query, for the server's city-dependent endpoints. */
export function inCity(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}city=${encodeURIComponent(city().id)}`;
}
