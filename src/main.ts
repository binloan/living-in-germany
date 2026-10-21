import '@fontsource-variable/hanken-grotesk';
import './style.css';
import { cityFromPath, region, rememberCity, rememberedCity, setCity } from './city';
import { loadDataset, type Dataset } from './data';
import { Engine } from './engine';
import { MapView } from './map';
import { listCities, reverse } from './api';
import type { CitySummary } from './types';
import { busy } from './busy';
import { Routes } from './routes';
import { prices } from './prices';
import { normalizeShares, store } from './store';
import { buildPanel } from './ui/panel';
import { buildDetail } from './ui/detail';
import { buildSources } from './ui/sources';
import { buildLayers } from './ui/layers';
import { buildFocus } from './ui/focus';
import { createSplash } from './ui/splash';
import type { Ctx } from './ui/ctx';
import { haversine, h, raf, storageGet, storageSet, uid } from './util';
import { latLngToCell } from 'h3-js';
import { MAX_BOOKMARKS, placeLabel } from './place';

const chrome = document.getElementById('chrome')!;

const splash = createSplash();
document.body.append(splash.el);

/**
 * Which city to show. An address that names one (/berlin) or a city this browser chose before goes straight to loading; with
 * several cities and neither, the visitor is asked. `?choose` always asks (a preview, also while there is only one city).
 */
async function pickCity(cities: CitySummary[]): Promise<string | null> {
  const named = cities.find((c) => c.id === cityFromPath());
  const saved = cities.find((c) => c.id === rememberedCity());
  const preview = new URLSearchParams(location.search).has('choose');
  const fallback = cities.find((c) => c.default) ?? cities[0];
  if (!preview && (named || (saved && !cityFromPath()))) {
    const city = (named ?? saved)!;
    splash.begin(city);
    rememberCity(city.id);
    return city.id;
  }
  if (cities.length > 1 || (preview && cities.length)) {
    const id = await splash.choose(cities, saved?.id ?? fallback.id);
    rememberCity(id);
    history.replaceState(null, '', `/${id}`);
    return id;
  }
  // one city, or the list could not be fetched: the server's default
  splash.begin(fallback ?? { id: '', name: cityFromPath() ?? 'your city', default: true, municipalities: [], shape: null, splash: { quips: [], pokes: [] } });
  return fallback?.id ?? cityFromPath();
}

class NoCityError extends Error {}

async function main() {
  const listed = await listCities().then((c) => c, () => null);
  if (listed && !listed.length) throw new NoCityError();
  const cities = listed ?? [];
  // a second city to try the start screen with while there is only one (dev server only)
  if (import.meta.env.DEV) cities.push(...((window as unknown as { __citiesExtra?: CitySummary[] }).__citiesExtra ?? []));
  const chosen = await pickCity(cities);
  splash.progress(0.02, 'Fetching the neighbourhoods…');
  const ds = await loadDataset(chosen, (done, total, what) => splash.progress(0.5 * (done / total), `Loaded ${what} (${done}/${total})`));
  setCity(ds.city);
  document.title = `Living in ${ds.city.name}`;
  document.querySelector('meta[name=description]')?.setAttribute('content', `Score ${region()} by your priorities and commute places.`);
  document.getElementById('map')?.setAttribute('aria-label', `Map of ${region()}`);
  splash.progress(0.55, 'Scoring 11,000 hexagons…');
  store.init(Object.fromEntries(ds.metrics.map((m) => [m.id, m.weight])), ds.city.id, (ds.config.cities.find((c) => c.default) ?? ds.config.cities[0]).id);
  const legacy = collectLegacyPrices(ds);
  const engine = new Engine(ds);
  const view = new MapView(ds, engine);
  splash.progress(0.65, 'Unrolling the map…');
  await view.init(document.getElementById('map')!);
  splash.progress(0.85, 'Painting the heatmap…');
  const routes = new Routes(view, ds);
  if (import.meta.env.DEV) Object.assign(window, { __view: view, __store: store }); // handy for manual checks

  const ctx: Ctx = {
    ds, engine, view, routes,
    select(lat, lon, fly = false) {
      store.setT({ focus: null, selection: { lat, lon } });
      // on a phone an open menu would cover the spot card: close it
      if ((store.t.pane || store.t.layers) && !window.matchMedia('(min-width: 900px)').matches) store.setT({ pane: null, layers: false });
      if (store.p.commute.length) view.fitSpot(lat, lon); // spot and all commute places in one view
      else if (fly) view.flyTo(lat, lon);
      else view.reveal(lat, lon);
    },
    addCommute({ name, lat, lon }) {
      const dup = store.p.commute.find((p) => Math.abs(p.lat - lat) < 1e-4 && Math.abs(p.lon - lon) < 1e-4);
      if (dup) return;
      // a new place starts with an even split
      const all = [...store.p.commute, { id: uid(), name, lat, lon, share: 1 }].map((p) => ({ ...p, share: 1 }));
      store.setP({ commute: normalizeShares(all) });
      void engine.syncCommute();
    },
    async addPrice({ lat, lon }, value) {
      if (!ds.cellIndex.has(latLngToCell(lat, lon, ds.cells.res))) return `Outside ${region()}`;
      return prices.add({ lat, lon }, value);
    },
    isBookmarked: (lat, lon) => store.p.bookmarks.some((b) => haversine(lat, lon, b.lat, b.lon) < 40),
    toggleBookmark(lat, lon) {
      const have = store.p.bookmarks.find((b) => haversine(lat, lon, b.lat, b.lon) < 40);
      if (have) { store.setP({ bookmarks: store.p.bookmarks.filter((b) => b.id !== have.id) }); return null; }
      if (store.p.bookmarks.length >= MAX_BOOKMARKS) return `At most ${MAX_BOOKMARKS} spots in the comparison. Remove one first.`;
      const p = placeLabel(ds, lat, lon);
      store.setP({ bookmarks: [...store.p.bookmarks, { id: uid(), lat, lon, name: p.name, sub: [p.district !== p.name ? p.district : '', p.detail].filter(Boolean).join(' · ') }] });
      // desktop: the comparison opens by itself once a spot is added (a phone gets the count on its Compare tab instead of a sheet over the map)
      if (window.matchMedia('(min-width: 900px)').matches) store.setT({ dock: true });
      return null;
    },
  };

  if (import.meta.env.DEV) Object.assign(window, { __ctx: ctx });
  const panel = buildPanel(ctx);
  const detail = buildDetail(ctx);
  const sources = buildSources(ctx);
  const layers = buildLayers(ctx);
  chrome.replaceChildren(panel.el, panel.openBtn, panel.dock, panel.reopen, detail.el, layers.el, buildFocus(ctx).el, busy.el, sources.el);
  document.body.classList.toggle('panel-collapsed', store.p.panelCollapsed);

  // first visit: one line on what the map does, gone after the first spot or 12 s
  if (!storageGet('berlin-fit.hint', false)) {
    const touch = window.matchMedia('(hover: none)').matches;
    // a new visitor has no priorities yet: the map is uncoloured until they choose some
    const fresh = !engine.activeMetrics().length;
    const hint = h('div.hint', { role: 'status' }, fresh ? (touch ? 'Open Matches and choose what matters to you' : 'Choose what matters to you in the panel') : touch ? 'Tap the map to see how a spot scores' : 'Click the map to see how a spot scores');
    chrome.append(hint);
    const done = () => { hint.remove(); storageSet('berlin-fit.hint', true); };
    setTimeout(done, 12000);
    store.subscribe((c) => { if ((c.has('selection') && store.t.selection) || (fresh && c.has('enabled'))) done(); });
  }

  // phone: while a slider in a sheet is dragged the sheet fades back, so the map shows what the slider does
  chrome.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (!window.matchMedia('(min-width: 900px)').matches && t instanceof HTMLInputElement && t.type === 'range' && t.closest('.panes, .layers-pop')) document.body.classList.add('sheet-peek');
  });
  const unpeek = () => document.body.classList.remove('sheet-peek');
  window.addEventListener('pointerup', unpeek);
  window.addEventListener('pointercancel', unpeek);

  view.setActions({
    start: ({ lat, lon }) => ctx.select(lat, lon),
    commute: ({ lat, lon, name }) => {
      if (name) { ctx.addCommute({ name, lat, lon }); return; }
      reverse(lat, lon)
        .then((r) => ctx.addCommute({ name: r.address || 'Pinned place', lat, lon }))
        .catch(() => ctx.addCommute({ name: 'Pinned place', lat, lon }));
    },
    compare: ({ lat, lon }) => ctx.toggleBookmark(lat, lon),
    isCompared: ({ lat, lon }) => ctx.isBookmarked(lat, lon),
    price: (p, value) => ctx.addPrice(p, value),
    editPrice: (id, value) => prices.edit(id, value),
    removePrice: (id) => prices.remove(id),
  });

  const paint = (el: HTMLInputElement) => {
    const min = Number(el.min) || 0, max = Number(el.max) || 100;
    el.style.setProperty('--p', `${((Number(el.value) - min) / (max - min)) * 100}%`);
  };
  const paintAll = raf(() => chrome.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(paint));
  chrome.addEventListener('input', (e) => { const t = e.target as HTMLInputElement; if (t.type === 'range') paint(t); });
  store.subscribe(() => paintAll());
  paintAll();

  engine.onChange(raf(() => { view.syncHeat(); view.syncBookmarks(); }));
  store.subscribe((c) => {
    if (c.has('heat') || c.has('heatOpacity') || c.has('minScore') || c.has('heatOn') || c.has('scheme')) view.syncHeat();
    if (c.has('lines')) view.syncLines();
    if (c.has('showAreaNames')) view.syncLabels();
    if (c.has('commute')) { view.syncCommuteMarkers(); view.syncSelection(); routes.update(); }
    if (c.has('notes') || c.has('showNotes')) view.syncNotes();
    if (c.has('prices') || c.has('showPrices') || c.has('heat') || c.has('flatSize')) view.syncPriceLabels();
    if (c.has('bookmarks')) view.syncBookmarks();
    if (c.has('showDistricts')) view.syncDistricts();
    if (c.has('showPois')) view.syncPois();
    if (c.has('selection')) { view.syncSelection(); view.syncHeat(); view.syncEmphasis(); routes.update(); }
    if (c.has('selection') && !store.t.selection) view.applySheet(); // the spot card closed: give back the room it took
    if (c.has('focus')) { view.syncHeat(); view.syncEmphasis(); if (!store.t.focus) view.clearStationPopup(); }
    if (c.has('panelCollapsed')) document.body.classList.toggle('panel-collapsed', store.p.panelCollapsed);
    if (c.has('weights') || c.has('enabled')) engine.recompute();
    if (c.has('pane') || c.has('layers')) {
      const phone = !window.matchMedia('(min-width: 900px)').matches;
      const open = store.t.pane ?? (store.t.layers ? 'layers' : null);
      view.setSheet(open && phone ? Math.round(window.innerHeight * (open === 'compare' ? 0.66 : 0.5)) + 84 : 0);
    }
    if (c.has('pane') || c.has('layers') || c.has('selection')) requestAnimationFrame(() => view.resize());
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && store.t.layers) { store.setT({ layers: false }); return; }
    if (e.key === 'Escape') { view.closePopups(); if (store.t.focus) store.setT({ focus: null }); else if (store.t.selection) store.setT({ selection: null }); }
  });

  engine.recompute();
  prices.start();
  void uploadLegacyPrices(legacy);
  splash.progress(0.95, 'Last look around…');
  await view.whenIdle();
  splash.done();
  await engine.syncCommute();
  document.documentElement.dataset.ready = 'true';
}

/** Rents an earlier version kept only in this browser (as area notes or local price points). */
function collectLegacyPrices(ds: Dataset) {
  const out = [...store.legacyPrices];
  const old = store.p.notes as Record<string, { price?: number; clean?: string }>;
  const byId = new Map(ds.areas.features.map((f) => [f.properties.id, f.properties]));
  const notes = { ...old };
  let changed = false;
  for (const [id, note] of Object.entries(old)) {
    if (note.price == null) continue;
    const a = byId.get(id);
    if (a && note.price > 0) out.push({ lat: a.c[1], lon: a.c[0], value: note.price });
    const { price: _drop, ...rest } = note;
    if (Object.keys(rest).length) notes[id] = rest; else delete notes[id];
    changed = true;
  }
  if (changed) store.setP({ notes: notes as typeof store.p.notes });
  return out;
}

/** Rents are shared now, and per m²: convert the ones from this browser (monthly rents) with the expected flat size and put them on the shared list, once. */
async function uploadLegacyPrices(list: { lat: number; lon: number; value: number }[]) {
  for (const p of list) {
    const sqm = Math.round((p.value / store.p.flatSize) * 10) / 10;
    if (sqm >= 2 && sqm <= 100) await prices.add({ lat: p.lat, lon: p.lon }, sqm);
  }
  store.legacyPrices = [];
}

main().catch((e) => {
  console.error(e);
  splash.fail(e instanceof NoCityError ? 'No city is set up yet. Copy cities.example/ to cities/ and follow ADDING_A_CITY.md.' : 'Could not load the map data. Run `npm run data` and reload.');
});
