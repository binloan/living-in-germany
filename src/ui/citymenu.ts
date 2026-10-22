import { icon } from '../icons';
import { h } from '../util';

/**
 * The city picker: a button with the city's name and a list that opens under it. It stands in for the system's `<select>` on the start
 * screen and in the panel heading, so the list looks like the rest of the app. A select-only combobox: the focus stays on the button
 * and the highlighted option is named by aria-activedescendant.
 */

export interface CityOption { id: string; name: string }
export interface CityMenu {
  el: HTMLElement;
  /** The button, for focus and for the screen reader's name. */
  trigger: HTMLButtonElement;
  value(): string;
  /** Shows another city without calling onChange. */
  set(id: string): void;
  disable(on: boolean): void;
}

let counter = 0;

/** The option to highlight after an arrow, Home or End key; null when the key is not one of those. */
export function moveIndex(key: string, index: number, count: number): number | null {
  if (!count) return null;
  switch (key) {
    case 'ArrowDown': return Math.min(count - 1, index + 1);
    case 'ArrowUp': return Math.max(0, index - 1);
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

/** Type-ahead: the first option after `from` (wrapping round) whose name starts with the typed letters, -1 when none does. */
export function matchIndex(names: string[], typed: string, from: number): number {
  const t = typed.toLowerCase();
  // one letter typed again and again steps through the names that start with it; a longer word looks from the current option on
  const start = t.length === 1 ? from + 1 : from;
  for (let k = 0; k < names.length; k++) {
    const i = (start + k + names.length) % names.length;
    if (names[i].toLowerCase().startsWith(t)) return i;
  }
  return -1;
}

export function createCityMenu(opts: {
  options: CityOption[];
  selected: string;
  /** 'splash' is the big plum word of the start screen, 'panel' the ink heading of the side panel */
  variant: 'splash' | 'panel';
  /** Ids of the elements that say what the choice is about ("Living in", "I’m looking to live in"); the button's own text follows them. */
  labelledBy: string;
  onChange(id: string): void;
}): CityMenu {
  const { options, variant } = opts;
  const uid = `cy${++counter}`;
  let index = Math.max(0, options.findIndex((o) => o.id === opts.selected));
  let active = index;
  let open = false;
  let typed = '';
  let typedAt = 0;

  const label = h('span.cy-label', null, options[index]?.name ?? '');
  const chevron = icon('chevron', 'cy-chev');
  const trigger = h('button.cy-trigger', {
    type: 'button', id: `${uid}-btn`, role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': `${uid}-list`,
    'aria-labelledby': `${opts.labelledBy} ${uid}-btn`,
  }, label, chevron) as HTMLButtonElement;
  const items = options.map((o, i) => h('li.cy-opt', { id: `${uid}-${i}`, role: 'option', 'aria-selected': String(i === index) },
    h('span', null, o.name), icon('check', 'cy-check')));
  const list = h('ul.cy-list', { id: `${uid}-list`, role: 'listbox', hidden: true, 'aria-labelledby': `${opts.labelledBy}` }, ...items);
  const el = h(`span.cy-menu.cy-${variant}`, null, trigger, list);

  const paint = () => {
    items.forEach((li, i) => {
      li.classList.toggle('on', open && i === active);
      li.setAttribute('aria-selected', String(i === index));
    });
    if (open) trigger.setAttribute('aria-activedescendant', `${uid}-${active}`); else trigger.removeAttribute('aria-activedescendant');
  };
  const show = (on: boolean) => {
    open = on;
    list.hidden = !on;
    trigger.setAttribute('aria-expanded', String(on));
    if (on) { active = index; document.addEventListener('pointerdown', outside, true); } else document.removeEventListener('pointerdown', outside, true);
    paint();
  };
  function outside(e: Event) { if (!el.contains(e.target as Node)) show(false); }

  function choose(i: number) {
    show(false);
    trigger.focus({ preventScroll: true });
    if (i === index) return;
    index = i;
    label.textContent = options[i].name;
    paint();
    opts.onChange(options[i].id);
  }

  trigger.addEventListener('click', () => show(!open));
  trigger.addEventListener('blur', () => { if (open) show(false); });
  trigger.addEventListener('keydown', (e) => {
    const moved = moveIndex(e.key, open ? active : index, options.length);
    if (e.key === 'Escape') {
      if (!open) return; // not ours: the page's Escape (close the spot card) goes on
      e.stopPropagation();
      show(false);
      return;
    }
    if (e.key === 'Tab') { if (open) show(false); return; }
    if (moved != null) {
      e.preventDefault();
      if (!open) show(true);
      active = moved;
      paint();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) choose(active); else show(true);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = performance.now();
      typed = now - typedAt > 700 ? e.key : typed + e.key;
      typedAt = now;
      const hit = matchIndex(options.map((o) => o.name), typed, open ? active : index);
      if (hit < 0) return;
      if (!open) show(true);
      active = hit;
      paint();
    }
  });
  // a press on the list must not take the focus from the button, or the blur above would close the list before the click lands
  list.addEventListener('pointerdown', (e) => e.preventDefault());
  items.forEach((li, i) => {
    li.addEventListener('pointermove', () => { if (active !== i) { active = i; paint(); } });
    li.addEventListener('click', () => choose(i));
  });

  return {
    el,
    trigger,
    value: () => options[index].id,
    set(id) {
      const i = options.findIndex((o) => o.id === id);
      if (i < 0) return;
      index = i;
      label.textContent = options[i].name;
      paint();
    },
    disable(on) { trigger.disabled = on; if (on && open) show(false); },
  };
}
