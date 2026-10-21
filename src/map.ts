import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { latLngToCell } from 'h3-js';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { busy } from './busy';
import { modeLabel, region } from './city';
import type { Dataset } from './data';
import type { Engine } from './engine';
import { reverse, type Route } from './api';
import { store } from './store';
import { rampRgba } from './ramp';
import { icon } from './icons';
import { chip } from './ui/chip';
import { fmtEuro, fmtSqm, h, inkOn } from './util';
import { BOOKMARK_COLORS } from './place';
import type { PriceCluster, ZoneInfo } from './engine';
import type { Mode, Poi } from './types';

export interface SpotActions {
  start: (p: { lat: number; lon: number }) => void;
  commute: (p: { lat: number; lon: number; name?: string }) => void;
  /** adds the spot to Compare, or removes it when it is there already; returns an error text or null */
  compare: (p: { lat: number; lon: number }) => string | null;
  isCompared: (p: { lat: number; lon: number }) => boolean;
  /** returns an error text, or null when the price was set */
  price: (p: { lat: number; lon: number }, value: number) => Promise<string | null>;
  editPrice: (id: string, value: number) => Promise<string | null>;
  removePrice: (id: string) => Promise<string | null>;
}

const INK = '#101a24';
const MODES: Mode[] = ['R', 'T', 'S', 'U'];
/** Mode colours: swatches, hover cards and route fallbacks. Lines on the map keep their own official colour. */
export const MODE_COLOR: Record<Mode, string> = { S: '#0a8a4f', U: '#0b5fb5', T: '#d4271c', R: '#3a4550' };

const hasMode = (m: string) => ['in', m, ['get', 'modes']] as maplibregl.ExpressionSpecification;
const MAJOR = ['==', ['get', 'tier'], 2] as maplibregl.FilterSpecification;
const RAIL = ['==', ['get', 'tier'], 1] as maplibregl.FilterSpecification;
const TRAM = ['==', ['get', 'tier'], 0] as maplibregl.FilterSpecification;
const STATION_LAYERS = ['st-major-dot', 'st-rail-dot', 'st-tram-dot'];
/** every station layer with its tier filter: syncLines adds the transit-type filter on top */
const STATION_TIER_FILTER: Record<string, maplibregl.FilterSpecification> = {
  'st-major-dot': MAJOR, 'st-rail-dot': RAIL, 'st-tram-dot': TRAM,
  'st-major-label': MAJOR, 'st-rail-label': RAIL, 'st-tram-label': TRAM,
};

/** Major = a real hub: three rail modes, or several rail lines across two modes, or many rail lines. */
export function stationTier(modes: string, lines: string[], lineMode: Map<string, Mode>) {
  const rail = [...modes].filter((m) => 'SUR'.includes(m)).length;
  const railLines = lines.filter((l) => { const m = lineMode.get(l); return m && m !== 'T'; }).length;
  if (rail >= 3 || railLines >= 5 || (rail >= 2 && railLines >= 4)) return 2;
  return rail >= 1 ? 1 : 0;
}

export class MapView {
  map!: maplibregl.Map;
  private overlay!: MapboxOverlay;
  private version = 0;
  /** spot shown as if it were selected, while the pointer rests on a list entry */
  private preview: { lat: number; lon: number } | null = null;
  /** rent labels with the price zone they belong to, so they can fade while a spot is in focus */
  private poiEls: { el: HTMLElement; p: Poi }[] = [];
  private priceEls: { el: HTMLElement; zone: number }[] = [];
  private markers = { commute: [] as maplibregl.Marker[], notes: [] as maplibregl.Marker[], prices: [] as maplibregl.Marker[], bookmarks: [] as maplibregl.Marker[], pois: [] as maplibregl.Marker[], pin: null as maplibregl.Marker | null };
  private popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'st-pop', maxWidth: '300px' });
  private popupKey = '';
  private ready = false;
  private actions: SpotActions | null = null;
  private spotPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, anchor: 'bottom', className: 'spot-pop', maxWidth: '300px' });
  private routeLines: string[] = [];
  constructor(private ds: Dataset, private engine: Engine) {}

  setActions(a: SpotActions) { this.actions = a; }

  async init(container: HTMLElement) {
    const { config } = this.ds;
    this.map = new maplibregl.Map({
      container,
      style: config.basemapStyleUrl,
      center: config.center,
      zoom: 9.6,
      minZoom: 7.5, // low enough that the whole city fits the width of a portrait phone (needs about 8.3)
      maxZoom: 18,
      // on a phone a menu covers more than half the screen: the map needs room to be dragged far enough that any place can sit in the part above it
      maxBounds: [config.bounds[0] - 0.6, config.bounds[1] - (window.matchMedia('(min-width: 900px)').matches ? 0.4 : 1.3), config.bounds[2] + 0.6, config.bounds[3] + (window.matchMedia('(min-width: 900px)').matches ? 0.4 : 1.3)],
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    } as maplibregl.MapOptions);
    this.map.touchZoomRotate.disableRotation();
    for (const ev of ['dragstart', 'zoomstart'] as const) this.map.on(ev, (e) => { if ((e as { originalEvent?: unknown }).originalEvent) this.cameraByUser = true; });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    // a phone shows only the (i); the credits open with a tap (the library starts them open)
    if (!window.matchMedia('(min-width: 900px)').matches) {
      const collapse = () => {
        const credits = container.querySelector('.maplibregl-ctrl-attrib');
        credits?.removeAttribute('open');
        credits?.classList.remove('maplibregl-compact-show');
      };
      collapse();
      this.map.once('idle', collapse); // the library opens them again once the style's credits have loaded
    }

    await new Promise<void>((res) => this.map.once('load', () => res()));
    this.addLayers();
    this.overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    this.map.addControl(this.overlay as unknown as maplibregl.IControl);
    this.bindStations();
    // saved-spot labels shrink to letter + score when zoomed out, so they do not pile up
    const compact = () => {
      container.classList.toggle('bm-compact', this.map.getZoom() < 9);
      container.classList.toggle('zoom-far', this.map.getZoom() < 10.8); // 129 rent labels only fit once zoomed in
      // landmarks appear by rank as the map zooms in, and get their names once there is room
      container.classList.toggle('poi-mid', this.map.getZoom() >= 10.8);
      container.classList.toggle('poi-near', this.map.getZoom() >= 12);
      container.classList.toggle('poi-names', this.map.getZoom() >= 14.5);
      container.classList.toggle('cm-names', this.map.getZoom() >= 12.5); // commute places: name only when zoomed in, else just the number
    };
    this.map.on('zoom', compact);
    compact();
    let declutterQueued = false;
    this.map.on('move', () => { if (!declutterQueued) { declutterQueued = true; requestAnimationFrame(() => { declutterQueued = false; this.declutterPois(); }); } });
    this.ready = true;
    this.fitAll();
    this.syncAll();
  }

  /** Resolves once the map has painted what it shows (or after 6 s, so a slow tile server never blocks the app). */
  whenIdle() {
    return new Promise<void>((res) => {
      const timer = setTimeout(res, 6000);
      this.map.once('idle', () => { clearTimeout(timer); res(); });
      this.map.triggerRepaint();
    });
  }

  /** Vertical shift (px) the map currently has to make room for a mobile bottom sheet (menu pane or spot card). */
  private sheetShift = 0;
  /** Height in px of what covers the bottom of the map: the mobile menu pane or the desktop compare dock (0 when closed). */
  private paneSheet = 0;
  /** Where the map was before a pane made it zoom out, to go back to when the pane closes. */
  private sheetRestore: { center: maplibregl.LngLat; zoom: number; shift: number } | null = null;
  private sheetWaiting = false;

  /** How far fitSpot slides the map up on mobile: the spot card covers the lower part of the screen. */
  private detailShift() {
    return Math.max(0, Math.round((window.innerHeight * 0.46 + 96 - 130) / 2));
  }

  /** The menu pane opened (height in px) or closed (0). */
  setSheet(paneHeight: number) {
    this.paneSheet = paneHeight;
    this.applySheet();
  }

  /**
   * Mobile: bottom sheets cover the lower part of the screen. Whatever the user is looking at has to stay visible in the part above
   * the sheet: the commute places and the selected spot, plus the whole city when it is (mostly) in view. If all of that is in the free
   * part already the map does not move; otherwise it is centred there, zooming out only if it does not fit at the current zoom. With
   * nothing like that in view (zoomed into a district, no places) the map is left alone. When the sheet closes the map goes back to
   * exactly where it was. Any other camera move (fit, fly, reveal) places the map itself, so the way back is forgotten there.
   */
  applySheet() {
    if (!this.ready) return;
    const map = this.map;
    // a fit or fly is on its way (selecting a spot while the dock grows): judge where things are once it has arrived, not halfway,
    // or the halfway positions look hidden and the map is pulled back out
    if (map.isMoving()) {
      if (!this.sheetWaiting) { this.sheetWaiting = true; map.once('moveend', () => { this.sheetWaiting = false; this.applySheet(); }); }
      return;
    }
    const mobile = !window.matchMedia('(min-width: 900px)').matches;
    const pane = this.paneSheet;
    const want = mobile && store.t.selection ? this.detailShift() : 0; // what a closed pane leaves: the spot card's room, or nothing
    if (pane > 0) {
      const w = window.innerWidth, hh = window.innerHeight;
      // free part of the screen: above the sheet on a phone; right of the side panel and above the dock on desktop
      const gap = mobile ? 24 : 16;
      const ins = this.deskInsets(gap);
      const left = mobile ? 12 : ins.left, right = mobile ? w - 12 : w - ins.right, top = mobile ? 110 : 40, bottom = hh - pane - gap;
      const geo: [number, number][] = store.p.commute.map((p) => [p.lon, p.lat]);
      if (store.t.selection) geo.push([store.t.selection.lon, store.t.selection.lat]);
      // the city counts when most of it is on screen
      const [bw, bs, be, bn] = this.cityBox();
      const corners: [number, number][] = [[bw, bs], [be, bs], [be, bn], [bw, bn]];
      const cq = corners.map((c) => map.project(c));
      const cx0 = Math.min(...cq.map((p) => p.x)), cx1 = Math.max(...cq.map((p) => p.x));
      const cy0 = Math.min(...cq.map((p) => p.y)), cy1 = Math.max(...cq.map((p) => p.y));
      const seen = Math.max(0, Math.min(cx1, w) - Math.max(cx0, 0)) * Math.max(0, Math.min(cy1, hh) - Math.max(cy0, 0));
      // (not on desktop with a spot selected: the camera was just fitted to that spot and its routes, and zooming out to the whole city would undo it)
      if (seen >= 0.6 * (cx1 - cx0) * (cy1 - cy0) && (mobile || !store.t.selection)) geo.push(...corners);
      if (!geo.length) return;
      const q = geo.map((p) => map.project(p));
      const inView = q.every((p) => p.x >= left - 1 && p.x <= right + 1 && p.y >= top - 1 && p.y <= bottom + 1);
      if (inView) return;
      const bounds = geo.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(geo[0], geo[0]));
      const cam = map.cameraForBounds(bounds, { padding: { top, bottom: pane + gap, left, right: w - right }, maxZoom: map.getZoom() });
      if (cam?.center && Number.isFinite(cam.zoom)) {
        this.sheetRestore ??= { center: map.getCenter(), zoom: map.getZoom(), shift: this.sheetShift };
        map.easeTo({ center: cam.center, zoom: cam.zoom, duration: 450, essential: true });
      }
      return;
    }
    if (this.sheetRestore) {
      const r = this.sheetRestore;
      this.sheetRestore = null;
      const back = want - r.shift; // a spot card opened meanwhile still needs its room
      map.easeTo({ center: r.center, zoom: r.zoom, duration: 450, essential: true });
      this.sheetShift = want;
      if (Math.abs(back) >= 1) map.once('moveend', () => map.panBy([0, back], { duration: 250, essential: true }));
      return;
    }
    const d = want - this.sheetShift;
    this.sheetShift = want;
    if (Math.abs(d) >= 1) map.panBy([0, d], { duration: 300, essential: true });
  }

  /** West, south, east, north of everything that is scored (a fixed box once cut the edge of a smaller place off on a phone). */
  private cityBox(): [number, number, number, number] {
    if (this.box) return this.box;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const g = this.ds.outline?.geometry;
    const polys = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const [ring] of polys) for (const [x, y] of ring) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
    return (this.box = Number.isFinite(w) ? [w, s, e, n] : this.ds.city.map.fallbackBox);
  }
  private box: [number, number, number, number] | null = null;

  /** Fit the whole city into the part of the screen no sheet covers. */
  fitAll(sheetPx = 0, animate = false) {
    const desktop = window.matchMedia('(min-width: 900px)').matches;
    this.sheetShift = 0;
    this.sheetRestore = null;
    this.map.resize();
    this.map.fitBounds(this.cityBox(), {
      padding: desktop ? { top: 40, bottom: 40, left: store.p.panelCollapsed ? 40 : 400, right: 40 } : { top: 120, bottom: sheetPx || 100, left: 8, right: 8 },
      duration: animate ? 350 : 0,
    });
  }

  private addLayers() {
    const map = this.map;
    const layers = map.getStyle().layers;
    const firstSymbol = layers.find((l) => l.type === 'symbol')?.id;
    const textFont = ['Noto Sans Regular'];
    const boldFont = ['Noto Sans Bold'];
    const z = (...pairs: [number, number][]): maplibregl.ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], ...pairs.flat()] as maplibregl.ExpressionSpecification;

    // slot for the deck.gl hex layer: everything below stays basemap, everything we add sits above it
    map.addSource('anchor', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'hex-anchor', type: 'line', source: 'anchor' }, firstSymbol);

    // everything outside the scored area is dimmed: the world rectangle with the outline cut out of it
    if (this.ds.outline) {
      const polys = this.ds.outline.geometry.type === 'Polygon' ? [this.ds.outline.geometry.coordinates] : this.ds.outline.geometry.coordinates;
      const world: GeoJSON.Position[] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
      const features: GeoJSON.Feature[] = [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, ...polys.map((p) => p[0])] } }];
      for (const p of polys) for (const hole of p.slice(1)) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [hole] } });
      map.addSource('outside', { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({ id: 'outside-mask', type: 'fill', source: 'outside', paint: { 'fill-color': '#1b2733', 'fill-opacity': 0.2 } }, 'hex-anchor');
    }

    // borders: thin for areas, strong for districts, both above the heat field
    map.addSource('areas', { type: 'geojson', data: this.ds.areas as unknown as GeoJSON.FeatureCollection });
    map.addLayer({ id: 'area-border', type: 'line', source: 'areas', minzoom: 11.4, paint: { 'line-color': INK, 'line-opacity': 0.22, 'line-width': z([9, 0.4], [13, 0.7], [16, 1.3]) } }, firstSymbol);
    map.addSource('district-borders', { type: 'geojson', data: this.ds.districtBorders as GeoJSON.FeatureCollection });
    map.addLayer({ id: 'district-casing', type: 'line', source: 'district-borders', layout: { 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.8, 'line-width': z([9, 3.6], [14, 6]) } }, firstSymbol);
    map.addLayer({ id: 'district-border', type: 'line', source: 'district-borders', layout: { 'line-join': 'round' }, paint: { 'line-color': INK, 'line-opacity': 0.9, 'line-width': z([9, 1.5], [14, 2.8]) } }, firstSymbol);
    // the district of a hovered or selected spot keeps its full outline while the other borders fade
    map.addSource('district-outlines', { type: 'geojson', data: this.ds.districtOutlines });
    const noDistrict: maplibregl.FilterSpecification = ['==', ['get', 'name'], ''];
    map.addLayer({ id: 'district-focus-casing', type: 'line', source: 'district-outlines', filter: noDistrict, layout: { 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.8, 'line-width': z([9, 3.6], [14, 6]) } }, firstSymbol);
    map.addLayer({ id: 'district-focus-border', type: 'line', source: 'district-outlines', filter: noDistrict, layout: { 'line-join': 'round' }, paint: { 'line-color': INK, 'line-opacity': 0.9, 'line-width': z([9, 1.5], [14, 2.8]) } }, firstSymbol);
    map.addLayer({ id: 'area-selected', type: 'line', source: 'areas', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': INK, 'line-width': 2.6, 'line-opacity': 0.95 } }, firstSymbol);
    map.addLayer({ id: 'area-preview', type: 'line', source: 'areas', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': INK, 'line-width': 2.6, 'line-opacity': 0.8 } }, firstSymbol);

    // transit lines: body colour = mode, white casing, thicker than before
    map.addSource('lines', { type: 'geojson', data: this.ds.lines as GeoJSON.FeatureCollection });
    const width: Record<Mode, maplibregl.ExpressionSpecification> = {
      R: z([9, 1], [12, 1.8], [15, 3]),
      T: z([10, 1.1], [13, 2.4], [16, 4.2]),
      S: z([9, 1.5], [12, 3.4], [15, 6.5]),
      U: z([9, 1.5], [12, 3.4], [15, 6.5]),
    };
    const casingW = z([9, 3.4], [12, 6], [15, 9.1]);
    const minzoom = (m: Mode) => (m === 'T' ? 9 : 0); // trams are thin enough to show city-wide, they must not vanish when only trams are switched on
    for (const m of MODES) {
      const filter: maplibregl.FilterSpecification = ['==', ['get', 'mode'], m];
      map.addLayer({ id: `lines-casing-${m}`, type: 'line', source: 'lines', filter, minzoom: minzoom(m), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.95, 'line-width': m === 'T' ? z([10, 3.7], [13, 5], [16, 6.8]) : m === 'R' ? z([9, 3.4], [12, 4.4], [15, 5.6]) : casingW } }, firstSymbol);
    }
    for (const m of MODES) {
      const filter: maplibregl.FilterSpecification = ['==', ['get', 'mode'], m];
      map.addLayer({
        id: `lines-${m}`, type: 'line', source: 'lines', filter, minzoom: minzoom(m),
        layout: { 'line-cap': m === 'R' ? 'butt' : 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': width[m], ...(m === 'R' ? { 'line-dasharray': [2.4, 1.2] } : {}) },
      }, firstSymbol);
    }

    // route highlight for the selected spot (above lines, below stations)
    map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': INK, 'line-width': z([9, 8], [14, 14]), 'line-opacity': 0.92 } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', filter: ['!=', ['get', 'walk'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': z([9, 4.4], [14, 9]) } });
    map.addLayer({ id: 'route-walk', type: 'line', source: 'route', filter: ['==', ['get', 'walk'], 1], layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#ffffff', 'line-width': z([9, 2.4], [14, 3.6]), 'line-dasharray': [1, 1.4] } });

    // focused station: its lines drawn bold with an ink casing, like the commute routes
    map.addSource('focus', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'focus-casing', type: 'line', source: 'focus', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': INK, 'line-width': z([9, 8], [14, 14]), 'line-opacity': 0.92 } });
    map.addLayer({ id: 'focus-line', type: 'line', source: 'focus', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': z([9, 4.4], [14, 9]) } });

    // station dots: three tiers
    const stationFc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: this.ds.stations.map(([lat, lon, name, modes, lines]) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { name, modes, lines: JSON.stringify(lines), tier: stationTier(modes, lines, this.ds.lineMode), n: lines.length },
      })),
    };
    map.addSource('stations', { type: 'geojson', data: stationFc });
    map.addLayer({
      id: 'st-tram-dot', type: 'circle', source: 'stations', filter: TRAM, minzoom: 14.4,
      paint: { 'circle-radius': z([14.4, 1.8], [17, 3.6]), 'circle-color': '#fff', 'circle-stroke-color': INK, 'circle-stroke-width': 1.1 },
    });
    map.addLayer({
      id: 'st-rail-dot', type: 'circle', source: 'stations', filter: RAIL, minzoom: 11.6,
      paint: { 'circle-radius': z([11.6, 1.8], [13, 2.8], [17, 5]), 'circle-color': '#fff', 'circle-stroke-color': INK, 'circle-stroke-width': z([11.6, 1], [15, 1.6]) },
    });
    map.addLayer({
      id: 'st-major-dot', type: 'circle', source: 'stations', filter: MAJOR, minzoom: 9.6,
      paint: { 'circle-radius': z([9.6, 3], [12, 4.4], [15, 6.6], [17, 8.6]), 'circle-color': '#fff', 'circle-stroke-color': INK, 'circle-stroke-width': z([9.6, 1.3], [14, 2.1]) },
    });

    // labels
    map.addSource('area-labels', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: this.ds.areas.features.map((f) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: f.properties.c }, properties: { name: f.properties.name, city: f.properties.city, district: f.properties.district } })) },
    });
    map.addSource('districts', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: this.ds.districts.map((d) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: d.c }, properties: { name: d.name } })) },
    });
    const halo = { 'text-halo-color': 'rgba(255,255,255,0.94)', 'text-halo-width': 1.7 };
    map.addLayer({
      id: 'district-labels', type: 'symbol', source: 'districts', maxzoom: 11.6,
      layout: { 'text-field': ['get', 'name'], 'text-font': boldFont, 'text-size': z([9, 11], [11, 13]), 'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 8 },
      paint: { 'text-color': INK, ...halo },
    });
    map.addLayer({
      id: 'area-labels', type: 'symbol', source: 'area-labels', minzoom: 11.6,
      layout: { 'text-field': ['get', 'name'], 'text-font': textFont, 'text-size': z([11.6, 10.5], [15, 13]), 'text-max-width': 7 },
      paint: { 'text-color': '#2b3845', ...halo },
    });

    // line badges along the line: white text on the line's own colour
    const lineBadge = (id: string, mode: Mode, minzoom: number, spacing: number) =>
      map.addLayer({
        id, type: 'symbol', source: 'lines', filter: ['==', ['get', 'mode'], mode], minzoom,
        layout: {
          'symbol-placement': 'line', 'symbol-spacing': spacing, 'text-field': ['get', 'name'], 'text-font': boldFont,
          'text-size': z([10, 11], [14, 12.5]), 'text-rotation-alignment': 'viewport', 'text-pitch-alignment': 'viewport', 'text-keep-upright': true,
          'text-padding': 4, 'text-max-angle': 50,
        },
        paint: { 'text-color': ['get', 'ink'], 'text-halo-color': ['get', 'color'], 'text-halo-width': 3 },
      });
    lineBadge('badge-R', 'R', 10.2, 340);
    lineBadge('badge-S', 'S', 10.6, 300);
    lineBadge('badge-U', 'U', 10.6, 300);
    lineBadge('badge-T', 'T', 13, 260);

    const stLabel = (id: string, filter: maplibregl.FilterSpecification, minzoom: number, size: maplibregl.ExpressionSpecification, bold = true) =>
      map.addLayer({
        id, type: 'symbol', source: 'stations', filter, minzoom,
        layout: { 'text-field': ['get', 'name'], 'text-font': bold ? boldFont : textFont, 'text-size': size, 'text-anchor': 'top', 'text-offset': [0, 0.8], 'text-max-width': 8, 'text-optional': true, 'symbol-sort-key': ['-', 0, ['get', 'n']] },
        paint: { 'text-color': INK, 'text-halo-color': 'rgba(255,255,255,0.96)', 'text-halo-width': 2 },
      });
    stLabel('st-major-label', MAJOR, 11, z([11, 11.5], [14, 13]));
    stLabel('st-rail-label', RAIL, 13.4, z([13.4, 10.5], [15, 12]));
    stLabel('st-tram-label', TRAM, 15.2, z([15.2, 10.5], [17, 12]), false);
  }

  /** Hover (desktop) / tap (touch) popup with the station's transit types and lines. */
  private bindStations() {
    const map = this.map;
    const hit = (point: maplibregl.PointLike) => {
      const p = point as { x: number; y: number };
      return map.queryRenderedFeatures([[p.x - 8, p.y - 8], [p.x + 8, p.y + 8]], { layers: STATION_LAYERS })
        .sort((a, b) => Number(b.properties?.tier ?? 0) - Number(a.properties?.tier ?? 0))[0];
    };
    map.on('mousemove', (e) => {
      const f = hit(e.point);
      map.getCanvas().style.cursor = f ? 'pointer' : '';
      if (f) this.showStation(f);
      else this.hideStation();
    });
    map.on('mouseout', () => this.hideStation());
    map.on('click', (e) => {
      document.querySelectorAll('.poi.open').forEach((x) => x.classList.remove('open'));
      const f = hit(e.point);
      if (f) {
        // a station is not a start address: show its lines only
        this.showStation(f, true);
        store.setT({ focus: { name: String(f.properties?.name ?? ''), lines: JSON.parse(String(f.properties?.lines ?? '[]')) } });
        return;
      }
      this.hideStation(true);
      if (store.t.focus) store.setT({ focus: null });
      // outside the scored area there is nothing to score: just close what is open
      if (!this.inside(e.lngLat.lng, e.lngLat.lat)) { this.outsideNote(e.lngLat.lat, e.lngLat.lng); return; }
      // desktop: the spot card opens at once (it has the score, Compare, Commute and the rent); a phone gets the small menu first
      if (window.matchMedia('(min-width: 900px)').matches) { this.closeSpotPopups(); this.actions?.start({ lat: e.lngLat.lat, lon: e.lngLat.lng }); return; }
      this.openSpotMenu(e.lngLat.lat, e.lngLat.lng);
    });
  }

  /** Whether a point lies within the scored area (the outline of all scored areas). */
  private inside(lon: number, lat: number) {
    const o = this.ds.outline;
    if (!o) return true;
    const ring = (r: GeoJSON.Position[]) => {
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        if ((r[i][1] > lat) !== (r[j][1] > lat) && lon < ((r[j][0] - r[i][0]) * (lat - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
      }
      return c;
    };
    const polys = o.geometry.type === 'Polygon' ? [o.geometry.coordinates] : o.geometry.coordinates;
    return polys.some((p) => ring(p[0]) && !p.slice(1).some(ring));
  }

  /** Close button for the popups. */
  private closeX(onClose: () => void) {
    return h('button.pop-x', { type: 'button', 'aria-label': 'Close', onclick: onClose }, icon('x'));
  }

  private showStation(f: maplibregl.MapGeoJSONFeature, pin = false) {
    const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
    const key = `${lon},${lat}${pin ? '!' : ''}`;
    if (!pin && this.popupKey.endsWith('!')) return; // a clicked station keeps its popup (with the buttons) until the next click; hovering must not replace it
    if (key === this.popupKey) return;
    this.popupKey = key;
    const name = String(f.properties?.name ?? '');
    const lines: string[] = JSON.parse(String(f.properties?.lines ?? '[]'));
    const groups = new Map<Mode, string[]>();
    for (const l of lines) {
      const m = this.ds.lineMode.get(l);
      if (!m) continue;
      (groups.get(m) || groups.set(m, []).get(m)!).push(l);
    }
    const body = h('div.sp', null, h('b.sp-name', null, name));
    for (const m of MODES.slice().reverse() as Mode[]) {
      const ls = groups.get(m);
      if (!ls) continue;
      body.append(h('div.sp-row', null,
        h('span.sp-mode', null, h('i', { style: `background:${MODE_COLOR[m]}` }), modeLabel(m)),
        h('span.sp-lines', null, ...ls.slice(0, 12).map((n) => {
          const c = this.ds.lineColor.get(n) ?? MODE_COLOR[m];
          return h('span.line', { style: `background:${c};color:${inkOn(c)}` }, n);
        }), ls.length > 12 ? h('span.more', null, `+${ls.length - 12}`) : null)));
    }
    if (pin) body.append(this.actionRow({ lat, lon }, name), ...[this.detailsBtn({ lat, lon })].filter((b): b is HTMLElement => !!b), this.closeX(() => { this.closeSpotPopups(); if (store.t.focus) store.setT({ focus: null }); }));
    this.popup.setLngLat([lon, lat]).setDOMContent(body).addTo(this.map);
    // after addTo: adding a popup that is already open rebuilds its element, which would drop the class (and with it the clickable buttons)
    this.popup[pin ? 'addClassName' : 'removeClassName']('pinned');
  }

  private closeSpotPopups() { this.popup.remove(); this.popupKey = ''; this.spotPopup.remove(); }

  /** Zone a spot belongs to (a price counts for all of it), null outside the city. */
  private districtAt(lat: number, lon: number) {
    return this.engine.zoneAt(lat, lon)?.name ?? null;
  }

  /** Average-rent field: the number, its unit and a button. */
  private priceForm(o: { value?: number; button: string; hint: string; disabled?: boolean; submit: (v: number) => Promise<string | null>; extra?: HTMLElement }) {
    const input = h('input', { type: 'number', inputmode: 'decimal', min: 1, step: 'any', placeholder: '18', 'aria-label': 'Average rent in euros per square metre', value: o.value ?? '', disabled: o.disabled }) as HTMLInputElement;
    const err = h('p.price-err', { hidden: true, role: 'alert' });
    const calc = h('p.price-calc');
    const showCalc = () => {
      const v = Number(input.value);
      calc.textContent = v > 0 ? `≈ ${fmtEuro(v * store.p.flatSize)} a month for ${store.p.flatSize} m²` : `Rent per m² (change the flat size in Profile)`;
    };
    input.addEventListener('input', showCalc);
    showCalc();
    let sending = false;
    const go = async () => {
      if (sending) return;
      const v = Number(input.value);
      if (!(v > 0)) { err.textContent = 'Enter the rent per m² in euros'; err.hidden = false; return; }
      sending = true;
      err.hidden = true;
      const e = await o.submit(Math.round(v * 100) / 100);
      sending = false;
      if (e) { err.textContent = e; err.hidden = false; }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return h('div.price-form', null,
      h('label.price-label', null, h('span', null, 'Average rent'), h('div.price-field', null, input, h('i', null, '€/m²'))),
      calc,
      h('p.price-hint', null, o.hint),
      err,
      h('div.spot-actions', null, h('button.btn', { type: 'button', disabled: o.disabled, onclick: go }, icon('plus'), o.button), o.extra));
  }

  /** The average rent of the zone a spot lies in, folded away until it is wanted: shows it and sets it. Used by the popup and the spot card. */
  rentFold(p: { lat: number; lon: number }) {
    const zone = this.engine.zoneAt(p.lat, p.lon);
    const here = zone ? this.engine.priceClusters.find((c) => this.engine.zones[c.zone] === zone) : undefined;
    return h('details.price-fold', null,
      h('summary', null,
        h('span', null, 'Average rent'),
        here ? h('small', null, `${fmtSqm(here.value)} here`) : null,
        icon('chevron')),
      this.priceForm({
        button: 'Set rent', disabled: !zone,
        hint: zone ? `Counts for all of ${zone.name}` : `Outside ${region()}`,
        submit: async (v) => {
          const e = (await this.actions?.price(p, v)) ?? null;
          if (!e) this.closeSpotPopups();
          return e;
        },
      }));
  }

  /** Phone: the way to the spot card, an (i) in the name row left of the name (the card opens by itself on desktop). */
  private detailsBtn(p: { lat: number; lon: number }) {
    if (window.matchMedia('(min-width: 900px)').matches) return null;
    return h('button.btn.pop-i', { type: 'button', title: 'Show the details of this spot', 'aria-label': 'Show the details of this spot', onclick: () => { this.closeSpotPopups(); this.actions?.start(p); } }, icon('info'));
  }

  private actionRow(p: { lat: number; lon: number }, name?: string) {
    const fold = this.rentFold(p);
    // icon + one short word each, so the two actions read without a hover: add to Compare, add as commute place
    const iconBtn = (cls: string, label: string, glyph: ReturnType<typeof icon>, onclick: () => void, pressed?: boolean, text = label) =>
      h('button.btn' + cls, { type: 'button', title: label, 'aria-label': label, 'aria-pressed': pressed == null ? null : String(pressed), onclick }, glyph, h('span', null, text));
    const err = h('p.price-err', { hidden: true, role: 'alert' });
    const compared = !!this.actions?.isCompared(p);
    return h('div.spot-menu', null,
      fold,
      h('div.spot-actions', null,
        iconBtn(compared ? '.cmp-btn.saved' : '.cmp-btn', compared ? 'Remove from Compare' : 'Add to Compare', icon('compare'), () => {
          const e = this.actions?.compare(p) ?? null;
          if (e) { err.textContent = e; err.hidden = false; return; }
          this.closeSpotPopups();
        }, compared, compared ? 'In compare' : 'Compare'),
        iconBtn('', 'Add as commute place', icon('route'), () => { this.closeSpotPopups(); this.actions?.commute({ ...p, name }); }, undefined, 'Commute')),
      err);
  }

  /** Click on a rent label: the reports behind the average. Change or remove each, or add another. */
  private openPriceEditor(c: PriceCluster) {
    const n = c.reports.length;
    const district = this.engine.zones[c.zone].name;
    const rows = h('ul.rep-list');
    for (const r of c.reports) {
      const input = h('input', { type: 'number', inputmode: 'decimal', min: 1, step: 'any', value: r.value, 'aria-label': 'Reported rent in euros per square metre' }) as HTMLInputElement;
      input.addEventListener('change', () => {
        const v = Math.round(Number(input.value) * 100) / 100;
        if (v > 0 && v !== r.value) { void this.actions?.editPrice(r.id, v); this.spotPopup.remove(); }
      });
      rows.append(h('li', null, h('div.price-field', null, input, h('i', null, '€/m²')), h('small.rep-mo', null, `${fmtEuro(r.value * store.p.flatSize)}/mo`),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Remove this report', onclick: () => { void this.actions?.removePrice(r.id); this.spotPopup.remove(); } }, icon('trash'))));
    }
    const body = h('div.spot', null,
      this.closeX(() => this.spotPopup.remove()),
      h('b.spot-title', null, `Average rent ${fmtEuro(c.value * store.p.flatSize)} a month`),
      h('p.price-hint', null, `${fmtSqm(c.value)} × ${store.p.flatSize} m² · ${n === 1 ? '1 report' : `average of ${n} reports`}`),
      rows,
      this.priceForm({
        button: 'Add a report', hint: `Counts for all of ${district}`,
        submit: async (v) => {
          const e = (await this.actions?.price({ lat: c.lat, lon: c.lon }, v)) ?? null;
          if (!e) this.spotPopup.remove();
          return e;
        },
      }));
    this.popup.remove();
    this.popupKey = '';
    this.spotPopup.setLngLat([c.lon, c.lat]).setDOMContent(body).addTo(this.map);
    this.fitSpotPopup();
  }

  /** A zone without a rent yet: ask for one. */
  askPrice(d: ZoneInfo) {
    this.map.flyTo({ center: [d.lon, d.lat], zoom: Math.max(this.map.getZoom(), 10.5), duration: 600, essential: true });
    const body = h('div.spot', null,
      this.closeX(() => this.spotPopup.remove()),
      h('b.spot-title', null, `${d.name}: no rent yet`),
      this.priceForm({
        button: 'Set rent', hint: `Counts for all of ${d.name}`,
        submit: async (v) => {
          const e = (await this.actions?.price({ lat: d.lat, lon: d.lon }, v)) ?? null;
          if (!e) this.spotPopup.remove();
          return e;
        },
      }));
    this.popup.remove();
    this.popupKey = '';
    this.spotPopup.setLngLat([d.lon, d.lat]).setDOMContent(body).addTo(this.map);
    this.fitSpotPopup();
  }

  /** The score of the spot on the layer the map shows (the overall score, or one priority), as the same chip Compare uses. */
  private scoreRow(lat: number, lon: number) {
    const id = this.engine.heatId();
    const i = this.ds.cellIndex.get(latLngToCell(lat, lon, this.ds.cells.res));
    const name = id === 'fit' ? 'Overall score' : (this.ds.metrics.find((m) => m.id === id)?.label ?? id);
    if (id === 'fit' && !this.engine.activeMetrics().length) return h('p.spot-score.none', null, 'Choose priorities to see a score');
    const v = i == null ? null : this.engine.heat(i);
    return h('div.spot-score', null, h('span', null, name), chip(v, v == null ? null : this.engine.shadeFor(v), id === 'fit' ? 1 : 0));
  }

  /** Clicked a free spot on the map: its score, then Compare, Details or Commute. */
  private openSpotMenu(lat: number, lon: number) {
    const title = h('b.spot-title', null, this.districtAt(lat, lon) ?? 'This spot'); // the district stands in until the address arrives
    const body = h('div.spot', null, this.closeX(() => this.spotPopup.remove()), this.detailsBtn({ lat, lon }), title, this.scoreRow(lat, lon), this.actionRow({ lat, lon }));
    reverse(lat, lon).then((r) => { const t = [r.address, r.locality].filter(Boolean).join(', '); if (t) title.textContent = t; }).catch(() => {});
    this.popup.remove();
    this.popupKey = '';
    this.spotPopup.setLngLat([lon, lat]).setDOMContent(body).addTo(this.map);
    this.fitSpotPopup();
  }

  /**
   * The spot popup always opens above its point, centred on it. Near an edge the map slides until the whole popup is in the free part
   * of the screen: below the phone's search bar, clear of the side panel and the spot card, inside the sides.
   */
  private fitSpotPopup() {
    const el = this.spotPopup.getElement();
    if (!el) return;
    // the popup is not placed yet when it is added: work from its size and its point instead of where it is on screen
    const pt = this.map.project(this.spotPopup.getLngLat());
    const half = el.offsetWidth / 2;
    const r = { left: pt.x - half, right: pt.x + half, top: pt.y - 12 - el.offsetHeight };
    const desktop = window.matchMedia('(min-width: 900px)').matches;
    const w = window.innerWidth;
    const ins = this.deskInsets(16);
    const left = desktop ? ins.left : 8, right = desktop ? w - ins.right : w - 8, top = desktop ? 16 : 76;
    const dx = r.left < left ? left - r.left : r.right > right ? right - r.right : 0; // + = the popup has to move right
    const dy = r.top < top ? top - r.top : 0; // + = down
    if (dx || dy) this.map.panBy([-dx, -dy], { duration: 300, essential: true });
  }

  /** A click outside the scored area: say so for a moment instead of doing nothing. */
  private outsideNote(lat: number, lon: number) {
    this.popup.remove();
    this.popupKey = '';
    this.spotPopup.setLngLat([lon, lat]).setDOMContent(h('div.spot.spot-note', { role: 'status' }, h('b.spot-title', null, `Outside ${region()}`), h('p.price-hint', null, `Scores cover ${region()} only.`))).addTo(this.map);
    this.fitSpotPopup();
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => this.spotPopup.remove(), 2600);
  }
  private noteTimer: ReturnType<typeof setTimeout> | undefined;

  closePopups() { this.hideStation(true); this.spotPopup.remove(); }

  private hideStation(force = false) {
    if (!this.popupKey) return;
    if (!force && this.popupKey.endsWith('!')) return; // tapped popups stay until the next tap
    this.popupKey = '';
    this.popup.remove();
  }

  /** Re-apply everything driven by the store. */
  syncAll() {
    this.syncLines();
    this.syncLabels();
    this.syncCommuteMarkers();
    this.syncNotes();
    this.syncPriceLabels();
    this.syncBookmarks();
    this.syncPois();
    this.syncDistricts();
    this.syncSelection();
    this.syncEmphasis();
    this.syncHeat();
  }

  syncDistricts() {
    if (!this.ready) return;
    const v = store.p.showDistricts ? 'visible' : 'none';
    for (const id of ['district-casing', 'district-border', 'district-focus-casing', 'district-focus-border']) this.map.setLayoutProperty(id, 'visibility', v);
  }

  syncLines() {
    if (!this.ready) return;
    for (const m of MODES) {
      const v = store.p.lines[m] ? 'visible' : 'none';
      for (const id of [`lines-${m}`, `lines-casing-${m}`, `badge-${m}`]) this.map.setLayoutProperty(id, 'visibility', v);
    }
    // a station shows only if one of its own transit types is switched on
    const on = MODES.filter((m) => store.p.lines[m]);
    const anyOf = on.length ? (['any', ...on.map((m) => hasMode(m))] as maplibregl.FilterSpecification) : null;
    for (const [id, tier] of Object.entries(STATION_TIER_FILTER)) {
      this.map.setLayoutProperty(id, 'visibility', anyOf ? 'visible' : 'none');
      if (anyOf) this.map.setFilter(id, ['all', tier, anyOf] as maplibregl.FilterSpecification);
    }
  }

  syncLabels() {
    if (!this.ready) return;
    const v = store.p.showAreaNames ? 'visible' : 'none';
    this.map.setLayoutProperty('area-labels', 'visibility', v);
    this.map.setLayoutProperty('district-labels', 'visibility', v);
  }

  syncHeat(quiet = false) {
    if (!this.ready) return;
    if (!store.p.heatOn || store.t.focus) {
      this.overlay.setProps({ layers: [] });
      return;
    }
    const done = quiet ? () => {} : busy.start('Updating heatmap');
    const { ids } = this.ds.cells;
    const min = store.p.minScore;
    // while a spot is selected (or previewed) only its own area keeps full colour
    const sel = this.preview ?? store.t.selection;
    const selCell = sel ? this.ds.cellIndex.get(latLngToCell(sel.lat, sel.lon, this.ds.cells.res)) : undefined;
    const selArea = selCell != null ? this.ds.cells.area[selCell] : -1;
    const dimOthers = !!sel;
    const visible: number[] = [];
    const colors = new Uint8ClampedArray(this.engine.n * 4);
    const rentView = store.p.heat === 'price';
    for (let i = 0; i < this.engine.n; i++) {
      const v = this.engine.heat(i);
      if (v == null && rentView && !this.engine.rentLeftOut(i)) { // no rent in this zone yet: neutral grey, so the gaps stand out
        visible.push(i);
        colors.set([96, 108, 122, 150], i * 4);
        if (dimOthers && this.ds.cells.area[i] !== selArea) colors[i * 4 + 3] = 28;
        continue;
      }
      if (v == null || v < min) continue;
      visible.push(i);
      const c = rampRgba(this.engine.shadeFor(v));
      if (dimOthers && this.ds.cells.area[i] !== selArea) c[3] = Math.round(c[3] * 0.18);
      colors.set(c, i * 4);
    }
    this.version++;
    this.overlay.setProps({
      layers: [
        new H3HexagonLayer<number>({
          ...({ beforeId: 'hex-anchor' } as object),
          id: 'hex',
          data: visible,
          getHexagon: (d) => ids[d],
          getFillColor: (d) => colors.subarray(d * 4, d * 4 + 4) as unknown as [number, number, number, number],
          filled: true,
          extruded: false,
          stroked: false,
          pickable: false,
          opacity: store.p.heatOpacity,
          highPrecision: false,
          updateTriggers: { getFillColor: this.version },
        }),
      ],
    });
    // the pill stays until the map has painted the new field
    const timer = setTimeout(done, 4000);
    this.map.once('idle', () => { clearTimeout(timer); done(); });
    this.map.triggerRepaint();
  }

  syncSelection() {
    if (!this.ready) return;
    const sel = store.t.selection;
    this.markers.pin?.remove();
    this.markers.pin = null;
    if (!sel) {
      this.map.setFilter('area-selected', ['==', ['get', 'id'], '']);
      this.setRoutes([]);
      this.syncFocusFade();
      return;
    }
    const el = h('div.pin', null, h('span.pin-dot'), store.p.commute.length ? h('span.pin-tag', null, 'Start') : null);
    this.markers.pin = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([sel.lon, sel.lat]).addTo(this.map);
    this.syncFocusFade();
  }

  /** Show a spot's area as if it were selected (outline, dimmed rest, faded network and names, but no start pin) until cleared with null. Used while hovering a list entry. */
  setPreview(p: { lat: number; lon: number } | null) {
    if (!this.ready) return;
    if (this.preview?.lat === p?.lat && this.preview?.lon === p?.lon) return;
    this.preview = p;
    let areaId = '';
    if (p) {
      const cell = this.ds.cellIndex.get(latLngToCell(p.lat, p.lon, this.ds.cells.res));
      areaId = cell != null ? this.ds.areas.features[this.ds.cells.area[cell]].properties.id : '';
    }
    this.map.setFilter('area-preview', ['==', ['get', 'id'], areaId]);
    this.syncHeat(true);
    this.syncEmphasis();
    this.syncFocusFade();
  }

  setSelectedArea(id: string | null) {
    if (!this.ready) return;
    this.map.setFilter('area-selected', ['==', ['get', 'id'], id ?? '']);
  }

  /** Draw the best itinerary from the selected spot to each commute place. */
  setRoutes(routes: Route[]) {
    if (!this.ready) return;
    this.routeLines = [...new Set(routes.flatMap((r) => (r.legs ?? []).filter((l) => l.mode !== 'W' && l.name).map((l) => l.name)))];
    this.syncEmphasis();
    const features: GeoJSON.Feature[] = [];
    for (const r of routes) {
      for (const leg of r.legs ?? []) {
        if (leg.coords.length < 2) continue;
        const walk = leg.mode === 'W';
        const mode = leg.mode as Mode | string;
        const color = leg.color || (MODES.includes(mode as Mode) ? MODE_COLOR[mode as Mode] : '#5f6b78');
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: leg.coords }, properties: { walk: walk ? 1 : 0, color } });
      }
    }
    (this.map.getSource('route') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }

  syncCommuteMarkers() {
    if (!this.ready) return;
    this.markers.commute.forEach((m) => m.remove());
    this.markers.commute = store.p.commute.map((p, i) => {
      const el = h('div.cm', { title: p.name }, h('span.cm-n', null, String(i + 1)), h('span.cm-name', null, p.name));
      return new maplibregl.Marker({ element: el, anchor: 'left', offset: [-12, 0] }).setLngLat([p.lon, p.lat]).addTo(this.map);
    });
  }

  syncNotes() {
    if (!this.ready) return;
    this.markers.notes.forEach((m) => m.remove());
    this.markers.notes = [];
    if (!store.p.showNotes) return;
    const byId = new Map(this.ds.areas.features.map((f) => [f.properties.id, f.properties]));
    for (const [id, note] of Object.entries(store.p.notes)) {
      const p = byId.get(id);
      if (!p || !note.clean) continue;
      const el = h('div.note', { 'data-clean': note.clean },
        h('span.note-clean', null, note.clean === 'avg' ? 'Average' : note.clean === 'dirty' ? 'Dirty' : 'Clean'),
        h('span.note-name', null, p.name));
      this.markers.notes.push(new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -4] }).setLngLat(p.c).addTo(this.map));
    }
  }

  /** Permanent rent labels: one per planning area (the average of its reports). While the rent layer is on, districts still without a price get a "needs rent" tag. */
  syncPriceLabels() {
    if (!this.ready) return;
    this.markers.prices.forEach((m) => m.remove());
    this.markers.prices = [];
    this.priceEls = [];
    if (!store.p.showPrices) return;
    for (const c of this.engine.priceClusters) {
      const n = c.reports.length;
      const el = h('button.price-tag', { type: 'button', title: `Average rent${n > 1 ? ` of ${n} reports` : ''}, counts for all of ${this.engine.zones[c.zone].name}. Click to see or change.` },
        h('span.pt-main', null, fmtEuro(c.value * store.p.flatSize), n > 1 ? h('small', null, `×${n}`) : null),
        h('span.pt-sqm', null, fmtSqm(c.value)));
      el.addEventListener('click', (e) => { e.stopPropagation(); this.openPriceEditor(c); });
      this.markers.prices.push(new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -2] }).setLngLat([c.lon, c.lat]).addTo(this.map));
      this.priceEls.push({ el, zone: c.zone });
    }
    if (store.p.heat === 'price') this.addNeedTags();
    this.syncFocusFade();
  }

  private addNeedTags() {
    for (const d of this.engine.missingZones) {
      const el = h('button.need-tag', { type: 'button', title: `${d.name} has no rent yet. Click to add one.` }, h('b', null, d.name), 'needs rent');
      el.addEventListener('click', (e) => { e.stopPropagation(); this.askPrice(d); });
      this.markers.prices.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([d.lon, d.lat]).addTo(this.map));
      this.priceEls.push({ el, zone: this.engine.zones.indexOf(d) });
    }
  }

  /**
   * While a spot is hovered (list entry) or selected, only its own surroundings stay sharp: the district name and outline,
   * its planning-area names and its rent label. Everything else fades back.
   */
  syncFocusFade() {
    if (!this.ready) return;
    const p = this.preview ?? store.t.selection;
    const cell = p ? this.ds.cellIndex.get(latLngToCell(p.lat, p.lon, this.ds.cells.res)) : undefined;
    const district = cell != null ? this.ds.areas.features[this.ds.cells.area[cell]].properties.district : null;
    const zone = cell != null ? this.ds.cellZone[cell] : -1;
    const map = this.map;
    const sharpOnly = (prop: string, sharp: number, faded: number) => (district ? ['case', ['==', ['get', prop], district], sharp, faded] : sharp);
    map.setPaintProperty('district-labels', 'text-opacity', sharpOnly('name', 1, 0.15));
    map.setPaintProperty('area-labels', 'text-opacity', sharpOnly('district', 1, 0.15));
    map.setPaintProperty('district-casing', 'line-opacity', district ? 0.15 : 0.8);
    map.setPaintProperty('district-border', 'line-opacity', district ? 0.2 : 0.9);
    for (const id of ['district-focus-casing', 'district-focus-border']) map.setFilter(id, ['==', ['get', 'name'], district ?? '']);
    for (const t of this.priceEls) t.el.classList.toggle('faded', !!district && t.zone !== zone);
  }

  /** Landmarks as round photo pins; a click opens the name with a link to the article and the photo credit. */
  syncPois() {
    if (!this.ready) return;
    this.markers.pois.forEach((m) => m.remove());
    this.markers.pois = [];
    this.poiEls = [];
    if (!store.p.showPois) return;
    const wikiWidth = (u: string, w: number) => u.replace(/\/\d+px-/, `/${w}px-`);
    for (const p of this.ds.pois) {
      const img = h('img', { src: p.u, srcset: `${p.u} 60w, ${wikiWidth(p.u, 120)} 120w`, sizes: '40px', alt: '', loading: 'lazy', draggable: 'false' });
      // the big picture loads when the card is opened: the largest Commons size the original allows
      const sizes = [500, 960, 1280].filter((x) => x <= p.w);
      const big = h('img.poi-big', { alt: p.name, draggable: 'false', width: 320, height: 200 }) as HTMLImageElement;
      const card = h('span.poi-card', null,
        big,
        h('span.poi-text', null,
          h('a', { href: p.wiki, target: '_blank', rel: 'noopener' }, p.name),
          h('small', null, 'Photo: ', h('a', { href: p.page, target: '_blank', rel: 'noopener' }, `${p.by}, ${p.lic}`))));
      const el = h('div.poi', { 'data-rank': String(p.rank) },
        h('button.poi-pin', { type: 'button', 'aria-label': p.name, 'aria-expanded': 'false' }, img),
        h('span.poi-name', null, p.name), card);
      const pin = el.querySelector('.poi-pin') as HTMLElement;
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !el.classList.contains('open');
        document.querySelectorAll('.poi.open').forEach((x) => { x.classList.remove('open'); x.querySelector('.poi-pin')?.setAttribute('aria-expanded', 'false'); });
        el.classList.toggle('open', open);
        pin.setAttribute('aria-expanded', String(open));
        if (!open) return;
        if (!big.src) {
          big.srcset = (sizes.length ? sizes : [500]).map((x) => `${wikiWidth(p.u, x)} ${x}w`).join(', ');
          big.sizes = '320px';
          big.src = wikiWidth(p.u, sizes[0] ?? 500);
        }
        // keep the card on screen: open it above the pin, or below when the pin is near the top, and pan when it would hide under the panel
        const pt = this.map.project([p.lon, p.lat]);
        const hh = window.innerHeight;
        const desktop = window.matchMedia('(min-width: 900px)').matches;
        // only what is really open covers the map: the side panel and spot card on desktop, the menu or a spot card on a phone
        const covered = desktop || this.paneSheet > 0 || !!store.t.selection;
        if (covered) {
          const t = this.target();
          el.classList.toggle('below', pt.y < 290);
          if (pt.x < t.box.l + 180 || pt.x > t.box.r - 180 || pt.y < 90 || pt.y > hh - 60) this.map.panBy([pt.x - t.x, pt.y - (t.y + 90)]);
        } else {
          // nothing open on a phone: the whole screen is free, so the pin stays where it is unless the 320 px card would not fit around it
          const goal = { x: window.innerWidth / 2, y: Math.min(Math.max(pt.y, 300), hh - 60) };
          el.classList.toggle('below', goal.y < 290);
          if (Math.abs(pt.x - goal.x) > 6 || Math.abs(pt.y - goal.y) > 6) this.map.panBy([pt.x - goal.x, pt.y - goal.y], { duration: 300, essential: true });
        }
      });
      el.addEventListener('click', (e) => e.stopPropagation());
      this.markers.pois.push(new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -2] }).setLngLat([p.lon, p.lat]).addTo(this.map));
      this.poiEls.push({ el, p });
    }
    this.declutterPois();
  }

  /** Zoomed out, landmarks would pile up: the higher-ranked one stays, a pin that would cover it waits until there is room. */
  private declutterPois() {
    const zoom = this.map.getZoom();
    const minRank = zoom >= 12 ? 3 : zoom >= 10.8 ? 2 : 1;
    const kept: { x: number; y: number }[] = [];
    const gap = zoom >= 12 ? 50 : zoom >= 10.8 ? 48 : 54;
    for (const { el, p } of [...this.poiEls].sort((a, b) => a.p.rank - b.p.rank)) {
      if (p.rank > minRank) continue;
      const { x, y } = this.map.project([p.lon, p.lat]);
      const free = !kept.some((k) => Math.hypot(k.x - x, k.y - y) < gap);
      el.classList.toggle('poi-hidden', !free);
      if (free) kept.push({ x, y });
    }
  }

  /** Saved start spots, lettered A, B, C ... with their current overall score. */
  syncBookmarks() {
    if (!this.ready) return;
    this.markers.bookmarks.forEach((m) => m.remove());
    this.markers.bookmarks = store.p.bookmarks.map((b, i) => {
      const cell = this.ds.cellIndex.get(latLngToCell(b.lat, b.lon, this.ds.cells.res));
      const fit = cell == null ? -1 : this.engine.fit[cell];
      const el = h('button.bm', { type: 'button', title: `${b.name}: compare`, style: `--c:${BOOKMARK_COLORS[i % BOOKMARK_COLORS.length]}` },
        h('b.bm-letter', null, String.fromCharCode(65 + i)),
        h('span.bm-name', null, b.name),
        fit >= 0 ? h('i.bm-score', null, fit.toFixed(1)) : null);
      el.addEventListener('click', (e) => { e.stopPropagation(); this.closePopups(); this.actions?.start({ lat: b.lat, lon: b.lon }); });
      return new maplibregl.Marker({ element: el, anchor: 'left', offset: [-13, 0] }).setLngLat([b.lon, b.lat]).addTo(this.map);
    });
  }

  /**
   * Desktop: how far in from the left and right edge the map is covered, measured from the side panel (when it is open) and the spot card
   * (it opens with the selection), plus `gap`. The camera moves put things in what is left, so a closed panel gives its room back.
   */
  private deskInsets(gap: number) {
    const panel = document.querySelector<HTMLElement>('aside.panel');
    const card = document.querySelector<HTMLElement>('aside.detail');
    const left = store.p.panelCollapsed || !panel ? 60 : Math.round(panel.getBoundingClientRect().right) + gap;
    const right = store.t.selection ? (card?.offsetWidth || 380) + 12 + gap : 60;
    return { left, right };
  }

  /** Pixel the selected spot should sit at: clear of the side panel, detail card and bottom sheet. */
  private target() {
    const w = window.innerWidth, hh = window.innerHeight;
    if (window.matchMedia('(min-width: 900px)').matches) {
      const ins = this.deskInsets(24);
      const l = store.p.panelCollapsed ? 12 : ins.left - 24, r = w - ins.right;
      const b = hh - 60 - this.paneSheet; // the compare dock covers the bottom
      return { x: (l + Math.max(l + 200, r)) / 2, y: this.paneSheet ? (60 + b) / 2 : hh / 2, box: { l: l + 24, r: Math.max(l + 224, r), t: 60, b } };
    }
    const sheetTop = hh * 0.54 - 76;
    return { x: w / 2, y: (110 + sheetTop) / 2, box: { l: 24, r: w - 24, t: 120, b: sheetTop - 24 } };
  }

  /** Pan only if the spot would be hidden behind UI. */
  reveal(lat: number, lon: number) {
    const t = this.target();
    const p = this.map.project([lon, lat]);
    if (p.x >= t.box.l && p.x <= t.box.r && p.y >= t.box.t && p.y <= t.box.b) return;
    this.sheetShift = 0;
    this.sheetRestore = null;
    this.map.easeTo({ center: [lon, lat], offset: [t.x - window.innerWidth / 2, t.y - window.innerHeight / 2], duration: 450, essential: true });
  }

  flyTo(lat: number, lon: number, zoom = 14) {
    this.sheetShift = 0;
    this.sheetRestore = null;
    const t = this.target();
    this.map.flyTo({
      center: [lon, lat],
      zoom: Math.max(this.map.getZoom(), zoom),
      offset: [t.x - window.innerWidth / 2, t.y - window.innerHeight / 2],
      duration: 700,
      essential: true,
    });
  }

  /** Light only the given lines (a station focus or the routes of a selected spot); null restores everything. */
  syncEmphasis() {
    if (!this.ready) return;
    const focus = store.t.focus;
    const names = focus ? focus.lines : store.t.selection && this.routeLines.length ? this.routeLines : null;
    const lit = names ? (['in', ['get', 'name'], ['literal', names]] as maplibregl.ExpressionSpecification) : null;
    const map = this.map;
    // hovering a list entry quietens the whole transit network (unless a station or the routes of a spot are lit)
    const quiet = !lit && !!this.preview;
    for (const m of MODES) {
      map.setPaintProperty(`lines-${m}`, 'line-opacity', lit ? ['case', lit, 1, 0.12] : quiet ? 0.2 : 1);
      map.setPaintProperty(`lines-casing-${m}`, 'line-opacity', lit ? ['case', lit, 0.95, 0.1] : quiet ? 0.15 : 0.95);
      map.setFilter(`badge-${m}`, lit ? ['all', ['==', ['get', 'mode'], m], lit] : ['==', ['get', 'mode'], m]);
      map.setPaintProperty(`badge-${m}`, 'text-opacity', quiet ? 0.2 : 1);
    }
    const stationLit = names && names.length ? (['any', ...names.map((n) => ['in', `"${n}"`, ['get', 'lines']])] as maplibregl.ExpressionSpecification) : null;
    const stationBase = quiet ? 0.2 : 1;
    for (const id of STATION_LAYERS) {
      map.setPaintProperty(id, 'circle-opacity', stationLit ? ['case', stationLit, 1, 0] : stationBase);
      map.setPaintProperty(id, 'circle-stroke-opacity', stationLit ? ['case', stationLit, 1, 0] : stationBase);
    }
    for (const id of ['st-major-label', 'st-rail-label', 'st-tram-label']) map.setPaintProperty(id, 'text-opacity', stationLit ? ['case', stationLit, 1, 0] : stationBase);
    const focusLines = focus ? this.ds.lines.features.filter((f) => focus.lines.includes(f.properties.name)) : [];
    (map.getSource('focus') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: focusLines as GeoJSON.Feature[] });
  }

  clearStationPopup() { this.hideStation(true); }

  /** Show the selected spot together with every commute place. */
  fitSpot(lat: number, lon: number) {
    const bounds = new maplibregl.LngLatBounds([lon, lat], [lon, lat]);
    for (const p of store.p.commute) bounds.extend([p.lon, p.lat]);
    this.cameraByUser = false;
    this.fitTo(bounds, 0);
  }

  /**
   * The routes have arrived: fit the whole of them, not only the spot and the commute places, which a route may leave far behind
   * (it can run around the city). Not when the visitor has moved the map since the spot was selected: that is theirs to keep.
   */
  fitRoutes(routes: Route[]) {
    const sel = store.t.selection;
    if (!sel || this.cameraByUser) return;
    const bounds = new maplibregl.LngLatBounds([sel.lon, sel.lat], [sel.lon, sel.lat]);
    for (const p of store.p.commute) bounds.extend([p.lon, p.lat]);
    for (const r of routes) for (const leg of r.legs ?? []) for (const c of leg.coords) bounds.extend(c);
    this.fitTo(bounds, 24);
  }

  /** `extra` px of room around the bounds on top of what the panels, the spot card and the compare dock cover. */
  private fitTo(bounds: maplibregl.LngLatBounds, extra: number) {
    const desktop = window.matchMedia('(min-width: 900px)').matches;
    const hh = window.innerHeight;
    this.sheetShift = desktop ? 0 : this.detailShift();
    this.sheetRestore = null;
    // desktop: the compare dock covers the bottom (paneSheet), so everything must fit above it; keep some height for the fit
    const bottom = Math.min(90 + this.paneSheet, Math.max(60, hh - 80 - 160));
    const e = extra, ins = this.deskInsets(26);
    this.map.fitBounds(bounds, {
      padding: desktop
        ? { top: 80 + e, bottom: bottom + e, left: ins.left + e, right: ins.right + e }
        : { top: 130 + e, bottom: Math.round(hh * 0.46) + 96 + e, left: 36 + e, right: 36 + e },
      maxZoom: 14,
      duration: 700,
      essential: true,
    });
  }
  /** the visitor dragged or zoomed the map since the last fit; set by their own gestures only */
  private cameraByUser = false;

  resize() { this.map.resize(); }
}
