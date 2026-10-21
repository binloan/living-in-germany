import { SCHEMES, rampRgb } from '../ramp';
import { HEX_R, SHARED_POKES, SHARED_QUIPS, layoutOf, linesOf, type Layout } from '../shape';
import type { CitySummary } from '../types';
import { h } from '../util';

/**
 * The opening screen, in two phases that share one stage of hexagons in the shape of the city:
 *  - choose (only when there is a choice): "I'm looking to live in <city>" and a button; a few hexagons flash now and then.
 *  - loading: the hexagons fill in as the data really arrives, with a running commentary. Hexagons can be poked.
 */

const NS = 'http://www.w3.org/2000/svg';
const scheme = SCHEMES[1];
const FLASH_EVERY_MS = 1500;
const FLASH_FOR_MS = 1100;

interface Hex { el: SVGPathElement; x: number; y: number; on: boolean }

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const hexPath = (cx: number, cy: number, r: number) => {
  const pts = [0, 1, 2, 3, 4, 5].map((k) => { const a = (Math.PI / 180) * (60 * k - 30); return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; });
  return `M${pts.join('L')}Z`;
};
/** The line around the whole silhouette: every hexagon edge that no neighbour shares. */
function outlinePath(l: Layout) {
  const edges = new Map<string, [number, number, number, number]>();
  const key = (x: number, y: number) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  for (const p of l.hexes) {
    const v = [0, 1, 2, 3, 4, 5].map((k) => { const a = (Math.PI / 180) * (60 * k - 30); return [p.x + HEX_R * Math.cos(a), p.y + HEX_R * Math.sin(a)] as const; });
    for (let k = 0; k < 6; k++) {
      const [a, b] = [v[k], v[(k + 1) % 6]];
      const id = [key(...a), key(...b)].sort().join('|');
      if (edges.has(id)) edges.delete(id); else edges.set(id, [a[0], a[1], b[0], b[1]]);
    }
  }
  return [...edges.values()].map(([x1, y1, x2, y2]) => `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`).join('');
}
const rgb = (score: number) => { const [r, g, b] = rampRgb(score, scheme); return `rgb(${r},${g},${b})`; };

export function createSplash() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- the stage: the silhouette of the city
  const svg = svgEl('svg', { class: 'sp-map', role: 'img', 'aria-label': 'A map of hexagons in the shape of the city' });
  const tip = h('div.sp-tip', { hidden: true, 'aria-hidden': 'true' });
  const stage = h('div.sp-stage', null, svg, tip);
  let hexes: Hex[] = [];
  let order: number[] = [];
  let layout: Layout = layoutOf(null);
  let drawn: CitySummary | null = null;
  let quips = SHARED_QUIPS;
  let pokes = SHARED_POKES;
  let swapTimer = 0;

  /** Draws the silhouette of a city; the old one shrinks away first when there is one. */
  function draw(city: CitySummary) {
    drawn = city;
    quips = linesOf(city.splash.quips, SHARED_QUIPS);
    pokes = linesOf(city.splash.pokes, SHARED_POKES);
    const build = () => {
      layout = layoutOf(city.shape);
      svg.replaceChildren();
      svg.setAttribute('viewBox', `0 0 ${layout.width.toFixed(0)} ${layout.height.toFixed(0)}`);
      hexes = layout.hexes.map((p, i) => {
        // the wave: cells nearer the middle appear first
        const d = Math.hypot(p.x - layout.width / 2, p.y - layout.height / 2) / layout.width;
        const el = svgEl('path', { d: hexPath(p.x, p.y, HEX_R - 1.6), class: reduced ? 'sp-hex' : 'sp-hex in' });
        el.style.animationDelay = `${Math.round(d * 420 + (i % 5) * 12)}ms`;
        el.dataset.s = String(Math.round(8 + Math.random() * 90));
        svg.append(el);
        return { el, x: p.x, y: p.y, on: false };
      });
      order = hexes.map((_, i) => i).sort((a, b) => Math.sin(a * 91.7) - Math.sin(b * 91.7)); // fixed shuffle: same reveal every time
      svg.append(svgEl('path', { d: outlinePath(layout), class: 'sp-outline' }));
      for (const l of layout.labels) {
        const t = svgEl('text', { x: String(l.x), y: String(l.y), class: 'sp-label', 'text-anchor': 'middle' });
        t.textContent = l.name;
        svg.append(t);
      }
      revealed = 0;
    };
    window.clearTimeout(swapTimer);
    if (hexes.length && !reduced) {
      svg.classList.add('out');
      swapTimer = window.setTimeout(() => { svg.classList.remove('out'); build(); }, 170);
    } else build();
  }

  // ---- the question
  const ask = h('span#sp-ask.sp-ask-text', null, 'I’m looking to live in');
  const cityName = h('span.sp-city', null, '');
  const select = h('select.sp-select', { 'aria-labelledby': 'sp-ask' }) as HTMLSelectElement;
  const chevron = svgEl('svg', { class: 'sp-chev', viewBox: '0 0 12 8', 'aria-hidden': 'true' });
  chevron.innerHTML = '<path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
  const pick = h('span.sp-pick', null, cityName, chevron, select);
  const go = h('button.sp-go', { type: 'button' }, 'Let’s go') as HTMLButtonElement;
  const choose = h('div.sp-choose', { hidden: true }, h('p.sp-ask', null, ask, ' ', pick), go);

  // ---- the loading commentary
  const title = h('h1', null, '');
  const bar = h('i');
  const quip = h('p.sp-quip', null, quips[0]);
  const poked = h('span.sp-poked', null, '');
  const retry = h('div.sp-retry', { hidden: true });
  const load = h('div.sp-load', { hidden: true },
    title,
    h('div.sp-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar),
    quip,
    h('p.sp-hint', null, 'Poke a hexagon while you wait. ', poked),
    retry);

  // the question lies over the middle of the stage; the loading commentary hangs below it
  stage.append(choose, load);
  const el = h('div.splash', null, h('div.sp-card', null, stage));

  let target = 0, shown = 0, revealed = 0, pokeCount = 0, quipAt = 0, raf = 0, last = performance.now(), finished = false, loading = false;
  const paint = (hex: Hex, score: number) => { hex.el.style.fill = rgb(score); };
  const reveal = (n: number) => {
    while (revealed < Math.min(n, order.length)) {
      const hex = hexes[order[revealed++]];
      hex.on = true;
      hex.el.classList.add('on');
      paint(hex, 8 + Math.random() * 90);
    }
  };

  // ---- choosing: a hexagon or two lights up now and then
  let flashTimer = 0;
  function startFlashing() {
    if (reduced) return;
    window.clearInterval(flashTimer);
    flashTimer = window.setInterval(() => {
      // not under the question: a colour behind the words would make them hard to read
      const words = [...choose.children].map((c) => c.getBoundingClientRect());
      const clear = (x: Hex) => { const b = x.el.getBoundingClientRect(); return words.every((q) => b.right < q.left - 8 || b.left > q.right + 8 || b.bottom < q.top - 8 || b.top > q.bottom + 8); };
      const free = hexes.filter((x) => !x.on && !x.el.classList.contains('flash') && clear(x));
      for (let k = 0; k < 1 + Math.floor(Math.random() * 2) && free.length; k++) {
        const hex = free.splice(Math.floor(Math.random() * free.length), 1)[0];
        paint(hex, 6 + Math.random() * 92);
        hex.el.classList.add('flash');
        window.setTimeout(() => { hex.el.classList.remove('flash'); if (!hex.on) hex.el.style.fill = ''; }, FLASH_FOR_MS);
      }
    }, FLASH_EVERY_MS);
  }

  /** The page title follows the city the page is about. */
  const setTitle = (city: CitySummary) => { document.title = `Living in ${city.name}`; };

  function showLoading(city: CitySummary) {
    loading = true;
    setTitle(city);
    el.classList.remove('is-choosing');
    el.classList.add('is-loading');
    window.clearInterval(flashTimer);
    title.textContent = `Living in ${city.name}`;
    quip.textContent = quips[0];
    load.hidden = false;
    load.classList.add('show');
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  // hexagons under the pointer: poke one to re-roll it and see what lives there
  const showTip = (hex: Hex, text: string) => {
    const box = hex.el.getBoundingClientRect(), st = stage.getBoundingClientRect();
    tip.textContent = text;
    tip.hidden = false;
    tip.style.left = `${box.left + box.width / 2 - st.left}px`;
    tip.style.top = `${box.top - st.top - 4}px`;
  };
  const hexAt = (e: Event) => {
    const t = (e.target as Element).closest?.('.sp-hex') as SVGPathElement | null;
    return t ? hexes.find((x) => x.el === t) : undefined;
  };
  svg.addEventListener('pointermove', (e) => {
    const hex = loading ? hexAt(e) : undefined;
    if (hex && hex.on) showTip(hex, `Score ${hex.el.dataset.s ?? '?'}`);
    else tip.hidden = true;
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });
  svg.addEventListener('pointerdown', (e) => {
    const hex = loading ? hexAt(e) : undefined;
    if (!hex) return;
    const score = Math.round(Math.random() * 100);
    hex.on = true;
    hex.el.classList.add('on');
    hex.el.dataset.s = String(score);
    paint(hex, score);
    hex.el.classList.remove('poke');
    void (hex.el as unknown as HTMLElement).getBoundingClientRect();
    hex.el.classList.add('poke');
    showTip(hex, `${score} · ${pokes[Math.floor(Math.random() * pokes.length)]}`);
    poked.textContent = `Poked: ${++pokeCount}`;
  });

  function tick(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    shown += (target - shown) * Math.min(1, dt * 5); // ease towards the real progress
    if (target - shown < 0.001) shown = target;
    bar.style.width = `${(shown * 100).toFixed(1)}%`;
    el.querySelector('.sp-bar')?.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
    reveal(Math.round(shown * hexes.length));
    if (!reduced && now - quipAt > 1900) { // a new line now and then, and one hexagon changes its mind
      quipAt = now;
      quip.textContent = quips[Math.floor(Math.random() * quips.length)];
      const live = hexes.filter((x) => x.on);
      if (live.length) { const hex = live[Math.floor(Math.random() * live.length)]; const s = Math.random() * 100; hex.el.dataset.s = String(Math.round(s)); paint(hex, s); }
    }
    if (!finished || shown < 1) raf = requestAnimationFrame(tick);
  }

  return {
    el,
    /** The question, with the stage showing the selected city. Resolves with the id of the city when "Let's go" is pressed. */
    choose(cities: CitySummary[], selectedId: string): Promise<string> {
      select.replaceChildren(...cities.map((c) => h('option', { value: c.id }, c.name)));
      select.value = selectedId;
      const current = () => cities.find((c) => c.id === select.value) ?? cities[0];
      cityName.textContent = current().name;
      setTitle(current());
      draw(current());
      choose.hidden = false;
      el.classList.add('is-choosing');
      startFlashing();
      go.focus({ preventScroll: true });
      select.addEventListener('change', () => { cityName.textContent = current().name; setTitle(current()); draw(current()); });
      return new Promise((resolve) => {
        go.addEventListener('click', () => {
          select.disabled = true;
          go.disabled = true;
          choose.classList.add('going');
          window.setTimeout(() => { choose.hidden = true; }, reduced ? 0 : 260);
          showLoading(current());
          resolve(current().id);
        }, { once: true });
      });
    },
    /** Straight to loading (an address names the city, or the visitor chose before). */
    begin(city: CitySummary) {
      if (drawn !== city) draw(city);
      showLoading(city);
    },
    /** fraction 0..1 of the real work done; `text` says what is happening, for screen readers (the visible line is the running commentary) */
    progress(fraction: number, text?: string) {
      target = Math.max(target, Math.min(1, fraction));
      if (text) el.querySelector('.sp-bar')?.setAttribute('aria-valuetext', text);
    },
    /** everything is ready: fill the rest, then fade out */
    done() {
      finished = true;
      target = 1;
      reveal(hexes.length);
      setTimeout(() => {
        el.classList.add('gone');
        setTimeout(() => { cancelAnimationFrame(raf); el.remove(); }, 500);
      }, reduced ? 0 : 350);
    },
    fail(text: string) {
      finished = true;
      window.clearInterval(flashTimer);
      cancelAnimationFrame(raf);
      load.hidden = false;
      load.classList.add('show');
      quip.textContent = `The hexagons are embarrassed. ${text}`;
      quip.setAttribute('role', 'alert');
      retry.hidden = false;
      retry.replaceChildren(h('button.btn', { type: 'button', onclick: () => location.reload() }, 'Reload'));
    },
  };
}
