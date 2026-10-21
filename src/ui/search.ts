import { search, type SearchHit } from '../api';
import { regionSlash } from '../city';
import { icon } from '../icons';
import { clear, debounce, h } from '../util';

interface Opts {
  placeholder: string;
  label: string;
  onPick: (hit: SearchHit) => void;
  clearOnPick?: boolean;
  /** Called when the X empties the field, for whatever the text stood for (the selected spot). */
  onClear?: () => void;
}

export function createSearch({ placeholder, label, onPick, clearOnPick = false, onClear }: Opts) {
  const input = h('input', { type: 'search', placeholder, 'aria-label': label, autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list' }) as HTMLInputElement;
  const list = h('ul.results', { role: 'listbox', hidden: true });
  const clearBtn = h('button.icon-btn.clear', { type: 'button', 'aria-label': 'Clear search', hidden: true }, icon('x'));
  const el = h('div.search', null, icon('search', 'icon search-icon'), input, clearBtn, list);

  let hits: SearchHit[] = [];
  let active = -1;
  let ctrl: AbortController | null = null;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const render = (state: 'results' | 'empty' | 'error') => {
    clear(list);
    if (state === 'results') {
      hits.forEach((hit, i) => {
        const li = h('li', { role: 'option', id: `sr-${i}`, 'aria-selected': 'false', onpointerdown: (e: Event) => { e.preventDefault(); pick(i); } },
          h('span.r-label', null, hit.label), hit.detail ? h('span.r-detail', null, hit.detail) : null);
        list.append(li);
      });
    } else {
      list.append(h('li.r-note', null, state === 'empty' ? `No match in ${regionSlash()}` : 'Search unavailable'));
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  const mark = () => {
    [...list.children].forEach((c, i) => c.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) input.setAttribute('aria-activedescendant', `sr-${active}`);
  };
  function pick(i: number) {
    const hit = hits[i];
    if (!hit) return;
    onPick(hit);
    close();
    input.blur();
    if (clearOnPick) { input.value = ''; clearBtn.hidden = true; } else input.value = hit.label;
  }

  const run = debounce(async (q: string) => {
    ctrl?.abort();
    ctrl = new AbortController();
    try {
      hits = await search(q, ctrl.signal);
      active = -1;
      render(hits.length ? 'results' : 'empty');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') render('error');
    }
  }, 260);

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearBtn.hidden = !q;
    if (q.length < 2) { close(); return; }
    run(q);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); active = (active + 1) % hits.length; mark(); }
    else if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); active = (active - 1 + hits.length) % hits.length; mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) pick(active); else if (hits.length) pick(0); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('focus', () => { if (hits.length && input.value.trim().length >= 2) render('results'); });
  clearBtn.addEventListener('click', () => { input.value = ''; clearBtn.hidden = true; close(); input.focus(); onClear?.(); });

  /** Show a value (e.g. the address of a selected spot) without opening the result list. */
  const setValue = (v: string) => { input.value = v; clearBtn.hidden = !v; close(); };

  return { el, input, setValue };
}
