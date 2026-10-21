import { latLngToCell } from 'h3-js';
import { reverse, type Route, type RouteLeg } from '../api';
import { modeLabel, regionOr } from '../city';
import { icon } from '../icons';
import { MODE_COLOR } from '../map';
import { placeLabel } from '../place';
import { rampCss } from '../ramp';
import { store } from '../store';
import type { AreaProps, CleanTag, Metric, Mode, Photo, Station } from '../types';
import { clear, debounce, fmtInt, fmtMetric, fmtSqm, h, haversine, inkOn } from '../util';
import type { Ctx } from './ctx';
import { openGallery, wikiWidth } from './gallery';
import { sheetHandle } from './sheet';

const WALK_M_PER_MIN = 80;
const NEAR_M = 1600;
const MODE_ORDER: Mode[] = ['R', 'S', 'U', 'T'];

export function buildDetail(ctx: Ctx) {
  const { ds, engine } = ctx;
  const body = h('div.detail-body');
  const closeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Close details', onclick: () => select(null) }, icon('x'));
  const el: HTMLElement = h('aside.detail', { hidden: true, 'aria-live': 'polite' }, sheetHandle(() => el, () => select(null)), closeBtn, body);

  let token = 0;
  let current: { lat: number; lon: number } | null = null;

  function select(p: { lat: number; lon: number } | null) {
    store.setT({ selection: p });
  }

  function nearestStations(lat: number, lon: number) {
    const out: { s: Station; d: number }[] = [];
    for (const s of ds.stations) {
      if (Math.abs(s[0] - lat) > 0.016 || Math.abs(s[1] - lon) > 0.026) continue;
      const d = haversine(lat, lon, s[0], s[1]);
      if (d <= NEAR_M) out.push({ s, d });
    }
    out.sort((a, b) => a.d - b.d);
    const picked: typeof out = [];
    const seenName = new Set<string>();
    for (const o of out) {
      if (seenName.has(o.s[2])) continue;
      seenName.add(o.s[2]);
      picked.push(o);
      if (picked.length >= 4) break;
    }
    return picked;
  }

  function chip(name: string, fallback = '#5f6b78') {
    const color = ds.lineColor.get(name) ?? fallback;
    return h('span.line', { style: `background:${color};color:${inkOn(color)}` }, name);
  }

  /** Lines of one station grouped by transit type, so the types available are obvious. */
  function lineGroups(lines: string[]) {
    const groups = new Map<Mode, string[]>();
    for (const l of lines) {
      const m = ds.lineMode.get(l);
      if (!m) continue;
      (groups.get(m) || groups.set(m, []).get(m)!).push(l);
    }
    return MODE_ORDER.filter((m) => groups.has(m)).map((m) => h('div.mode-row', null,
      h('span.mode-tag', null, h('i', { style: `background:${MODE_COLOR[m]}` }), modeLabel(m)),
      h('span.lines', null, ...groups.get(m)!.slice(0, 12).map((n) => chip(n, MODE_COLOR[m])), groups.get(m)!.length > 12 ? h('span.more', null, `+${groups.get(m)!.length - 12}`) : null)));
  }

  /** colorAt: where on the colour ramp the dot sits when that differs from the score (the overall score is shaded over the spread of the city). */
  function track(score: number | null, colorAt = score) {
    const t = h('span.track', { 'aria-hidden': 'true' });
    if (score == null) { t.classList.add('na'); return t; }
    t.style.setProperty('--x', `${score}%`);
    t.style.setProperty('--c', rampCss(Math.max(35, colorAt ?? score)));
    t.append(h('i'));
    return t;
  }

  const fmtRaw = fmtMetric;

  const transferText = (n: number) => (n === 0 ? 'direct' : n === 1 ? '1 transfer' : `${n} transfers`);

  /** Minutes from the selected spot to a commute place: the exact itinerary once loaded, else the heat-field estimate. */
  function minutesFor(id: string, i: number | null) {
    const r = ctx.routes.get(id);
    const ride = (r && r !== 'loading' && r !== 'error' && !r.none) ? r : null;
    return { ride, minutes: ride?.minutes ?? (i == null ? null : engine.minutesTo(id, i)), loading: r === 'loading' || engine.status.get(id) === 'loading' };
  }

  /** Importance-weighted minutes over all commute places, or null while any time is missing. */
  function weightedMinutes(i: number | null) {
    let sum = 0, w = 0;
    for (const p of store.p.commute) {
      const m = minutesFor(p.id, i).minutes;
      if (m == null) return null;
      sum += m * p.share; w += p.share;
    }
    return w > 0 ? sum / w : null;
  }

  /** One line per commute place: lines used, transfers and time. */
  function commuteLine(p: { id: string; name: string; share: number }, i: number | null) {
    const { ride, minutes: mins, loading } = minutesFor(p.id, i);
    const search = ctx.routes.get(p.id);
    const legs: RouteLeg[] = ride?.legs?.filter((l) => l.mode !== 'W') ?? [];
    const transfers = ride?.transfers ?? (i == null ? null : engine.transfersTo(p.id, i));
    return h('div.cm-line', null,
      h('i.cm-who', null, p.name, store.p.commute.length > 1 ? h('small', null, ` ${p.share}%`) : null),
      h('span.cm-how', null,
        ...legs.map((l) => chip(l.name || (l.mode in MODE_COLOR ? modeLabel(l.mode) : 'Bus'), l.color ?? MODE_COLOR[l.mode as Mode] ?? '#5f6b78')),
        transfers != null ? h('em', null, transferText(transfers)) : null,
        // the commute map has a time but the route search found no way: say so instead of leaving the line bare
        !ride && search && search !== 'loading' && search !== 'error' && search.none ? h('em', null, 'no route found') : null),
      h('b', null, mins == null ? (loading ? '…' : '—') : `${mins} min`));
  }

  /** Who planned the routes shown above: the city's own timetable service, or Transitous (and when it stood in for the first). Null until a route is in. */
  function routeSourceNote() {
    const done = store.p.commute.map((p) => ctx.routes.get(p.id)).filter((r): r is Route => !!r && r !== 'loading' && r !== 'error' && !r.none && !!r.source);
    if (!done.length) return null;
    const sources = [...new Set(done.map((r) => r.source!))];
    const missing = [...new Set(done.map((r) => r.fallbackFor).filter((n): n is string => !!n))];
    const title = 'Walking and local trains only: no ICE or IC, which the Deutschlandticket does not cover';
    if (missing.length) {
      return h('span.m-src', { title: `${missing.join(' and ')} could not plan ${sources.length > 1 ? 'some of these' : 'this'}, so Transitous did. ${title}` },
        sources.length > 1 ? `Routes by ${sources.join(' and ')}` : `Routes by ${sources[0]} (${missing.join(' and ')} unavailable)`);
    }
    return h('span.m-src', { title: sources.length === 1 && sources[0] !== 'Transitous' ? `Planned by ${sources[0]}, the timetable service of the region. ${title}` : title }, `Routes by ${sources.join(' and ')}`);
  }

  function metricRow(m: Metric, i: number | null) {
    const on = store.isOn(m.id) && (store.p.weights[m.id] ?? 0) > 0 && (!m.dynamic || engine.ready(m.id));
    const s = i == null ? null : engine.score(m.id, i);
    const raw = i == null ? null : engine.rawValue(m.id, i);
    const unavailable = !!m.dynamic && !engine.shown(m.id);
    if (unavailable) return null;
    const many = m.id === 'commute' && store.p.commute.length > 1;
    const live = m.id === 'commute' && i != null ? weightedMinutes(i) : null;
    // a stand-in score (no data of its own for this city): show the value it comes from
    const proxyMetric = s != null && raw == null && m.proxy ? ds.metrics.find((x) => x.id === m.proxy!.metric) : undefined;
    const proxyRaw = proxyMetric && i != null ? engine.rawValue(proxyMetric.id, i) : null;
    const rawText = s == null ? 'no data' : proxyMetric ? `≈ ${fmtRaw(proxyMetric, proxyRaw)}` : `${many ? 'Ø ' : ''}${fmtRaw(m, live ?? raw)}`;
    const row = h('div.m-row', { 'data-off': String(!on), 'data-na': String(s == null) },
      h('span.m-label', m.id === 'price' && !on && store.isOn(m.id) && (store.p.weights[m.id] ?? 0) > 0 ? { title: 'Not part of the score yet: every area needs a rent first' } : null, m.label),
      track(s),
      h('b.m-score', null, s == null ? '—' : fmtInt(s)),
      h('span.m-raw', proxyMetric ? { title: `Estimated: no ${m.label} data here, the ${proxyMetric.label} score stands in` } : m.id === 'price' && i != null && engine.sqmRent(i) != null ? { title: `${fmtSqm(engine.sqmRent(i)!)} × ${store.p.flatSize} m²` } : null, rawText));
    if (m.id === 'commute' && i != null) {
      const sub = h('div.m-sub', null, h('span.m-from', null, 'From this spot to'), ...store.p.commute.map((p) => commuteLine(p, i)), routeSourceNote());
      return h('div.m-group', null, row, sub);
    }
    return row;
  }

  function notesBlock(area: AreaProps) {
    const note = store.p.notes[area.id] ?? {};
    const save = (patch: { clean?: CleanTag | undefined }) => {
      const next = { ...(store.p.notes[area.id] ?? {}), ...patch };
      if (!next.clean) delete next.clean;
      const notes = { ...store.p.notes };
      if (Object.keys(next).length) notes[area.id] = next; else delete notes[area.id];
      store.setP({ notes });
    };
    const seg = h('div.seg', { role: 'group', 'aria-label': `Cleanliness of ${area.name}` });
    (['dirty', 'avg', 'clean'] as CleanTag[]).forEach((t) => {
      seg.append(h('button', { type: 'button', 'data-tag': t, 'aria-pressed': String(note.clean === t), onclick: () => save({ clean: store.p.notes[area.id]?.clean === t ? undefined : t }) }, t === 'avg' ? 'Average' : t[0].toUpperCase() + t.slice(1)));
    });
    return h('section.notes', null,
      h('h3', null, 'Your notes'),
      h('div.notes-grid', null, h('div', null, h('span.lbl', null, 'Cleanliness'), seg)));
  }

  /** Photos of the zone (Ortsteil / Stadtteil) a spot lies in: swipeable strip with the credit of the shown photo. */
  function photoStrip(zoneName: string, photos: Photo[]) {
    const credit = h('a.ph-credit', { target: '_blank', rel: 'noopener' }) as HTMLAnchorElement;
    const track = h('div.ph-track', { tabindex: 0, role: 'group', 'aria-label': `Photos of ${zoneName}` },
      ...photos.map((p) => h('img', {
        src: p.u, srcset: `${wikiWidth(p.u, 500)} 500w, ${p.u} 960w`, sizes: '(max-width: 899px) calc(100vw - 16px), 370px',
        width: p.w, height: p.h, alt: `${zoneName}, photo by ${p.by}`, loading: 'lazy', decoding: 'async', draggable: false,
      })));
    const dots = photos.length > 1 ? h('div.ph-dots', { 'aria-hidden': 'true' }, ...photos.map(() => h('i'))) : null;
    const show = (k: number) => {
      const p = photos[k];
      credit.textContent = `${zoneName} · ${p.by}, ${p.lic}`;
      credit.href = p.page;
      credit.title = `Photo: ${p.by}, ${p.lic}. Open on Wikimedia Commons`;
      dots?.childNodes.forEach((d, j) => (d as HTMLElement).classList.toggle('on', j === k));
    };
    const at = () => Math.min(photos.length - 1, Math.max(0, Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
    const go = (k: number) => track.scrollTo({ left: Math.min(photos.length - 1, Math.max(0, k)) * track.clientWidth, behavior: 'smooth' });
    track.addEventListener('scroll', () => show(at()), { passive: true });
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { go(at() + 1); e.preventDefault(); } else if (e.key === 'ArrowLeft') { go(at() - 1); e.preventDefault(); }
    });
    // touch swipes natively; a mouse drags the strip by hand and lets go onto the nearest photo
    let drag: { x: number; left: number; id: number } | null = null;
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || photos.length < 2) return;
      drag = { x: e.clientX, left: track.scrollLeft, id: e.pointerId };
      track.setPointerCapture(e.pointerId);
      track.classList.add('dragging');
    });
    track.addEventListener('pointermove', (e) => { if (drag) track.scrollLeft = drag.left - (e.clientX - drag.x); });
    const release = (e: PointerEvent) => {
      if (!drag) return;
      const moved = drag.x - e.clientX;
      const start = Math.round(drag.left / Math.max(1, track.clientWidth));
      drag = null;
      track.classList.remove('dragging');
      // a flick of more than a fifth of the width turns the page, a smaller drag settles back
      go(Math.abs(moved) > track.clientWidth * 0.2 ? start + Math.sign(moved) : start);
    };
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);
    const arrow = (dir: -1 | 1) => h('button.ph-arrow' + (dir < 0 ? '.prev' : '.next'), { type: 'button', 'aria-label': dir < 0 ? 'Previous photo' : 'Next photo', onclick: () => go(at() + dir) }, icon('chevron'));
    show(0);
    return h('div.photos', null, track, photos.length > 1 ? arrow(-1) : null, photos.length > 1 ? arrow(1) : null, dots, credit);
  }

  function render() {
    const sel = store.t.selection;
    el.hidden = !sel;
    if (!sel) { current = null; ctx.view.setSelectedArea(null); return; }
    const same = current && current.lat === sel.lat && current.lon === sel.lon;
    current = sel;
    const my = ++token;

    const cell = latLngToCell(sel.lat, sel.lon, ds.cells.res);
    const i = ds.cellIndex.get(cell) ?? null;
    const area = i != null ? ds.areas.features[ds.cells.area[i]].properties : null;
    const place = placeLabel(ds, sel.lat, sel.lon);
    ctx.view.setSelectedArea(area?.id ?? null);

    clear(body);
    const zone = i != null ? ds.zones[ds.cellZone[i]] : null;
    const photos = zone ? ds.images[zone.id] ?? [] : [];
    el.classList.toggle('has-photos', photos.length > 0);
    if (zone && photos.length) body.append(photoStrip(zone.name, photos));
    const addr = h('p.addr', null, '…');
    // phone: the strip is too tall for the small sheet, so a square thumbnail beside the name opens the photos full-screen
    const thumb = zone && photos.length ? h('button.d-thumb', { type: 'button', 'aria-label': `Photos of ${zone.name} (${photos.length})`, onclick: () => openGallery(zone.name, photos) },
      h('img', { src: wikiWidth(photos[0].u, 120), srcset: `${wikiWidth(photos[0].u, 120)} 1x, ${wikiWidth(photos[0].u, 250)} 2x`, alt: '', draggable: false }),
      photos.length > 1 ? h('span.d-thumb-n', null, String(photos.length)) : null) : null;
    body.append(
      h('header.d-head', null,
        h('div.d-text', null,
          h('div', null,
            h('h2', null, place.title),
            h('p.sub', null, area ? (area.name !== place.name ? area.name : '') : `${sel.lat.toFixed(4)}, ${sel.lon.toFixed(4)}`)),
          addr),
        thumb));

    // what to do with the spot sits right under its name: Compare in its own colour, then Commute
    const saved = ctx.isBookmarked(sel.lat, sel.lon);
    const bmErr = h('p.price-err', { hidden: true, role: 'alert' });
    body.append(h('div.d-actions', null,
      h('button.btn.cmp-btn' + (saved ? '.saved' : ''), {
        type: 'button', 'aria-pressed': String(saved), title: saved ? 'Remove from Compare' : 'Add this spot to Compare',
        onclick: () => { const e = ctx.toggleBookmark(sel.lat, sel.lon); if (e) { bmErr.textContent = e; bmErr.hidden = false; } },
      }, icon('compare'), saved ? 'In compare' : 'Add to compare'),
      h('button.btn', { type: 'button', onclick: () => ctx.addCommute({ name: addr.textContent && addr.textContent !== '…' ? addr.textContent.split(',')[0] : (area?.name ?? 'Pinned place'), lat: sel.lat, lon: sel.lon }) }, icon('route'), 'Add as commute')),
      bmErr);

    reverse(sel.lat, sel.lon)
      .then((r) => { if (my === token) addr.textContent = [r.address, r.locality].filter(Boolean).join(', ') || `${sel.lat.toFixed(4)}, ${sel.lon.toFixed(4)}`; })
      .catch(() => { if (my === token) addr.textContent = `${sel.lat.toFixed(4)}, ${sel.lon.toFixed(4)}`; });

    if (i != null) {
      const fit = engine.fit[i];
      body.append(h('div.fit', null,
        h('span.fit-name', null, h('b', null, 'Score'), h('small', null, `${engine.used[i]} of ${engine.totalMetrics} metrics`)),
        track(fit < 0 ? null : fit, fit < 0 ? null : engine.shade(fit)),
        h('b.fit-score', null, fit < 0 ? '—' : fit.toFixed(1)),
        h('span')));
      const rows = h('div.m-rows');
      for (const m of ds.metrics) {
        if (m.missing) continue;
        const r = metricRow(m, i);
        if (r) rows.append(r);
      }
      body.append(rows);
    } else {
      body.append(h('p.muted', null, `No score here. Click inside ${regionOr()}.`));
      // routes still work outside the scored area
      if (store.p.commute.length) {
        const w = weightedMinutes(null);
        body.append(h('section.commute-out', null,
          h('div.cm-head', null, h('h3', null, 'Commute from this spot'), w != null ? h('b', null, `${store.p.commute.length > 1 ? 'Ø ' : ''}${Math.round(w)} min`) : null),
          h('div.m-sub', null, ...store.p.commute.map((p) => commuteLine(p, null)), routeSourceNote())));
      }
    }

    // stations
    const near = nearestStations(sel.lat, sel.lon);
    const st = h('section.stations', null, h('h3', null, 'Nearest stations'));
    if (!near.length) st.append(h('p.muted', null, `None within ${fmtInt(NEAR_M)} m`));
    for (const { s, d } of near) {
      st.append(h('div.station', null,
        h('div.st-top', null, h('b', null, s[2]), h('span.dist' + (d > 1000 ? '.far' : ''), { title: d > 1000 ? 'Too far to count for Transit access (1,000 m)' : null }, `${fmtInt(Math.round(d / 10) * 10)} m · ${Math.max(1, Math.round(d / WALK_M_PER_MIN))} min`)),
        h('div.mode-rows', null, ...lineGroups(s[4]))));
    }
    body.append(st);

    if (area) body.append(notesBlock(area));

    if (area) body.append(ctx.view.rentFold(sel));
  }

  store.subscribe((c) => {
    if (c.has('selection')) render();
    else if (store.t.selection && (c.has('weights') || c.has('enabled') || c.has('commute') || c.has('prices') || c.has('bookmarks'))) render();
  });
  const renderKeepScroll = debounce(() => {
    const top = el.scrollTop;
    render();
    el.scrollTop = top;
  }, 120);
  engine.onChange(() => { if (store.t.selection) renderKeepScroll(); });
  ctx.routes.onChange(() => { if (store.t.selection) renderKeepScroll(); });

  return { el };
}
