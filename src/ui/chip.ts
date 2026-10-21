import { rampRgb } from '../ramp';
import { fmtInt, h } from '../util';

const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** A score as a coloured chip: the fill follows the heatmap colours, the digits switch between dark and white for contrast. */
export function chip(score: number | null, shade = score, decimals = 0) {
  if (score == null || shade == null) return h('span.cmp-chip.none', null, '—');
  const rgb = rampRgb(shade);
  const l = lum(rgb);
  const dark = (l + 0.05) / (lum([16, 26, 36]) + 0.05) > 1.05 / (l + 0.05);
  return h('span.cmp-chip', { style: `background:rgb(${rgb.join(' ')});color:${dark ? '#101a24' : '#fff'}` }, decimals ? score.toFixed(decimals) : fmtInt(score));
}
