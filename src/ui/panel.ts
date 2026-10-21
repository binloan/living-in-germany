import { cellToLatLng } from 'h3-js';
import { coverageNote } from '../coverage';
import { icon, type IconName } from '../icons';
import { normalizeShares, setShare, store, type PaneId } from '../store';
import { reverse } from '../api';
import { placeLabel } from '../place';
import { clear, debounce, fmtInt, fmtSqm, h, raf } from '../util';
import { buildCompare } from './compare';
import { createSearch } from './search';
import { sheetHandle } from './sheet';
import type { Ctx } from './ctx';

const TABS: { id: PaneId; label: string; icon: IconName }[] = [
  { id: 'matches', label: 'Matches', icon: 'star' },
  { id: 'priorities', label: 'Priorities', icon: 'sliders' },
  { id: 'compare', label: 'Compare', icon: 'compare' },
];

const isDesktop = () => window.matchMedia('(min-width: 900px)').matches;

export function buildPanel(ctx: Ctx) {
  const mainSearch = createSearch({
    placeholder: 'Search address or place',
    label: 'Search address or place',
    onPick: (hit) => ctx.select(hit.lat, hit.lon, true),
    // the field shows the selected spot's address, so clearing it closes the spot card and drops the start point
    onClear: () => { if (store.t.selection) store.setT({ selection: null }); },
  });

  // the search field shows the address of the selected spot
  let addrToken = 0;
  store.subscribe((c) => {
    if (!c.has('selection')) return;
    const sel = store.t.selection;
    const my = ++addrToken;
    if (!sel) { mainSearch.setValue(''); return; }
    reverse(sel.lat, sel.lon)
      .then((r) => { if (my === addrToken && document.activeElement !== mainSearch.input) mainSearch.setValue([r.address, r.locality].filter(Boolean).join(', ')); })
      .catch(() => {});
  });

  const sourcesBtn = h('button.icon-btn.sources-btn', { type: 'button', 'aria-label': 'Info, sources and your data', title: 'Info, sources and your data', onclick: () => store.setT({ sourcesOpen: true }) }, icon('info'));
  const collapseBtn = h('button.icon-btn.panel-collapse', { type: 'button', 'aria-label': 'Hide panel for a full-screen map', title: 'Hide panel', onclick: () => store.setP({ panelCollapsed: true }) }, icon('panel'));
  const openBtn = h('button.panel-open', { type: 'button', 'aria-label': 'Show panel', onclick: () => store.setP({ panelCollapsed: false }) }, icon('panel'), h('span', null, 'Panel'));
  const head = h('header.panel-head', null,
    h('div.brand', null, h('h1', null, `Living in ${ctx.ds.city.name}`)),
    h('div.head-actions', null, sourcesBtn, collapseBtn));

  const tabs = h('nav.tabs', { role: 'tablist', 'aria-label': 'Panels' });
  const tabBtns = new Map<PaneId, HTMLButtonElement>();
  for (const t of TABS) {
    if (t.id === 'compare') continue; // the comparison has its own button on the map, not a tab
    const b = h('button.tab', { type: 'button', role: 'tab', 'aria-controls': `pane-${t.id}`, onclick: () => togglePane(t.id) }, icon(t.icon), h('span', null, t.label)) as HTMLButtonElement;
    tabBtns.set(t.id, b);
    tabs.append(b);
  }
  const sourcesTab = h('button.tab.tab-sources', { type: 'button', onclick: () => store.setT({ sourcesOpen: true }), 'aria-label': 'Info, sources and your data' }, icon('info'), h('span', null, 'Info'));
  tabs.append(sourcesTab);

  const panes: HTMLElement = h('div.panes', null, sheetHandle(() => panes, () => store.setT({ pane: null })));
  const paneEls = new Map<PaneId, HTMLElement>();
  for (const t of TABS) {
    const sec = h('section.pane', { id: `pane-${t.id}`, role: 'tabpanel', 'aria-label': t.label });
    paneEls.set(t.id, sec);
    panes.append(sec);
  }

  const panel = h('aside.panel', null, head, mainSearch.el, tabs, panes);

  function togglePane(id: PaneId) {
    // phone: the sheet toggles; desktop keeps one panel tab open (the comparison is its own dock there)
    store.setT({ pane: isDesktop() ? id : store.t.pane === id ? null : id });
  }

  // ---------- Priorities
  const prio = paneEls.get('priorities')!;
  const rows = new Map<string, { row: HTMLElement; out: HTMLOutputElement; range: HTMLInputElement; sw: HTMLInputElement }>();
  const topList = h('ol.top-list');
  const matches = paneEls.get('matches')!;
  const matchesList = h('div.matches-list', null,
    h('p.pane-hint', null, 'For your priorities: the best-scoring spots, from different districts where scores are close and at least 1.5 km apart.'),
    topList,
    h('p.pane-hint', null, 'Score = weighted mean of the priorities you switched on. Change a weight and this list follows.'));
  // before any priority is on there is nothing to rank: say so and offer the way there
  const matchesEmpty = h('div.matches-empty', null,
    h('p', null, 'Choose your priorities first.'),
    h('p.pane-hint', null, 'Switch on what matters to you and the best spots for it appear here.'),
    h('button.btn.primary', { type: 'button', onclick: () => store.setT({ pane: 'priorities' }) }, icon('sliders'), 'Choose priorities'));
  matches.append(h('div.pane-title', null, h('h2', null, 'Top matches')), matchesList, matchesEmpty);

  function buildPriorities() {
    clear(prio);
    rows.clear();
    prio.append(h('div.pane-title', null, h('h2', null, 'Priorities'), h('button.link', { type: 'button', onclick: () => store.clearWeights() }, icon('reset'), 'Clear all')));

    const list = h('div.metrics');
    for (const m of ctx.ds.metrics.filter((x) => !x.overlay)) {
      const w = store.p.weights[m.id] ?? m.weight;
      const range = h('input', { type: 'range', min: 0, max: 100, step: 5, value: w, 'aria-label': `${m.label} weight` }) as HTMLInputElement;
      const out = h('output', null, String(w)) as HTMLOutputElement;
      const sw = h('input.switch', { type: 'checkbox', role: 'switch', 'aria-label': `Use ${m.label}` }) as HTMLInputElement;
      sw.checked = store.isOn(m.id);
      const proxyLabel = m.proxy ? ctx.ds.metrics.find((x) => x.id === m.proxy!.metric)?.label : undefined;
      const places = ctx.ds.city.municipalities;
      const partial = m.proxy
        ? `${m.proxy.city} has no data for this: the ${proxyLabel} score stands in.`
        : m.cityWide
          ? `${m.cityWide} uses one city-wide value.`
          : m.cover && !m.missing && places.some((n) => m.cover![n] < 0.25)
            ? coverageNote(places, m.cover)
            : null;

      const sliderBox = h('div.m-slider', { hidden: true }, h('span', null, 'Weight'), range);
      const infoBox = h('p.m-info', { hidden: true }, m.info ?? m.hint, partial ? h('span.m-partial', null, partial) : null);
      const extra = h('div.m-extra', { hidden: true }, sliderBox, infoBox);
      // the places you travel to and the flat size belong to their rows: they open with the weight
      const more = m.id === 'commute' ? commuteBox : m.id === 'price' ? flatBox : null;
      if (more) extra.append(more);
      const showExtra = () => { extra.hidden = sliderBox.hidden && infoBox.hidden; };
      const weightBtn = h('button.m-weight', { type: 'button', 'aria-expanded': 'false', 'aria-label': `Set weight of ${m.label}` }, out, icon('chevron')) as HTMLButtonElement;
      const nameBtn = h('button.m-name', { type: 'button', 'aria-expanded': 'false' }, h('span', null, m.label), m.missing ? h('span.tag', null, 'no data') : null) as HTMLButtonElement;
      const toggleSlider = () => {
        sliderBox.hidden = !sliderBox.hidden;
        if (more) more.hidden = sliderBox.hidden;
        for (const b of [weightBtn, nameBtn]) b.setAttribute('aria-expanded', String(!sliderBox.hidden));
        weightBtn.classList.toggle('open', !sliderBox.hidden);
        showExtra();
      };
      weightBtn.addEventListener('click', toggleSlider);
      nameBtn.addEventListener('click', toggleSlider);
      const infoBtn = h('button.info-btn', { type: 'button', 'aria-expanded': 'false', 'aria-label': `About ${m.label}`, title: 'What is this?', onclick: () => {
        infoBox.hidden = !infoBox.hidden;
        infoBtn.setAttribute('aria-expanded', String(!infoBox.hidden));
        infoBtn.classList.toggle('open', !infoBox.hidden);
        showExtra();
      } }, icon('info')) as HTMLButtonElement;

      const row = h('div.metric', { 'data-id': m.id }, nameBtn, infoBtn, weightBtn, sw, extra);
      range.addEventListener('pointerdown', () => slideStart(true));
      range.addEventListener('input', () => {
        slideStart(false);
        out.textContent = range.value;
        store.setWeight(m.id, Number(range.value));
      });
      sw.addEventListener('change', () => store.setOn(m.id, sw.checked));
      if (m.missing) { range.disabled = true; sw.disabled = true; }
      rows.set(m.id, { row, out, range, sw });
      list.append(row);
    }
    prio.append(list);
  }

  /** Why Commute Time is not in the score: no places yet, or the saved places are still loading (e.g. right after a reload). */
  function commuteHint() {
    const places = store.p.commute;
    if (!places.length) return 'Add a place: open this row';
    const states = places.map((p) => ctx.engine.status.get(p.id));
    if (states.every((s) => s === 'error')) return 'Could not load commute times. Retry in Profile';
    return 'Loading commute times…';
  }

  function syncPriorities() {
    for (const [id, r] of rows) {
      const on = store.isOn(id);
      const w = store.p.weights[id] ?? 0;
      r.range.value = String(w);
      r.out.textContent = String(w);
      r.sw.checked = on;
      const m = ctx.ds.metrics.find((x) => x.id === id);
      const dynamicOff = !!m?.dynamic && !ctx.engine.ready(id);
      r.row.dataset.off = String(!on || dynamicOff);
      if (m?.dynamic) {
        const n = ctx.engine.missingZones.length;
        r.row.dataset.hint = !dynamicOff ? '' : id === 'commute' ? commuteHint() : n ? `Counts once every area has a rent (${n} of ${ctx.engine.zones.length} still missing)` : '';
      }
    }
  }

  // While a weight slider is being moved the heatmap follows live, but the list waits for the release: its rows differ in height,
  // so reordering it under the pointer makes the sliders below jump.
  let sliding = false, slidingPointer = false, topStale = false;
  const releaseTop = () => { if (slidingPointer) return; sliding = false; if (topStale) { topStale = false; syncTop(); } };
  const releaseTopSoon = debounce(releaseTop, 400);
  function slideStart(viaPointer: boolean) { sliding = true; if (viaPointer) slidingPointer = true; releaseTopSoon(); }
  window.addEventListener('pointerup', () => { if (!slidingPointer) return; slidingPointer = false; releaseTop(); });
  window.addEventListener('pointercancel', () => { slidingPointer = false; releaseTop(); });

  /** Top 10 spots for the current priorities. */
  function syncTop() {
    ctx.view.setPreview(null); // the entry under the pointer is about to be replaced
    clear(topList);
    const none = !ctx.engine.activeMetrics().length;
    matchesList.hidden = none;
    matchesEmpty.hidden = !none;
    if (none) return;
    const top = ctx.engine.topAreas(10);
    if (!top.length) { topList.append(h('li.empty', null, 'No area has data for these priorities.')); return; }
    top.forEach((a, rank) => {
      const p = ctx.ds.areas.features[a.index].properties;
      const [lat, lon] = cellToLatLng(ctx.ds.cells.ids[a.bestCell]);
      // the subdistrict leads; the street-like planning-area name and a nearby station follow
      const place = placeLabel(ctx.ds, lat, lon);
      // a preview follows a mouse pointer or the keyboard focus only: a finger never leaves a list entry again, so touch must not start one
      const preview = () => ctx.view.setPreview({ lat, lon });
      const unpreview = () => ctx.view.setPreview(null);
      const mouseIn = (e: Event) => { if ((e as PointerEvent).pointerType === 'mouse') preview(); };
      const focusIn = (e: Event) => { if ((e.currentTarget as HTMLElement).matches(':focus-visible')) preview(); };
      topList.append(h('li', null, h('button.top-item', { type: 'button', title: `${p.name} area`, onclick: () => { unpreview(); ctx.select(lat, lon, true); }, onpointerenter: mouseIn, onpointerleave: unpreview, onfocus: focusIn, onblur: unpreview },
        h('span.top-rank' + (rank < 3 ? `.medal.m${rank + 1}` : ''), null, String(rank + 1)),
        h('span.top-name', null, h('b', null, place.title), place.detail ? h('small', null, place.detail) : null),
        h('b.top-score', null, a.score.toFixed(1)))));
    });
  }

  // ---------- Places you travel to (inside the Commute time row) and the flat size (inside the Rent price row)
  const presets = h('div.chips');
  const comList = h('ul.cm-list');
  const evenBtn = h('button.link', { type: 'button', onclick: () => { store.setP({ commute: normalizeShares(store.p.commute.map((p) => ({ ...p, share: 1 }))) }); ctx.engine.refresh(); } }, 'Split evenly');
  const shareHead = h('div.share-head', null, h('h3', null, 'Places you travel to'), evenBtn);
  const commuteBox = h('div.m-more', { hidden: true }, shareHead, comList, presets, h('p.pane-hint', null, 'Or click the map and choose Commute.'));
  const sizeRange = h('input', { type: 'range', min: 20, max: 150, step: 5, 'aria-label': 'Flat size in square metres' }) as HTMLInputElement;
  const sizeOut = h('output') as HTMLOutputElement;
  sizeRange.addEventListener('input', () => store.setP({ flatSize: Number(sizeRange.value) }));
  const syncFlat = () => { sizeRange.value = String(store.p.flatSize); sizeOut.textContent = `${store.p.flatSize} m²`; };
  const flatBox = h('div.m-more', { hidden: true },
    h('label.slider-row', null, h('span', null, 'Flat you look for'), sizeOut, sizeRange),
    h('p.pane-hint', null, 'Rents are reported per m². The size turns them into the monthly rent shown on the map. It does not change the ranking.'));

  const shareRefs = new Map<string, { range: HTMLInputElement; out: HTMLElement }>();
  let listKey: string | null = null;

  function updateShares() {
    for (const p of store.p.commute) {
      const r = shareRefs.get(p.id);
      if (!r) continue;
      if (document.activeElement !== r.range) r.range.value = String(p.share);
      r.out.textContent = `${p.share}%`;
    }
  }

  function syncCommute() {
    evenBtn.hidden = store.p.commute.length < 2;

    const key = store.p.commute.map((p) => `${p.id}:${ctx.engine.status.get(p.id) ?? ''}`).join('|');
    if (key === listKey) { updateShares(); return; }
    listKey = key;

    clear(presets);
    for (const p of ctx.ds.city.commutePresets) {
      if (store.p.commute.some((q) => Math.abs(q.lat - p.lat) < 1e-4 && Math.abs(q.lon - p.lon) < 1e-4)) continue;
      presets.append(h('button.chip', { type: 'button', onclick: () => ctx.addCommute(p) }, icon('plus'), p.name));
    }
    clear(comList);
    shareRefs.clear();
    if (!store.p.commute.length) {
      comList.append(h('li.empty', null, 'No places yet. Add where you travel to often.'));
      return;
    }
    const many = store.p.commute.length > 1;
    store.p.commute.forEach((p, i) => {
      const st = ctx.engine.status.get(p.id);
      const range = h('input', { type: 'range', min: 0, max: 100, step: 5, value: p.share, 'aria-label': `Importance of ${p.name}` }) as HTMLInputElement;
      const out = h('output', null, `${p.share}%`);
      range.addEventListener('input', () => {
        store.setP({ commute: setShare(store.p.commute, p.id, Number(range.value)) });
        updateShares();
        ctx.engine.refresh();
      });
      shareRefs.set(p.id, { range, out });
      comList.append(h('li.cm-item', null,
        h('span.cm-n', null, String(i + 1)),
        h('div.cm-main', null,
          h('span.cm-title', null, p.name),
          st === 'loading' ? h('span.cm-state', null, 'Loading times…')
            : st === 'error' ? h('button.link.err', { type: 'button', onclick: () => ctx.engine.retry(p.id) }, 'Failed. Retry')
              : null),
        h('b.cm-pct', null, out),
        h('button.icon-btn', { type: 'button', 'aria-label': `Remove ${p.name}`, onclick: () => { store.setP({ commute: normalizeShares(store.p.commute.filter((q) => q.id !== p.id)) }); void ctx.engine.syncCommute(); } }, icon('trash')),
        many ? h('div.cm-slider', null, range) : null));
    });
  }

  function syncPane() {
    const desktop = isDesktop();
    const open = desktop && store.t.pane === 'compare' ? 'matches' : store.t.pane;
    panel.dataset.pane = open ?? '';
    for (const [id, el] of paneEls) el.hidden = id !== open;
    for (const [id, b] of tabBtns) {
      b.setAttribute('aria-selected', String(id === open));
      b.classList.toggle('on', id === open);
    }
  }

  /** With no spot left in the comparison it closes. */
  function syncSaved() {
    if (store.p.bookmarks.length) return;
    if (store.t.dock) store.setT({ dock: false });
    if (store.t.pane === 'compare') store.setT({ pane: isDesktop() ? 'matches' : null });
  }

  buildPriorities();
  syncFlat();
  const { dock, reopen } = buildCompare(ctx, paneEls.get('compare')!);
  const syncTopSoon = raf(() => { if (sliding) topStale = true; else syncTop(); });
  const syncAll = raf(() => { syncPriorities(); syncCommute(); syncPane(); syncTop(); });
  store.subscribe((c) => {
    if (c.has('weights') || c.has('enabled') || c.has('commute') || c.has('prices')) syncPriorities();
    if (c.has('commute')) syncCommute();
    if (c.has('flatSize')) syncFlat();
    if (c.has('pane') || c.has('dock')) syncPane();
    if (c.has('bookmarks')) syncSaved();
  });
  const syncPrioritiesSoon = raf(syncPriorities);
  ctx.engine.onChange(() => { syncTopSoon(); syncPrioritiesSoon(); if (store.p.commute.length) syncCommute(); });
  syncAll();
  syncSaved();
  if (isDesktop()) store.setT({ pane: 'matches' });

  return { el: panel, openBtn, dock, reopen };
}
