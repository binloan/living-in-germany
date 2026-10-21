import { modeLabel, modes } from '../city';
import { icon } from '../icons';
import { MODE_COLOR } from '../map';
import { placeLabel } from '../place';
import { prices } from '../prices';
import { SCHEMES, getScheme, gradientOf } from '../ramp';
import { store } from '../store';
import type { Mode } from '../types';
import { clear, debounce, fmtEuro, h } from '../util';
import type { Ctx } from './ctx';
import { sheetHandle } from './sheet';

const isDesktop = () => window.matchMedia('(min-width: 900px)').matches;

/** What is drawn on the map, in three one-tap sets; the switches below are for fine tuning. */
const viewState = () => ({ lines: store.p.lines, showAreaNames: store.p.showAreaNames, showDistricts: store.p.showDistricts, showPois: store.p.showPois, showNotes: store.p.showNotes, showPrices: store.p.showPrices });
type ViewState = ReturnType<typeof viewState>;
const off = { S: false, U: false, T: false, R: false }, on = { S: true, U: true, T: true, R: true };
const VIEWS: { id: string; label: string; title: string; set: ViewState }[] = [
  { id: 'heat', label: 'None', title: 'Only the score colours, no overlays', set: { lines: off, showAreaNames: false, showDistricts: false, showPois: false, showNotes: false, showPrices: false } },
  { id: 'transit', label: 'Transit', title: 'All train lines over the score colours', set: { lines: on, showAreaNames: false, showDistricts: false, showPois: false, showNotes: false, showPrices: false } },
  { id: 'all', label: 'All', title: 'Lines, names, borders, landmarks, notes and rents', set: { lines: on, showAreaNames: true, showDistricts: true, showPois: true, showNotes: true, showPrices: true } },
];

/**
 * The column of map controls on the right edge: the Layers button, the colour key under it, and the Layers panel they open
 * (a popover left of the column on desktop, a bottom sheet on a phone). Every map layer lives in that panel: the heat (which
 * metric, colours, opacity, hide below) and each overlay. The key only tells what the colours mean.
 */
export function buildLayers(ctx: Ctx) {
  const label = (id: string) => (id === 'fit' ? 'Overall score' : (ctx.ds.metrics.find((m) => m.id === id)?.label ?? id));

  // ---------- heat layer
  const heatSel = h('select.sel', { 'aria-label': 'Heat layer' }) as HTMLSelectElement;
  heatSel.addEventListener('change', () => store.setP({ heat: heatSel.value, heatOn: true }));
  function fillHeat() {
    clear(heatSel);
    heatSel.append(h('option', { value: 'fit' }, 'Overall score'));
    for (const m of ctx.ds.metrics) {
      if (m.missing) continue;
      const disabled = m.id === 'commute' && !ctx.engine.hasCommute();
      heatSel.append(h('option', { value: m.id, disabled, title: disabled ? 'Add commute places first' : null }, m.label));
    }
    heatSel.value = store.p.heat;
  }
  const heatSw = h('input.switch', { type: 'checkbox', role: 'switch', 'aria-label': 'Show heatmap' }) as HTMLInputElement;
  heatSw.addEventListener('change', () => store.setP({ heatOn: heatSw.checked }));
  const schemeBtns = new Map<string, HTMLButtonElement>();
  const schemeRow = h('div.schemes-mini', { role: 'group', 'aria-label': 'Heatmap colours' }, ...SCHEMES.map((s) => {
    const b = h('button.scheme-mini', { type: 'button', title: s.label, 'aria-label': s.label, 'aria-pressed': 'false', onclick: () => store.setP({ scheme: s.id }) },
      h('span', { style: `background:${gradientOf(s)}` })) as HTMLButtonElement;
    schemeBtns.set(s.id, b);
    return b;
  }));
  const opacity = h('input', { type: 'range', min: 30, max: 100, step: 5, 'aria-label': 'Heat opacity' }) as HTMLInputElement;
  const opacityOut = h('output') as HTMLOutputElement;
  opacity.addEventListener('input', () => store.setP({ heatOpacity: Number(opacity.value) / 100 }));
  const minRange = h('input', { type: 'range', min: 0, max: 90, step: 1, 'aria-label': 'Hide scores below' }) as HTMLInputElement;
  const minOut = h('output') as HTMLOutputElement;
  minRange.addEventListener('input', () => store.setP({ minScore: Number(minRange.value) }));
  const heatControls = h('div.heat-controls', null,
    schemeRow,
    h('label.slider-row', null, h('span', null, 'Opacity'), opacityOut, opacity),
    h('label.slider-row', null, h('span', null, 'Hide scores below'), minOut, minRange));

  // ---------- overlays
  const viewBtns = new Map<string, HTMLButtonElement>();
  const viewRow = h('div.seg.views', { role: 'group', 'aria-label': 'Overlays' }, ...VIEWS.map((v) => {
    const b = h('button', { type: 'button', title: v.title, 'aria-pressed': 'false', onclick: () => store.setP(v.set) }, v.label) as HTMLButtonElement;
    viewBtns.set(v.id, b);
    return b;
  }));
  const lineSws = new Map<Mode, HTMLInputElement>();
  // the kinds of line this city has, under its own names
  const lineRows = modes().map((mode) => ({ mode, label: modeLabel(mode) })).map((d) => {
    const input = h('input.switch', { type: 'checkbox', role: 'switch', 'aria-label': d.label }) as HTMLInputElement;
    input.addEventListener('change', () => store.setP({ lines: { ...store.p.lines, [d.mode]: input.checked } }));
    lineSws.set(d.mode, input);
    return h('label.line-switch', null, h('span.sw-text', null, h('span.line-name', null, h('i.swatch', { 'data-mode': d.mode, style: `background:${MODE_COLOR[d.mode]}` }), d.label)), input);
  });
  const mkSw = (name: string, key: keyof ViewState) => {
    const input = h('input.switch', { type: 'checkbox', role: 'switch', 'aria-label': name }) as HTMLInputElement;
    input.addEventListener('change', () => store.setP({ [key]: input.checked } as Partial<ViewState>));
    return input;
  };
  const poisSw = mkSw('Landmarks', 'showPois'), namesSw = mkSw('Area names', 'showAreaNames'), districtsSw = mkSw('District borders', 'showDistricts');
  const pricesSw = mkSw('Rental prices', 'showPrices'), notesSw = mkSw('Cleanliness notes', 'showNotes');
  const sw = (title: string, input: HTMLInputElement, sub?: HTMLElement) => h('label.line-switch', null, h('span.sw-text', null, h('span', null, title), sub ?? null), input);
  const notesSub = h('small.sw-sub');
  const pricesSub = h('small.sw-sub');

  // ---------- rents: the zones that still need one, and every report
  const priceList = h('ul.price-list');
  const reportsSummary = h('summary');
  const reports = h('details.reports', null, reportsSummary, priceList);
  const needHead = h('h3.need-head');
  const needList = h('div.need-list');
  const needBox = h('div.need', null, needHead, needList);
  const priceRefs = new Map<string, HTMLInputElement>();
  let priceKey = '';
  function syncNeeded() {
    const missing = ctx.engine.missingZones;
    needBox.hidden = missing.length === 0;
    needHead.textContent = `Still needed: ${missing.length} of ${ctx.engine.zones.length} areas`;
    clear(needList);
    for (const d of missing.slice(0, 16)) needList.append(h('button.chip', { type: 'button', title: d.parent, onclick: () => { store.setP({ heat: 'price', heatOn: true }); ctx.view.askPrice(d); } }, icon('plus'), d.name));
    if (missing.length > 16) needList.append(h('span.pane-hint', null, `and ${missing.length - 16} more`));
  }
  function syncPriceList() {
    syncNeeded();
    reportsSummary.textContent = `All reports (${store.t.prices.length})`;
    const key = store.t.prices.map((p) => p.id).join('|') + `@${store.p.flatSize}`;
    if (key === priceKey) {
      for (const p of store.t.prices) { const el = priceRefs.get(p.id); if (el && document.activeElement !== el) el.value = String(p.value); }
      return;
    }
    priceKey = key;
    clear(priceList);
    priceRefs.clear();
    if (!store.t.prices.length) {
      priceList.append(h('li.empty', null, 'None yet. Click the map and set an average rent per m² from a source you trust.'));
      return;
    }
    for (const p of store.t.prices) {
      const place = placeLabel(ctx.ds, p.lat, p.lon);
      const input = h('input', { type: 'number', inputmode: 'decimal', min: 1, step: 'any', value: p.value, 'aria-label': `Average rent per m² at ${place.name}` }) as HTMLInputElement;
      input.addEventListener('input', debounce(() => {
        const v = Math.round(Number(input.value) * 100) / 100;
        if (v > 0 && v !== p.value) void prices.edit(p.id, v);
      }, 350));
      priceRefs.set(p.id, input);
      priceList.append(h('li.price-item', null,
        h('button.price-where', { type: 'button', title: 'Show on map', onclick: () => ctx.view.flyTo(p.lat, p.lon, 12) }, h('b', null, place.name), h('small', null, [place.district && place.district !== place.name ? place.district : '', `${fmtEuro(p.value * store.p.flatSize)}/mo`].filter(Boolean).join(' · '))),
        h('div.price-field', null, input, h('i', null, '€/m²')),
        h('button.icon-btn', { type: 'button', 'aria-label': `Remove rent at ${place.name}`, onclick: () => void prices.remove(p.id) }, icon('trash'))));
    }
  }

  // ---------- the controls
  const fineCount = h('span.fine-count');
  const fine = h('details.fine', null,
    h('summary', null, h('span', null, 'Choose overlays'), fineCount, icon('chevron')),
    h('div.group', null, h('h3', null, 'Transit lines'), ...lineRows),
    h('div.group', null, h('h3', null, 'Labels'), sw('Landmarks', poisSw), sw('Area names', namesSw), sw('District borders', districtsSw)),
    h('div.group', null, h('h3', null, 'Your rents and notes'), sw('Rental prices', pricesSw, pricesSub), sw('Cleanliness notes', notesSw, notesSub), needBox, reports));
  const closeBtn = h('button.icon-btn.layers-close', { type: 'button', 'aria-label': 'Close layers', onclick: () => store.setT({ layers: false }) }, icon('x'));
  const pop: HTMLElement = h('section.layers-pop', { role: 'dialog', 'aria-label': 'Layers', hidden: true }, sheetHandle(() => pop, () => store.setT({ layers: false })), closeBtn,
    h('div.group.first', null, h('h3', null, 'Heat layer'), heatSel, h('label.line-switch', null, h('span', null, 'Show heatmap'), heatSw), heatControls),
    h('div.group', null, h('h3', null, 'Overlays'), viewRow),
    fine);
  const toggle = () => store.setT({ layers: !store.t.layers });
  const btn = h('button.lay-btn', { type: 'button', 'aria-label': 'Layers', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: toggle }, icon('layers'), h('span', null, 'Layers')) as HTMLButtonElement;
  const keyName = h('span.kn');
  // the part of the bar that "Hide scores below" removes from the map, greyed from the bottom
  const keyCut = h('i.kb-cut');
  const keyBar = h('span.kb', null, keyCut);
  const key = h('button.key', { type: 'button', onclick: toggle }, h('span.ke', null, 'Better'), h('span.kr', null, keyBar, keyName), h('span.ke', null, 'Worse')) as HTMLButtonElement;
  const el = h('div.map-controls', null, btn, key, pop);

  function sync() {
    const id = store.p.heat;
    fillHeat();
    heatSw.checked = store.p.heatOn;
    heatControls.classList.toggle('off', !store.p.heatOn);
    for (const x of heatControls.querySelectorAll('input,button')) (x as HTMLInputElement).disabled = !store.p.heatOn;
    for (const [sid, b] of schemeBtns) b.setAttribute('aria-pressed', String(store.p.scheme === sid));
    opacity.value = String(Math.round(store.p.heatOpacity * 100));
    opacityOut.textContent = `${Math.round(store.p.heatOpacity * 100)}%`;
    minRange.value = String(store.p.minScore);
    minOut.textContent = store.p.minScore ? `${store.p.minScore}` : 'off';
    for (const [m, input] of lineSws) input.checked = store.p.lines[m];
    namesSw.checked = store.p.showAreaNames;
    notesSw.checked = store.p.showNotes;
    districtsSw.checked = store.p.showDistricts;
    pricesSw.checked = store.p.showPrices;
    poisSw.checked = store.p.showPois;
    // which of the three sets is on right now (none when the switches were fine-tuned)
    const now = viewState() as unknown as Record<string, unknown>;
    for (const v of VIEWS) {
      const same = Object.entries(v.set).every(([k, val]) => JSON.stringify(val) === JSON.stringify(now[k]));
      viewBtns.get(v.id)!.setAttribute('aria-pressed', String(same));
    }
    const onCount = [...Object.values(store.p.lines), store.p.showPois, store.p.showAreaNames, store.p.showDistricts, store.p.showPrices, store.p.showNotes].filter(Boolean).length;
    fineCount.textContent = `${onCount} of 9 on`;
    // switches that draw the user's own data say so while there is none
    const noteN = Object.values(store.p.notes).filter((n) => n.clean).length;
    notesSub.textContent = noteN ? `${noteN} marked` : 'Mark a spot as dirty or clean to see it';
    pricesSub.textContent = store.t.prices.length ? `${store.t.prices.length} reports` : 'No rents added yet';
    syncPriceList();
    syncKey();
  }
  /** The key: what the colours mean, and how much of them the cut-off hides. Nothing to show while the overall score has no priority behind it. */
  function syncKey() {
    const id = ctx.engine.heatId();
    key.hidden = !store.p.heatOn || (id === 'fit' && !ctx.engine.activeMetrics().length);
    keyName.textContent = label(id);
    keyBar.style.background = gradientOf(getScheme(), '0deg');
    // the cut-off is a score; the bar is colour positions, which for the overall score are stretched over the city's spread
    const min = store.p.minScore;
    const cut = min > 0 ? Math.min(100, Math.max(0, ctx.engine.shadeFor(min))) : 0;
    keyCut.style.height = `${cut}%`;
    keyCut.hidden = cut === 0;
    keyBar.title = min > 0 ? `Scores below ${min} are hidden` : '';
    key.setAttribute('aria-label', `Heat layer: ${label(id)}.${min > 0 ? ` Scores below ${min} are hidden.` : ''} Open layers`);
  }
  function syncOpen() {
    const open = store.t.layers;
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('on', open);
    // on a phone the sheets share the spot above the toolbar
    if (open && !isDesktop() && store.t.pane) store.setT({ pane: null });
  }
  store.subscribe((c) => {
    if (c.has('layers')) syncOpen();
    if (c.has('pane') && store.t.pane && store.t.layers && !isDesktop()) store.setT({ layers: false });
    if (['heat', 'heatOn', 'scheme', 'heatOpacity', 'minScore', 'lines', 'notes', 'prices', 'flatSize', 'showAreaNames', 'showNotes', 'showDistricts', 'showPrices', 'showPois', 'commute'].some((k) => c.has(k as never))) sync();
  });
  ctx.engine.onChange(() => { fillHeat(); syncNeeded(); syncKey(); });
  sync();
  syncOpen();
  return { el };
}
