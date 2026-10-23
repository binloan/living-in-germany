/**
 * Labels for lines that share tracks. The map draws every line on the physical track, so on a shared stretch the strokes lie on top
 * of each other and a label of one line would sit on the colour of another. Instead each stretch gets one label that names every
 * line running there. Lines are grouped per kind (S, U, tram, regional), as they are drawn and switched on and off per kind.
 */
const M = 111195;
const STEP_M = 60; // spacing of the points a line is sampled at
const CELL_M = 40; // two lines whose samples fall in neighbouring cells of this size count as running together
const MIN_RUN = 3; // a change of the line set that lasts fewer samples is ignored (a crossing, a short loop)

export interface LabelLine {
  properties: { mode: string; name: string };
  geometry: GeoJSON.Geometry;
}

export interface LabelStretch {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  /** names: JSON array of the lines on the stretch; key: the same joined by "|" (names the chip image); n: how many */
  properties: { mode: string; names: string; key: string; n: number };
}

const collator = new Intl.Collator('de', { numeric: true });
const natural = collator.compare;

/** The stretches to label, per feature a polyline of a point every STEP_M metres. */
export function lineLabels(lines: LabelLine[]): { type: 'FeatureCollection'; features: LabelStretch[] } {
  const features: LabelStretch[] = [];
  const modes = [...new Set(lines.map((l) => l.properties.mode))];
  for (const mode of modes) {
    const group = lines.filter((l) => l.properties.mode === mode);
    const parts: { line: number; pts: { x: number; y: number; ll: [number, number] }[] }[] = [];
    let lat0: number | null = null;
    group.forEach((l, line) => {
      const g = l.geometry;
      const polys: number[][][] = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const poly of polys) {
        if (poly.length < 2) continue;
        lat0 ??= poly[0][1];
        const kx = M * Math.cos((lat0 * Math.PI) / 180);
        const pts: { x: number; y: number; ll: [number, number] }[] = [];
        let carry = 0;
        pts.push({ x: poly[0][0] * kx, y: poly[0][1] * M, ll: [poly[0][0], poly[0][1]] });
        for (let i = 1; i < poly.length; i++) {
          const [ax, ay] = [poly[i - 1][0], poly[i - 1][1]], [bx, by] = [poly[i][0], poly[i][1]];
          const len = Math.hypot((bx - ax) * kx, (by - ay) * M);
          let at = STEP_M - carry;
          while (at < len) {
            const t = at / len;
            pts.push({ x: (ax + (bx - ax) * t) * kx, y: (ay + (by - ay) * t) * M, ll: [ax + (bx - ax) * t, ay + (by - ay) * t] });
            at += STEP_M;
          }
          carry = len - (at - STEP_M);
        }
        const last = poly[poly.length - 1];
        pts.push({ x: last[0] * kx, y: last[1] * M, ll: [last[0], last[1]] });
        parts.push({ line, pts });
      }
    });
    if (!parts.length) continue;

    // which lines have a sample in which cell
    const SPAN = 400000;
    const cellId = (cx: number, cy: number) => (cx + 200000) * SPAN + (cy + 200000);
    const cellOf = (x: number, y: number) => [Math.floor(x / CELL_M), Math.floor(y / CELL_M)] as const;
    const grid = new Map<number, Set<number>>();
    for (const { line, pts } of parts) {
      for (const p of pts) {
        const [cx, cy] = cellOf(p.x, p.y);
        const k = cellId(cx, cy);
        (grid.get(k) ?? grid.set(k, new Set()).get(k)!).add(line);
      }
    }
    const keyOfCell = new Map<number, string>();
    const keyAt = (x: number, y: number) => {
      const [cx, cy] = cellOf(x, y);
      const id = cellId(cx, cy);
      let key = keyOfCell.get(id);
      if (key === undefined) {
        const on = new Set<number>();
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const l of grid.get(cellId(cx + dx, cy + dy)) ?? []) on.add(l);
        key = [...on].map((l) => group[l].properties.name).sort(natural).join('|');
        keyOfCell.set(id, key);
      }
      return key;
    };

    const done = new Map<string, Set<number>>(); // key -> cells of this stretch already labelled by another line of it
    for (const { pts } of parts) {
      const keys = pts.map((p) => keyAt(p.x, p.y));
      // a change of the line set counts only when it lasts: shorter blips keep the set before them
      const stable: string[] = [];
      let cur = keys[0];
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] !== cur) {
          let j = i;
          while (j < keys.length && keys[j] === keys[i]) j++;
          if (j - i >= MIN_RUN || j === keys.length) cur = keys[i];
        }
        stable.push(cur);
      }
      for (let i = 0; i < pts.length;) {
        let j = i;
        while (j + 1 < pts.length && stable[j + 1] === stable[i]) j++;
        const key = stable[i];
        if (j > i && j - i + 1 >= MIN_RUN) {
          const seen = done.get(key) ?? done.set(key, new Set()).get(key)!;
          const cells = pts.slice(i, j + 1).map((p) => cellOf(p.x, p.y));
          const covered = cells.filter(([cx, cy]) => {
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (seen.has(cellId(cx + dx, cy + dy))) return true;
            return false;
          }).length;
          if (covered < cells.length * 0.6) {
            for (const [cx, cy] of cells) seen.add(cellId(cx, cy));
            const names = key.split('|');
            features.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: pts.slice(i, j + 1).map((p) => p.ll) },
              properties: { mode, names: JSON.stringify(names), key, n: names.length },
            });
          }
        }
        i = j + 1;
      }
    }
  }
  return { type: 'FeatureCollection', features };
}
