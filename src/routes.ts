import { route, type Route } from './api';
import { busy } from './busy';
import type { MapView } from './map';
import type { Dataset } from './data';
import { store } from './store';
import { debounce } from './util';

export type RouteState = Route | 'loading' | 'error';

/** Best itinerary from the selected spot to every commute place, drawn on the map while a spot is selected. */
export class Routes {
  private data = new Map<string, RouteState>();
  private listeners = new Set<() => void>();
  private seq = 0;

  constructor(private view: MapView, private ds: Dataset) {}

  onChange(fn: () => void) { this.listeners.add(fn); }
  private emit() { for (const l of this.listeners) l(); }

  get(id: string): RouteState | undefined { return this.data.get(id); }

  /** Call when the selection or the commute places change. */
  update = debounce(() => this.run(), 350);

  private run() {
    const my = ++this.seq;
    const sel = store.t.selection;
    const pts = store.p.commute;
    this.data.clear();
    if (!sel || !pts.length) {
      this.view.setRoutes([]);
      this.emit();
      return;
    }
    for (const p of pts) this.data.set(p.id, 'loading');
    this.view.setRoutes([]);
    this.emit();
    const done = busy.start('Finding commute routes');
    let left = pts.length;
    for (const p of pts) {
      route(sel, p)
        .then((r) => { if (my === this.seq) this.data.set(p.id, r); })
        .catch(() => { if (my === this.seq) this.data.set(p.id, 'error'); })
        .finally(() => {
          if (my === this.seq) {
            this.draw();
            this.emit();
          }
          if (--left === 0) {
            done();
            if (my === this.seq) this.view.fitRoutes(this.drawn());
          }
        });
    }
  }

  /** The routes that have arrived, in the order of the commute places. */
  private drawn() {
    const routes: Route[] = [];
    for (const p of store.p.commute) {
      const r = this.data.get(p.id);
      if (r && r !== 'loading' && r !== 'error') routes.push(r);
    }
    return routes;
  }

  private draw() { this.view.setRoutes(this.drawn()); }
}
