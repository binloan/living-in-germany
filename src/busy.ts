import { h } from './util';

/** Small status pill shown while the heat layer or commute data is being (re)built. */
const el = h('div.busy', { role: 'status', 'aria-live': 'polite', hidden: true }, h('span.spin', { 'aria-hidden': 'true' }), h('span.busy-label', null, ''));
const label = el.querySelector('.busy-label') as HTMLElement;

const MIN_VISIBLE_MS = 600;
const active = new Map<symbol, string>();
let shownAt = 0;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function render() {
  clearTimeout(hideTimer);
  if (active.size) {
    label.textContent = [...active.values()].at(-1) ?? '';
    if (el.hidden) { el.hidden = false; shownAt = performance.now(); }
    return;
  }
  const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - shownAt));
  hideTimer = setTimeout(() => { if (!active.size) el.hidden = true; }, wait);
}

export const busy = {
  el,
  /** Returns a function that ends this task. The pill stays up at least 600 ms so it is noticeable. */
  start(text: string) {
    const id = Symbol();
    active.set(id, text);
    render();
    return () => { active.delete(id); render(); };
  },
};
