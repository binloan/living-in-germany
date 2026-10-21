import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js';
import { commuteMinutes, type CommuteTimes } from './api';
import { busy } from './busy';
import { NONE, commuteScoreOf, pickTop, priceScoreOf, shade, shadeRange, weightedFit, type ShadeRange } from './scoring';

export { PRICE_BEST, PRICE_WORST, commuteScoreOf, priceScoreOf } from './scoring';
import type { Dataset } from './data';
import { store } from './store';
import type { CommutePoint, PricePoint } from './types';

const UNREACHABLE_MIN = 120;
/** Top matches are at least this far apart, so they are different neighbourhoods. */
const TOP_SEPARATION_M = 1500;

/** The reports of one price zone, averaged. */
export interface PriceCluster {
  zone: number;
  lat: number;
  lon: number;
  /** average of the reports */
  value: number;
  reports: PricePoint[];
}
/** A price zone: the area one average rent counts for (a district, a neighbourhood). */
export interface ZoneInfo {
  name: string;
  /** the district the zone belongs to */
  parent: string;
  lat: number;
  lon: number;
  /** no published rent exists for this area: it does not hold the rent score back */
  exempt: boolean;
}

export type CommuteStatus = 'loading' | 'ok' | 'error';

export interface AreaRank {
  index: number; // index into ds.areas.features of the area the spot lies in
  score: number; // fit of the spot's hex
  cells: number;
  bestCell: number; // cell index of the spot
  used: number; // metrics behind the spot
}

export class Engine {
  readonly n: number;
  /** overall fit 0..100, NONE (-1) when no enabled metric has data */
  fit: Float32Array;
  used: Uint8Array;
  /** where the overall scores lie: only the colours are stretched over it, never the numbers */
  private range: ShadeRange | null = null;
  /** weighted mean commute minutes (clock time), NONE when no point loaded */
  commuteMin: Float32Array;
  /** weighted mean commute minutes with transfer penalty, NONE when no point loaded */
  commuteEff: Float32Array;
  commuteScore: Float32Array;
  /** rent in EUR per m² interpolated from the reported prices, NONE where its district has none */
  priceVal: Float32Array;
  priceScore: Float32Array;
  totalMetrics = 0;
  readonly status = new Map<string, CommuteStatus>();
  private times = new Map<string, CommuteTimes>();
  private listeners = new Set<() => void>();
  private nb: Int32Array[] | null = null;
  private priceAny = false;
  /** every price zone with a point that lies inside it */
  readonly zones: ZoneInfo[];
  private zoneIdx: Uint16Array;
  priceClusters: PriceCluster[] = [];
  /** zones that still need a price (and can have one) */
  missingZones: ZoneInfo[] = [];

  constructor(private ds: Dataset) {
    this.n = ds.cells.ids.length;
    this.fit = new Float32Array(this.n).fill(NONE);
    this.used = new Uint8Array(this.n);
    this.commuteMin = new Float32Array(this.n).fill(NONE);
    this.commuteEff = new Float32Array(this.n).fill(NONE);
    this.commuteScore = new Float32Array(this.n).fill(NONE);
    this.priceVal = new Float32Array(this.n).fill(NONE);
    this.priceScore = new Float32Array(this.n).fill(NONE);
    this.zones = ds.zones.map((z) => ({ name: z.name, parent: z.district, lon: z.c[0], lat: z.c[1], exempt: !!z.exempt }));
    this.zoneIdx = ds.cellZone;
    store.subscribe((c) => { if (c.has('prices')) this.syncPrices(); else if (c.has('flatSize')) this.emit(); });
    this.syncPrices(false);
  }

  onChange(fn: () => void) { this.listeners.add(fn); }
  private emit() { for (const l of this.listeners) l(); }

  /** Metrics that can ever produce a value right now. */
  activeMetrics() {
    return this.ds.metrics.filter((m) => !m.missing && !m.overlay && store.isOn(m.id) && (store.p.weights[m.id] ?? 0) > 0 && (!m.dynamic || this.ready(m.id)));
  }
  hasCommute() { return store.p.commute.some((p) => this.times.has(p.id)); }
  /** The price zone a point lies in, null outside the city. */
  zoneAt(lat: number, lon: number): ZoneInfo | null {
    const i = this.ds.cellIndex.get(latLngToCell(lat, lon, this.ds.cells.res));
    return i == null ? null : this.zones[this.zoneIdx[i]];
  }
  /** Whether a cell lies in a zone left out of the rent layer (no published rent exists there). */
  rentLeftOut(i: number) { return this.zones[this.zoneIdx[i]].exempt; }
  /** Rent per m² of a cell, null where its zone has no price. */
  sqmRent(i: number) { const v = this.priceVal[i]; return v === NONE ? null : v; }
  /** At least one district has a rent. */
  hasPrice() { return this.priceAny; }
  /** Whether a metric that depends on user input counts in the overall score: commute needs a place, rent needs a price in EVERY zone that has a published one (else it would favour the ones with one). */
  ready(id: string) { return id === 'commute' ? this.hasCommute() : id === 'price' ? this.priceAny && this.missingZones.length === 0 : true; }
  /** Whether a metric has anything to show (rent: even before it counts in the score). */
  shown(id: string) { return id === 'commute' ? this.hasCommute() : id === 'price' ? this.hasPrice() : true; }

  private dynScores(id: string) { return id === 'commute' ? this.commuteScore : this.priceScore; }

  score(metricId: string, i: number): number | null {
    if (metricId === 'commute' || metricId === 'price') {
      const v = this.dynScores(metricId)[i];
      return v === NONE ? null : v;
    }
    return this.ds.cells.m[metricId]?.s[i] ?? null;
  }

  rawValue(metricId: string, i: number): number | null {
    if (metricId === 'commute' || metricId === 'price') {
      const v = (metricId === 'commute' ? this.commuteMin : this.priceVal)[i];
      // rent is kept per m² internally and shown as the monthly rent of the flat the user expects
      return v === NONE ? null : metricId === 'price' ? v * store.p.flatSize : v;
    }
    return this.ds.cells.m[metricId]?.raw[i] ?? null;
  }

  /** Colour position (0..100) for a value of the current heat layer: the overall score is stretched over the spread of the city, metric scores are used as they are. */
  shadeFor(v: number) { return this.heatId() === 'fit' ? shade(v, this.range) : v; }
  /** Colour position of an overall score. */
  shade(v: number) { return shade(v, this.range); }
  /** The layer the map shows: the overall score or a metric id. */
  heatId() {
    const id = store.p.heat;
    if (id !== 'fit' && (id === 'price' ? false : this.ds.metrics.find((m) => m.id === id)?.dynamic ? !this.ready(id) : !this.ds.cells.m[id])) return 'fit'; // layer that no longer exists
    return id;
  }

  /** Value shown on the heat layer for the current selection. */
  heat(i: number): number | null {
    const id = this.heatId();
    if (id === 'fit') { const v = this.fit[i]; return v === NONE ? null : v; }
    return this.score(id, i);
  }

  recompute() {
    const { weights } = store.p;
    const active = this.activeMetrics().map((m) => ({ w: weights[m.id] ?? 0, s: m.dynamic ? this.dynScores(m.id) : this.ds.cells.m[m.id]?.s ?? [] }));
    this.totalMetrics = active.length;
    const { fit, used } = weightedFit(active, this.n);
    this.fit = fit;
    this.used = used;
    this.range = shadeRange(this.fit);
    this.emit();
  }

  /** Hexes within two rings (about 0.9 km across) of every hex, itself included. */
  private neighbours(): Int32Array[] {
    if (!this.nb) {
      const { ids } = this.ds.cells;
      this.nb = ids.map((id) => Int32Array.from(gridDisk(id, 2).map((h) => this.ds.cellIndex.get(h)).filter((x): x is number => x != null)));
    }
    return this.nb;
  }

  /**
   * Best spots for the current priorities: the highest-scoring hexes, one per neighbourhood (at least TOP_SEPARATION_M apart).
   * Ranked by the hex score, the number the map and the spot card show, so what looks best on the map leads the list in
   * big neighbourhoods as well as small planning areas (a mean over an area would sink the big ones).
   * Ties (many hexes sit at 100) go to the better surrounding.
   */
  topAreas(count = 5): AreaRank[] {
    const nb = this.neighbours();
    const district = (i: number) => this.ds.areas.features[this.ds.cells.area[i]].properties.district;
    return pickTop(this.fit, nb, (i) => cellToLatLng(this.ds.cells.ids[i]), count, TOP_SEPARATION_M, district)
      .map(({ i, v }) => ({ index: this.ds.cells.area[i], score: v, cells: nb[i].length, bestCell: i, used: this.used[i] }));
  }

  private combineCommute() {
    const pts = store.p.commute.filter((p) => this.times.has(p.id));
    if (!pts.length) {
      this.commuteMin.fill(NONE);
      this.commuteEff.fill(NONE);
      this.commuteScore.fill(NONE);
      return;
    }
    let wsum = 0;
    for (const p of pts) wsum += p.share;
    const even = wsum <= 0;
    for (let i = 0; i < this.n; i++) {
      let acc = 0, eff = 0;
      for (const p of pts) {
        const t = this.times.get(p.id)!;
        const w = even ? 1 / pts.length : p.share / wsum;
        const unreachable = t.minutes[i] < 0;
        const m = unreachable ? UNREACHABLE_MIN : t.minutes[i];
        acc += w * m;
        eff += w * (m + (unreachable ? 0 : t.transferMin * t.transfers[i]));
      }
      this.commuteMin[i] = acc;
      this.commuteEff[i] = eff;
      this.commuteScore[i] = commuteScoreOf(eff);
    }
  }

  /** Rent per cell: the average of the reports in its price zone (an Ortsteil or Stadtteil). */
  syncPrices(recompute = true) {
    // 1. reports -> one averaged price per zone
    const byZone = new Map<number, PriceCluster>();
    for (const p of store.t.prices) {
      const cell = this.ds.cellIndex.get(latLngToCell(p.lat, p.lon, this.ds.cells.res));
      if (cell == null) continue;
      const zone = this.zoneIdx[cell];
      const c = byZone.get(zone) || byZone.set(zone, { zone, lat: 0, lon: 0, value: 0, reports: [] }).get(zone)!;
      c.reports.push(p);
    }
    this.priceClusters = [...byZone.values()].map((c) => {
      const n = c.reports.length;
      return { ...c, lat: c.reports.reduce((x, r) => x + r.lat, 0) / n, lon: c.reports.reduce((x, r) => x + r.lon, 0) / n, value: c.reports.reduce((x, r) => x + r.value, 0) / n };
    });
    // 2. which zones still have no price
    this.missingZones = this.zones.filter((z, k) => !byZone.has(k) && !z.exempt);
    this.priceAny = byZone.size > 0;
    // 3. per cell
    const avg = new Map(this.priceClusters.map((c) => [c.zone, c.value]));
    for (let i = 0; i < this.n; i++) {
      const v = avg.get(this.zoneIdx[i]);
      if (v == null) { this.priceVal[i] = NONE; this.priceScore[i] = NONE; continue; }
      this.priceVal[i] = v;
      this.priceScore[i] = priceScoreOf(v);
    }
    if (recompute) this.recompute();
    else this.emit();
  }

  /** Clock minutes from a cell to one pinned place (null until loaded or unreachable). */
  minutesTo(id: string, i: number): number | null {
    const m = this.times.get(id)?.minutes[i];
    return m == null || m < 0 ? null : m;
  }

  transfersTo(id: string, i: number): number | null {
    const t = this.times.get(id);
    if (!t || t.minutes[i] < 0) return null;
    return t.transfers[i];
  }

  /** Reconcile fetched data with the current point list. */
  async syncCommute() {
    const ids = new Set(store.p.commute.map((p) => p.id));
    for (const k of [...this.times.keys()]) if (!ids.has(k)) this.times.delete(k);
    for (const k of [...this.status.keys()]) if (!ids.has(k)) this.status.delete(k);
    this.combineCommute();
    this.recompute();
    const todo = store.p.commute.filter((p) => !this.times.has(p.id) && this.status.get(p.id) !== 'loading');
    await Promise.all(todo.map((p) => this.load(p)));
  }

  /** Recompute scores after a share change (no refetch). */
  refresh() {
    this.combineCommute();
    this.recompute();
  }

  private async load(p: CommutePoint) {
    this.status.set(p.id, 'loading');
    this.emit();
    const done = busy.start(`Loading commute times to ${p.name}`);
    try {
      const r = await commuteMinutes(p.lat, p.lon);
      if (!store.p.commute.some((q) => q.id === p.id)) return;
      this.times.set(p.id, r);
      this.status.set(p.id, 'ok');
    } catch {
      this.status.set(p.id, 'error');
    } finally {
      done();
    }
    this.combineCommute();
    this.recompute();
  }

  retry(id: string) {
    this.status.delete(id);
    void this.syncCommute();
  }
}
