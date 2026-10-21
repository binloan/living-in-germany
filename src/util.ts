type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

/** Tiny DOM builder: h('div.class#id', { attr, onclick }, ...children) */
export function h<K extends keyof HTMLElementTagNameMap>(sig: K | string, attrs?: Attrs | null, ...kids: Child[]): HTMLElementTagNameMap[K] & HTMLElement {
  const m = /^([a-z0-9]*)((?:[.#][\w-]+)*)$/i.exec(sig) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'value') (el as unknown as HTMLInputElement).value = String(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el as HTMLElementTagNameMap[K] & HTMLElement;
}

export function append(el: Element, kids: Child[]) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    el.append(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
  }
}

export const clear = (el: Element) => { while (el.firstChild) el.removeChild(el.firstChild); };

export function svg(markup: string, cls = 'icon'): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  const el = t.content.firstElementChild as SVGElement;
  el.classList.add(...cls.split(' '));
  el.setAttribute('aria-hidden', 'true');
  return el;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function raf<A extends unknown[]>(fn: (...a: A) => void) {
  let queued = false, last: A;
  return (...a: A) => { last = a; if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fn(...last); }); };
}

const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
export const fmtInt = (n: number) => nf.format(Math.round(n));
export function fmtVal(v: number | null, decimals = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  return decimals ? v.toFixed(decimals) : fmtInt(v);
}
export const fmtEuro = (n: number) => `${fmtInt(n)} €`;
/** A rent per square metre, decimals only when needed: "18 €/m²", "15.89 €/m²". */
export const fmtSqm = (n: number) => `${(Math.round(n * 100) / 100).toString()} €/m²`;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371008.8, d = Math.PI / 180;
  const dLat = (lat2 - lat1) * d, dLon = (lon2 - lon1) * d;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const uid = () => Math.random().toString(36).slice(2, 9);

/** Readable ink (black/white) on a hex background. */
export function inkOn(hex: string) {
  const c = hex.replace('#', '');
  const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#101a24' : '#ffffff';
}

/** The start of every key the app keeps in the browser. */
export const STORAGE = 'living-in-germany';

/**
 * The keys were called `berlin-fit.*` before the app got its name: copy them to the new names once, so saved weights, spots and notes
 * survive. Run before anything reads the storage. An old key is only taken over where the new one does not exist yet.
 */
export function migrateLegacyStorage(): void {
  try {
    const old = 'berlin-fit.';
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i) ?? '');
    for (const key of keys) {
      if (!key.startsWith(old)) continue;
      const next = `${STORAGE}.${key.slice(old.length)}`;
      const value = localStorage.getItem(key);
      if (value != null && localStorage.getItem(next) == null) localStorage.setItem(next, value);
      localStorage.removeItem(key);
    }
  } catch { /* private mode */ }
}

export function storageGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch { return fallback; }
}
export function storageSet(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

/** A metric value with its unit, e.g. "7 /ha", "1,250 €/mo", "1978". */
export function fmtMetric(m: { decimals: number; unit: string; prefix?: string; fmt?: 'year' }, v: number | null) {
  if (v == null) return '—';
  const num = m.fmt === 'year' ? String(Math.round(v)) : fmtVal(v, m.decimals);
  const unit = m.unit ? (m.unit.startsWith('/') ? m.unit : ` ${m.unit}`) : '';
  return `${m.prefix ?? ''}${num}${unit}`;
}
