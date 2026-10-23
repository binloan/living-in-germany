/**
 * The label of a stretch of track as one picture: a chip in its own colour for every line that runs there, so lines on shared tracks
 * are named together and each name stays on its colour. More than ROW chips wrap into rows.
 */
const ROW = 4;
const RATIO = 2;
const FONT = "700 11px 'Hanken Grotesk Variable', system-ui, -apple-system, 'Segoe UI', sans-serif";

export interface Chip { name: string; color: string; ink: string }

export function chipImage(chips: Chip[]): { width: number; height: number; data: Uint8ClampedArray } {
  const padX = 5, h = 16, gap = 3, rowGap = 3, r = 4, edge = 1.5;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = FONT;
  const widths = chips.map((c) => Math.ceil(probe.measureText(c.name).width) + padX * 2);
  const rows: number[][] = [];
  for (let i = 0; i < chips.length; i += ROW) rows.push(chips.slice(i, i + ROW).map((_, k) => i + k));
  const rowWidth = (row: number[]) => row.reduce((s, i) => s + widths[i], 0) + gap * (row.length - 1);
  const w = Math.max(...rows.map(rowWidth)) + edge * 2;
  const hh = rows.length * h + (rows.length - 1) * rowGap + edge * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * RATIO);
  canvas.height = Math.ceil(hh * RATIO);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(RATIO, RATIO);
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  rows.forEach((row, ri) => {
    let x = edge + (w - edge * 2 - rowWidth(row)) / 2;
    const y = edge + ri * (h + rowGap);
    for (const i of row) {
      ctx.beginPath();
      ctx.roundRect(x, y, widths[i], h, r);
      ctx.lineWidth = edge * 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = chips[i].color;
      ctx.fill();
      ctx.fillStyle = chips[i].ink;
      ctx.fillText(chips[i].name, x + widths[i] / 2, y + h / 2 + 0.5);
      x += widths[i] + gap;
    }
  });
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: px.width, height: px.height, data: px.data };
}

export const CHIP_RATIO = RATIO;
