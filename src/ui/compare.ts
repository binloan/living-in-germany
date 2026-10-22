import { latLngToCell } from 'h3-js';
import { icon, type IconName } from '../icons';
import { BOOKMARK_COLORS, MAX_BOOKMARKS, stationNear } from '../place';
import { store } from '../store';
import type { Metric } from '../types';
import { clear, fmtInt, fmtMetric, h, raf } from '../util';
import { chip } from './chip';
import type { Ctx } from './ctx';

interface Detail {
  /** label and value pairs shown when the cell is opened */
  lines: [string, string][];
  note?: string;
}
interface Cell {
  /** 0..100, null without data */
  score: number | null;
  /** colour position when it differs from the score (overall score), digits after the point */
  shade?: number;
  decimals?: number;
  detail: Detail;
}
interface Row {
  label: string;
  /** phone: the row is told by its icon */
  icon: IconName;
  hint?: string;
  weight?: number;
  kind?: 'overall' | 'metric';
  off?: boolean;
  cells: Cell[];
}
type Spot = { id: string; name: string; sub?: string; lat: number; lon: number; i: number | null };

const METRIC_ICON: Record<string, IconName> = {
  transit_access: 'train', commute: 'route', center: 'crosshair', price: 'euro', safety: 'shield', calm: 'volumeOff',
  perceived_safety: 'shield', building_age: 'building', density: 'users', wohnlage: 'home', amenities: 'bag', restaurants: 'restaurant', landmarks: 'landmark',
};

/** Side-by-side scores of the saved start spots. Click a score for the value behind it. */
export function buildCompare(ctx: Ctx, pane: HTMLElement) {
  const { ds, engine } = ctx;
  const head = h('div.pane-title', null, h('h2', null, 'Compare'));
  const hint = h('p.pane-hint');
  const saveBtn = h('button.btn.cmp-btn', { type: 'button' }) as HTMLButtonElement;
  const err = h('p.price-err', { hidden: true, role: 'alert' });
  const body = h('div.cmp-wrap');
  pane.append(head, hint, h('div.row', null, saveBtn), err, body);

  // desktop: the table moves to a dock across the bottom of the screen, spots as rows and priorities as columns
  const wide = window.matchMedia('(min-width: 900px)');
  const dockBody = h('div.cmp-dock-body');
  const dockHint = h('p.muted');
  const dockSave = h('button.btn.cmp-btn', { type: 'button', onclick: () => saveBtn.click() }) as HTMLButtonElement;
  const dock = h('section.cmp-dock', { hidden: true, 'aria-label': 'Compare spots' },
    h('header', null,
      h('h2', null, 'Compare'),
      dockHint,
      dockSave,
      h('button.icon-btn', { type: 'button', 'aria-label': 'Close compare', onclick: () => store.setT({ dock: false }) }, icon('x'))),
    dockBody);
  // the way to the comparison: bottom centre of the map on desktop (the dock opens), just above the toolbar on a phone (the sheet opens)
  const reopenCount = h('b.count');
  const reopen = h('button.cmp-reopen', { type: 'button', 'aria-label': 'Open the comparison', onclick: () => store.setT(wide.matches ? { dock: true } : { pane: 'compare' }) }, icon('compare'), h('span', null, 'Compare'), reopenCount) as HTMLButtonElement;
  const syncDock = () => {
    dock.hidden = !(wide.matches && store.t.dock);
    const n = store.p.bookmarks.length;
    // desktop: while the dock is closed; phone: while no sheet or spot card covers that part of the screen
    const free = wide.matches ? dock.hidden : !store.t.pane && !store.t.layers && !store.t.selection;
    reopen.hidden = !n || !free;
    reopenCount.textContent = String(n);
  };
  // the map and the other floating elements make room for the dock
  new ResizeObserver(() => {
    const px = dock.hidden ? 0 : Math.round(dock.getBoundingClientRect().height) + 12;
    document.documentElement.style.setProperty('--dock-h', `${px}px`);
    if (wide.matches) ctx.view.setSheet(px);
  }).observe(dock);

  saveBtn.addEventListener('click', () => {
    const sel = store.t.selection;
    if (!sel) return;
    const e = ctx.toggleBookmark(sel.lat, sel.lon);
    err.textContent = e ?? '';
    err.hidden = !e;
  });

  // ---------- value detail: a small card next to the clicked score
  const pop = h('div.cmp-pop', { role: 'dialog', hidden: true });
  document.body.append(pop);
  let openCell: HTMLElement | null = null;

  function closePop() {
    pop.hidden = true;
    if (openCell) { openCell.classList.remove('open'); openCell.setAttribute('aria-expanded', 'false'); }
    openCell = null;
  }

  function placePop(anchor: HTMLElement) {
    const a = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, ph = pop.offsetHeight;
    const left = Math.max(12, Math.min(a.left + a.width / 2 - w / 2, innerWidth - w - 12));
    const below = a.bottom + 8 + ph <= innerHeight - 12;
    const top = below ? a.bottom + 8 : Math.max(12, a.top - 8 - ph);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  const spotHead = (spot: Spot, k: number) =>
    h('div.pop-head', { style: `--c:${BOOKMARK_COLORS[k % BOOKMARK_COLORS.length]}` }, h('b.bm-letter', null, String.fromCharCode(65 + k)), h('span', null, spot.name));
  const dl = (lines: [string, string][]) => lines.length ? [h('dl', null, ...lines.flatMap(([a, b]) => [h('dt', null, a), h('dd', null, b)]))] : [];

  /** the value behind one score */
  const cellCard = (spot: Spot, k: number, row: Row, c: Cell) => [
    spotHead(spot, k),
    h('div.pop-main', null, h('span.pop-metric', null, row.label), chip(c.score, c.shade, c.decimals)),
    ...dl(c.detail.lines),
    ...(c.detail.note ? [h('p.pop-note', null, c.detail.note)] : []),
  ];
  /** phone: a column is only a letter, so its card tells which place it is */
  const spotCard = (spot: Spot, k: number) => [
    spotHead(spot, k),
    ...(spot.sub ? [h('p.pop-note', null, spot.sub)] : []),
    h('div.pop-actions', null,
      h('button.btn', { type: 'button', onclick: () => { closePop(); ctx.select(spot.lat, spot.lon, true); } }, icon('pin'), 'Map'),
      h('button.btn', { type: 'button', onclick: () => { closePop(); ctx.toggleBookmark(spot.lat, spot.lon); } }, icon('trash'), 'Remove')),
  ];
  /** phone: a row is only an icon, so its card tells which priority it is */
  const rowCard = (row: Row) => [
    h('div.pop-main', null, h('span.pop-metric', null, row.label), ...(row.weight != null ? [h('span.pop-weight', null, row.off ? 'off' : `weight ${row.weight}`)] : [])),
    ...(row.hint ? [h('p.pop-note', null, row.hint)] : []),
  ];

  function togglePop(anchor: HTMLElement, nodes: Node[]) {
    if (openCell === anchor) { closePop(); return; }
    closePop();
    clear(pop);
    pop.append(...nodes);
    pop.hidden = false;
    anchor.classList.add('open');
    anchor.setAttribute('aria-expanded', 'true');
    openCell = anchor;
    placePop(anchor);
  }
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (openCell && !pop.contains(t) && !openCell.contains(t)) closePop();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openCell) closePop(); });
  window.addEventListener('scroll', (e) => { if (openCell && !pop.contains(e.target as Node)) closePop(); }, true);
  window.addEventListener('resize', closePop);

  // ---------- the rows: the same priorities, in the same order, as the Priorities tab
  const transferText = (n: number | null) => (n == null ? '' : n === 0 ? 'direct' : n === 1 ? '1 transfer' : `${n} transfers`);
  const noData = (note: string): Cell => ({ score: null, detail: { lines: [], note } });

  function metricCell(m: Metric, spot: Spot): Cell {
    const i = spot.i;
    if (i == null) return noData('Outside the mapped area.');
    if (m.dynamic && !engine.ready(m.id)) return noData('Not counted yet.');
    const s = engine.score(m.id, i);
    if (s == null) return noData('No data for this spot.');
    const raw = engine.rawValue(m.id, i);
    const lines: [string, string][] = [];
    const proxyMetric = raw == null && m.proxy ? ds.metrics.find((x) => x.id === m.proxy!.metric) : undefined;
    if (proxyMetric) lines.push([`Estimate from ${proxyMetric.label}`, `≈ ${fmtMetric(proxyMetric, engine.rawValue(proxyMetric.id, i))}`]);
    else lines.push([m.id === 'commute' ? 'Average' : 'Value', fmtMetric(m, raw)]);
    if (m.id === 'commute') {
      for (const p of store.p.commute) {
        const min = engine.minutesTo(p.id, i);
        if (min != null) lines.push([`to ${p.name}`, [`${Math.round(min)} min`, transferText(engine.transfersTo(p.id, i))].filter(Boolean).join(', ')]);
      }
    }
    if (m.id === 'transit_access') {
      const st = stationNear(ds, spot.lat, spot.lon, 1600);
      lines.push(['Nearest station', st ? `${st.name}, ${fmtInt(Math.round(st.d / 10) * 10)} m` : 'none within 1.6 km']);
    }
    return { score: s, detail: { lines, note: m.hint } };
  }

  function rowsFor(spots: Spot[]): Row[] {
    const rows: Row[] = [{
      label: 'Overall Score', kind: 'overall', icon: 'star', hint: 'A weighted mix of your priorities.',
      cells: spots.map(({ i }) => {
        const v = i == null ? -1 : engine.fit[i];
        return v < 0 ? noData('No data for this spot.') : { score: v, shade: engine.shade(v), decimals: 1, detail: { lines: [], note: 'A weighted mean of your priorities.' } };
      }),
    }];
    for (const m of ds.metrics) {
      if (m.overlay || m.missing) continue;
      if (m.id === 'commute' && !store.p.commute.length) continue; // no place yet: a column of dashes says nothing
      const off = !store.isOn(m.id) || (store.p.weights[m.id] ?? 0) <= 0 || (m.dynamic && !engine.ready(m.id));
      rows.push({ label: m.label, kind: 'metric', icon: METRIC_ICON[m.id] ?? 'pin', hint: m.hint, weight: store.p.weights[m.id] ?? 0, off, cells: spots.map((sp) => metricCell(m, sp)) });
    }
    return rows;
  }

  function scoreCell(spot: Spot, k: number, row: Row, c: Cell, best: boolean) {
    const el = h('button.cmp-cell', {
      type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'data-kind': row.kind ?? 'metric', 'data-off': String(!!row.off), 'data-best': String(best),
      'aria-label': `${spot.name}, ${row.label}: ${c.score == null ? 'no data' : fmtInt(c.score)}. Show details`,
      onclick: () => togglePop(el, cellCard(spot, k, row, c)),
    }, chip(c.score, c.shade, c.decimals)) as HTMLButtonElement;
    return el;
  }

  /** the best score of each priority gets a ring; none when all are equal */
  const bestOf = (row: Row) => {
    const v = row.cells.map((c) => c.score).filter((x): x is number => x != null);
    return v.length > 1 && Math.max(...v) > Math.min(...v) ? Math.max(...v) : null;
  };

  function spotCell(b: Spot, k: number, tag: string) {
    return h(tag, { style: `--c:${BOOKMARK_COLORS[k % BOOKMARK_COLORS.length]}` },
      h('button.cmp-pick', { type: 'button', title: 'Show on map', onclick: () => ctx.select(b.lat, b.lon, true) },
        h('b.bm-letter', null, String.fromCharCode(65 + k)),
        h('span.cmp-spot-text', null, h('span.cmp-name', null, b.name), b.sub ? h('small', null, b.sub) : null)),
      h('button.icon-btn.cmp-x', { type: 'button', 'aria-label': `Remove ${b.name}`, onclick: () => ctx.toggleBookmark(b.lat, b.lon) }, icon('x')));
  }

  /** desktop: a row per spot, a column per priority */
  function renderWide(spots: Spot[]) {
    const rows = rowsFor(spots);
    const grid = h('div.cmp.cmp-t', { style: `grid-template-columns:180px repeat(${rows.length}, minmax(58px,1fr))` });
    grid.append(h('div.cmp-corner'));
    for (const row of rows) grid.append(h('div.cmp-colhead', { 'data-kind': row.kind ?? 'metric', 'data-off': String(!!row.off) }, row.label));
    const tops = rows.map(bestOf);
    spots.forEach((b, k) => {
      grid.append(spotCell(b, k, 'div.cmp-spot'));
      rows.forEach((row, r) => grid.append(scoreCell(b, k, row, row.cells[k], tops[r] != null && row.cells[k].score === tops[r])));
    });
    return grid;
  }

  /** phone: a row per priority, a column per spot */
  function renderNarrow(spots: Spot[]) {
    const grid = h('div.cmp', { 'data-many': String(spots.length > 3), style: `grid-template-columns:var(--cmp-label) repeat(${spots.length}, minmax(0, 1fr))` });
    grid.append(h('div.cmp-head.cmp-corner'));
    spots.forEach((b, k) => {
      const el = h('button.cmp-letter', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': `${b.name}. Show details`, onclick: () => togglePop(el, spotCard(b, k)) },
        h('b.bm-letter', null, String.fromCharCode(65 + k))) as HTMLButtonElement;
      grid.append(h('div.cmp-head', { style: `--c:${BOOKMARK_COLORS[k % BOOKMARK_COLORS.length]}` }, el));
    });
    for (const row of rowsFor(spots)) {
      const top = bestOf(row);
      const lab = h('button.cmp-label', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'data-kind': row.kind ?? 'metric', 'data-off': String(!!row.off), 'aria-label': row.label, title: row.label, onclick: () => togglePop(lab, rowCard(row)) }, icon(row.icon), h('span.cmp-lab-txt', null, row.label)) as HTMLButtonElement;
      grid.append(lab);
      spots.forEach((b, k) => grid.append(scoreCell(b, k, row, row.cells[k], top != null && row.cells[k].score === top)));
    }
    return grid;
  }

  function render() {
    closePop();
    const bms = store.p.bookmarks;
    const sel = store.t.selection;
    const saved = !!sel && ctx.isBookmarked(sel.lat, sel.lon);
    saveBtn.hidden = !sel || saved || bms.length >= MAX_BOOKMARKS;
    clear(saveBtn);
    saveBtn.append(icon('bookmark'), 'Add selected spot');
    const tip = (axis: string) => bms.length
      ? `Up to ${MAX_BOOKMARKS} spots. Click a score for details. The ringed score is the best in its ${axis}.`
      : 'Select a spot on the map, then add it to compare it with others.';
    hint.textContent = bms.length ? 'Tap a letter, name or score. Ring = best in row.' : tip('row');
    dockHint.textContent = tip('column');
    clear(body);
    clear(dockBody);
    syncDock();
    dockSave.hidden = saveBtn.hidden;
    clear(dockSave);
    dockSave.append(icon('bookmark'), 'Add selected spot');
    if (!bms.length) return;

    const spots: Spot[] = bms.map((b) => ({ ...b, i: ds.cellIndex.get(latLngToCell(b.lat, b.lon, ds.cells.res)) ?? null }));
    if (wide.matches) dockBody.append(renderWide(spots));
    else body.append(renderNarrow(spots));
  }

  const soon = raf(render);
  store.subscribe((c) => {
    if (c.has('dock') || c.has('bookmarks') || c.has('pane') || c.has('layers') || c.has('selection')) syncDock();
    if (c.has('bookmarks') || c.has('selection') || c.has('weights') || c.has('enabled') || c.has('commute') || c.has('prices') || c.has('scheme')) soon();
  });
  engine.onChange(soon);
  wide.addEventListener('change', () => { render(); syncDock(); });
  render();
  syncDock();
  return { dock, reopen };
}
