import { city, rememberCity } from '../city';
import { icon } from '../icons';
import { store } from '../store';
import type { Source } from '../types';
import { h } from '../util';
import type { Ctx } from './ctx';

export function buildSources(ctx: Ctx) {
  const { ds } = ctx;
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const srcItem = (s: Source) =>
    h('li', null,
      h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.name, icon('external')),
      h('span.meta', null, [s.license, s.attribution].filter(Boolean).join(' · ')),
      s.note ? h('span.src-note', null, s.note) : null);

  // your priorities, places, saved spots and notes stay in this browser: take them along as a file
  const importNote = h('p.muted');
  const importInput = h('input', { type: 'file', accept: 'application/json', hidden: true, 'aria-label': 'Choose a file to import' }) as HTMLInputElement;
  importInput.addEventListener('change', async () => {
    const f = importInput.files?.[0];
    if (!f) return;
    try { store.importJson(await f.text()); await ctx.engine.syncCommute(); importNote.textContent = 'Imported.'; } catch { importNote.textContent = `Not a valid ${city().name} Fit file.`; }
    importInput.value = '';
  });
  const exportBtn = h('button.btn', { type: 'button', onclick: () => {
    const blob = new Blob([store.exportJson()], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'berlin-fit.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } }, icon('download'), 'Export');
  const importBtn = h('button.btn', { type: 'button', onclick: () => importInput.click() }, icon('upload'), 'Import');

  const close = h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('x'));
  const content = h('div.src-body');
  const dlg = h('dialog.sources', { 'aria-labelledby': 'src-title' },
    h('header', null, h('h2', { id: 'src-title' }, 'Info, sources and your data'), close), content) as HTMLDialogElement;

  // with more than one city: back to the question "where do you want to live?"
  const otherCities = ds.config.cities.length > 1;
  content.append(
    ...(otherCities ? [h('section', null,
      h('h3', null, 'City'),
      h('p.muted', null, `You are looking at ${city().name}. Priorities and weights stay when you change; commute places, saved spots and notes belong to the city.`),
      h('div.row', null, h('button.btn', { type: 'button', onclick: () => { rememberCity(null); location.assign('/'); } }, 'Change city')))] : []),
    h('section', null,
      h('h3', null, 'Your notes and settings'),
      h('p.muted', null, 'Weights, commute places, saved spots and notes live in this browser. Export them as a file to keep them or open them elsewhere.'),
      h('div.row', null, exportBtn, importBtn, importInput), importNote),
    h('section', null,
      h('h3', null, 'Method'),
      h('ul.method', null,
        h('li', null, 'Every spot on the map (a hexagon about 350 m across) gets a 0–100 score per priority, measured against fixed limits that are the same in every city, so a score means the same everywhere.'),
        h('li', null, 'The overall score is the average of the priorities you switched on, weighted by their importance, shown as is on a 0–100 scale. Priorities without data are skipped. Map colours are stretched over the spread of the city so differences show; the numbers are not.'),
        h('li', null, 'Top matches: the ten best-scoring hexagons, at least 1.5 km apart. A hexagon from a district not listed yet takes the place when it scores within 8 points of the best one left, so one wide area of high scores does not fill the list.'),
        h('li', null, `Commute: walking and trains only (${ds.city.texts.modeList}), no buses. Next weekday, arriving 09:00; each change counts as 6 minutes. 10 minutes scores 100, 45 scores 50, 90 scores 0. Your places are weighted by the importance you set.`),
        h('li', null, 'Transit access: lines within 1 km, weighted by frequency, type and distance.'),
        h('li', null, `Rent: there is no open data. It uses the average rent per m² of each ${ds.city.texts.zoneNames}, shared by all visitors. It counts once every area has a price.`),
        h('li', null, 'Restaurants: how many are within 600 m, times how well rated the area\u2019s most popular ones are.'),
        h('li', null, 'Where only a larger area has data (for example crime), every hex inside it gets that value.'))),
    h('section', null,
      h('h3', null, 'Coverage'),
      h('table.cover', null,
        h('thead', null, h('tr', null, h('th', null, 'Metric'), ...ds.city.municipalities.map((n) => h('th', null, n)))),
        h('tbody', null, ...ds.metrics.filter((m) => !m.dynamic).map((m) =>
          h('tr', null, h('td', null, m.label), ...ds.city.municipalities.map((n) => h('td', null, m.cover ? pct(m.cover[n]) : '—'))))))),
    ...ds.metrics.filter((m) => ds.sources.metrics[m.id]?.length).map((m) =>
      h('section', null, h('h3', null, m.label), m.note ? h('p.muted', null, m.note) : null, h('ul.src', null, ...ds.sources.metrics[m.id].map(srcItem)))),
    h('section', null, h('h3', null, 'Map, search, routing'), h('ul.src', null, ...ds.sources.shared.map(srcItem))));

  dlg.addEventListener('close', () => store.setT({ sourcesOpen: false }));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  store.subscribe((c) => {
    if (!c.has('sourcesOpen')) return;
    if (store.t.sourcesOpen && !dlg.open) dlg.showModal();
    if (!store.t.sourcesOpen && dlg.open) dlg.close();
  });
  return { el: dlg };
}
