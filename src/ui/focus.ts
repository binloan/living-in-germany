import { icon } from '../icons';
import { store } from '../store';
import { clear, h, inkOn } from '../util';
import type { Ctx } from './ctx';

/** Pill shown while a station is focused: its name, its lines, and a way back to the full map. */
export function buildFocus(ctx: Ctx) {
  const el = h('div.focus-chip', { hidden: true, role: 'status' });

  const sync = () => {
    const f = store.t.focus;
    el.hidden = !f;
    clear(el);
    if (!f) return;
    el.append(
      h('b', null, f.name),
      h('span.fc-lines', null, ...f.lines.slice(0, 14).map((n) => {
        const c = ctx.ds.lineColor.get(n) ?? '#5f6b78';
        return h('span.line', { style: `background:${c};color:${inkOn(c)}` }, n);
      })),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Show the full map again', onclick: () => store.setT({ focus: null }) }, icon('x')));
  };
  store.subscribe((c) => { if (c.has('focus')) sync(); });
  sync();
  return { el };
}
