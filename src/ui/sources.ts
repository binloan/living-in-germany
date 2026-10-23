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
    try { store.importJson(await f.text()); await ctx.engine.syncCommute(); importNote.textContent = 'Imported.'; } catch { importNote.textContent = 'That is not a file exported from this app.'; }
    importInput.value = '';
  });
  const exportBtn = h('button.btn', { type: 'button', onclick: () => {
    const blob = new Blob([store.exportJson()], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'living-in-germany.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } }, icon('download'), 'Export');
  const importBtn = h('button.btn', { type: 'button', onclick: () => importInput.click() }, icon('upload'), 'Import');

  const close = h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('x'));
  const content = h('div.src-body');
  const dlg = h('dialog.sources', { 'aria-labelledby': 'src-title' },
    h('header', null, h('h2', { id: 'src-title' }, 'About this map'), close), content) as HTMLDialogElement;

  // with more than one city: back to the question "where do you want to live?"
  const otherCities = ds.config.cities.length > 1;
  content.append(
    ...(otherCities ? [h('section.src-city', null,
      h('h3', null, 'City'),
      h('div.src-city-row', null,
        h('strong', null, city().name),
        h('button.btn', { type: 'button', onclick: () => { rememberCity(null); location.assign('/'); } }, 'Change city')),
      h('p.muted', null, 'Your priorities carry over. Commute places, saved spots and notes are kept separately for each city.'))] : []),
    h('section', null,
      h('h3', null, 'Your data'),
      h('p.muted', null, 'Priorities, places, saved spots and notes are stored only in this browser. Export them to keep a copy or to open them on another device.'),
      h('div.row', null, exportBtn, importBtn, importInput), importNote),
    h('section', null,
      h('h3', null, 'Method'),
      h('ul.method', null,
        h('li', null, 'Each spot on the map (a hexagon about 350 m across) gets a 0–100 score per priority. The limits for 0 and 100 are fixed for each city: a score tells you how a place compares within its city, not with other cities.'),
        h('li', null, 'The overall score is the average of the priorities you switched on, weighted by the importance you gave them. A priority with no data for this city is left out. Map colours are stretched over the city\u2019s range so differences show; the numbers are not.'),
        h('li', null, 'Top matches: the ten best hexagons, at least 1.5 km apart. A district that is not listed yet takes a place if it scores within 8 points of the best one left, so one large high-scoring area does not fill the list.'),
        h('li', null, `Commute: on foot and by local trains (${ds.city.texts.modeList}), no buses. Next weekday, arriving 09:00; each change counts as 6 minutes. 10 minutes scores 100, 45 scores 50, 90 scores 0. With several places, each counts by the importance you set.`),
        h('li', null, 'Transit access: the lines that stop within 1 km, weighted by how often they run, what kind of line they are and how far away the stop is.'),
        h('li', null, `Rent: there is no open data. Each ${ds.city.texts.zoneNames} has an average rent per m², entered by visitors and shared by all. It counts once every area has a price.`),
        h('li', null, 'Restaurants: how many are within 600 m, weighted by how well rated the area\u2019s most popular ones are.'),
        h('li', null, 'Where only a larger area has data (crime, for example), every hexagon inside it gets that value.'))),
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
