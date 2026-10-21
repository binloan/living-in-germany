import fs from 'node:fs';
import { cityPath } from './cities.js';

/**
 * Lays transit legs exactly on the OpenStreetMap tracks (the city's generated/rail-graph.json, built by
 * scripts/data/02-rail-graph.mjs). The router only returns a few points for trains, so each leg is
 * rebuilt as the shortest track path through its real stops.
 */
const M = 111_195;
const NET_OF = { R: 'rail', S: 'rail', U: 'subway', T: 'tram' };
const CELL_X = 0.003, CELL_Y = 0.002;
const SNAP_M = 260;

const kx = (lat) => M * Math.cos((lat * Math.PI) / 180);
const dist = (a, b) => Math.hypot((a[0] - b[0]) * kx(a[1]), (a[1] - b[1]) * M);

const graphs = new Map(); // city id -> its track networks, built on first use

function load(city) {
  if (graphs.has(city.id)) return graphs.get(city.id);
  const nets = {};
  graphs.set(city.id, nets);
  const file = cityPath(city, 'generated', 'rail-graph.json');
  if (!fs.existsSync(file)) return nets;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [name, g] of Object.entries(raw)) {
    if (name === 'refs') continue;
    const edges = g.edges.map(([a, b, inner, rs]) => {
      const pts = [g.nodes[a]];
      for (let i = 0; i < inner.length; i += 2) pts.push([inner[i], inner[i + 1]]);
      pts.push(g.nodes[b]);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
      return { a, b, pts, cum, len: cum.at(-1), refs: new Set((rs ?? []).map((i) => raw.refs[i])) };
    });
    const adj = g.nodes.map(() => []);
    edges.forEach((e, i) => {
      adj[e.a].push({ e: i, to: e.b, fwd: true });
      adj[e.b].push({ e: i, to: e.a, fwd: false });
    });
    const cells = new Map();
    edges.forEach((e, ei) => {
      for (let k = 1; k < e.pts.length; k++) {
        const mx = (e.pts[k - 1][0] + e.pts[k][0]) / 2, my = (e.pts[k - 1][1] + e.pts[k][1]) / 2;
        const key = `${Math.floor(mx / CELL_X)}:${Math.floor(my / CELL_Y)}`;
        (cells.get(key) || cells.set(key, []).get(key)).push([ei, k]);
      }
    });
    nets[name] = { nodes: g.nodes, edges, adj, cells };
  }
  return nets;
}

/** Nearest point on any track segment within SNAP_M. */
function snapPoint(net, p, allow) {
  const cx = Math.floor(p[0] / CELL_X), cy = Math.floor(p[1] / CELL_Y);
  let best = null;
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
    for (const [ei, k] of net.cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
      const e = net.edges[ei];
      if (allow && !allow(e)) continue;
      const a = e.pts[k - 1], b = e.pts[k];
      const sx = kx(p[1]);
      const ax = a[0] * sx, ay = a[1] * M, bx = b[0] * sx, by = b[1] * M, px = p[0] * sx, py = p[1] * M;
      const vx = bx - ax, vy = by - ay;
      const t = vx || vy ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy))) : 0;
      const d = Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
      if (d < SNAP_M && (!best || d < best.d)) {
        const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const segLen = e.cum[k] - e.cum[k - 1];
        best = { ei, k, q, d, pos: e.cum[k - 1] + segLen * t };
      }
    }
  }
  return best;
}

/** Points of edge `e` between positions (metres along the edge) from..to, in travel order. */
function slice(e, from, to) {
  const out = [];
  const at = (pos) => {
    let k = 1;
    while (k < e.cum.length - 1 && e.cum[k] < pos) k++;
    const seg = e.cum[k] - e.cum[k - 1] || 1;
    const t = (pos - e.cum[k - 1]) / seg;
    return [e.pts[k - 1][0] + (e.pts[k][0] - e.pts[k - 1][0]) * t, e.pts[k - 1][1] + (e.pts[k][1] - e.pts[k - 1][1]) * t];
  };
  const lo = Math.min(from, to), hi = Math.max(from, to);
  out.push(at(lo));
  for (let k = 1; k < e.pts.length - 1; k++) if (e.cum[k] > lo && e.cum[k] < hi) out.push(e.pts[k]);
  out.push(at(hi));
  return from <= to ? out : out.reverse();
}

class Heap {
  constructor() { this.a = []; }
  push(x) {
    const a = this.a; a.push(x);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; if (!a.length) return undefined;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

/** Shortest track path between two points on one network, as [lon, lat][] or null. */
function pathBetween(net, A, B, allow) {
  const s = snapPoint(net, A, allow), t = snapPoint(net, B, allow);
  if (!s || !t) return null;
  const N = net.nodes.length, S = N, T = N + 1;
  const cap = Math.max(30_000, dist(A, B) * 6); // trains may take big detours (loops, reversals at junctions)

  // virtual links from the two snap points to the ends of their edges
  const extra = new Map(); // node -> [{to, len, geom}]
  const addLink = (u, v, len, geom) => { (extra.get(u) || extra.set(u, []).get(u)).push({ to: v, len, geom }); };
  const attach = (v, sp) => {
    const e = net.edges[sp.ei];
    const toA = slice(e, sp.pos, 0), toB = slice(e, sp.pos, e.len);
    addLink(v, e.a, sp.pos, toA); addLink(e.a, v, sp.pos, [...toA].reverse());
    addLink(v, e.b, e.len - sp.pos, toB); addLink(e.b, v, e.len - sp.pos, [...toB].reverse());
  };
  attach(S, s);
  attach(T, t);
  if (s.ei === t.ei) {
    const g = slice(net.edges[s.ei], s.pos, t.pos);
    addLink(S, T, Math.abs(t.pos - s.pos), g);
    addLink(T, S, Math.abs(t.pos - s.pos), [...g].reverse());
  }

  const d = new Map([[S, 0]]);
  const prev = new Map();
  const heap = new Heap();
  heap.push([0, S]);
  while (heap.size) {
    const [du, u] = heap.pop();
    if (du > (d.get(u) ?? Infinity)) continue;
    if (u === T) break;
    if (du > cap) break;
    const relax = (v, w, geom) => {
      const nd = du + w;
      if (nd < (d.get(v) ?? Infinity)) { d.set(v, nd); prev.set(v, [u, geom]); heap.push([nd, v]); }
    };
    if (u < N) {
      for (const { e: ei, to, fwd } of net.adj[u]) {
        const e = net.edges[ei];
        if (allow && !allow(e)) continue;
        relax(to, e.len, fwd ? e.pts : [...e.pts].reverse());
      }
    }
    for (const l of extra.get(u) ?? []) relax(l.to, l.len, l.geom);
  }
  if (!d.has(T)) return null;
  const parts = [];
  for (let v = T; v !== S;) { const [u, geom] = prev.get(v); parts.push(geom); v = u; }
  parts.reverse();
  const out = [];
  for (const g of parts) for (const p of g) {
    const last = out.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

const pathLen = (c) => c.reduce((sum, q, k) => (k ? sum + dist(c[k - 1], q) : 0), 0);

/**
 * Per stop pair: the path on the line's own tracks, unless it is a long detour compared to the shortest
 * track path (the relation data can be incomplete), then the shortest path.
 */
function trace(net, stops, allow) {
  const out = [];
  let failed = 0;
  for (let i = 1; i < stops.length; i++) {
    const onLine = allow ? pathBetween(net, stops[i - 1], stops[i], allow) : null;
    const any = !onLine || allow ? pathBetween(net, stops[i - 1], stops[i], null) : null;
    let seg = onLine ?? any;
    if (onLine && any && pathLen(onLine) > pathLen(any) * 1.25 + 500) seg = any;
    if (!seg) { failed++; out.push(stops[i - 1], stops[i]); continue; }
    out.push(...seg);
  }
  return failed > Math.max(0, Math.floor((stops.length - 1) / 3)) ? null : out;
}

/**
 * Track-following geometry for a transit leg through its stops ([lon, lat] each, in travel order).
 * `ref` is the line (RB22, S3, M10 ...): only tracks that OSM assigns to that line are used, so the
 * path is the one the train really takes. Falls back to any track, then to null (router geometry kept).
 */
export function snapLeg(city, mode, stops, ref) {
  const net = load(city)[NET_OF[mode]];
  if (!net || stops.length < 2) return null;
  const cand = [...new Set([ref, ref?.replace(/\s+/g, '')].filter(Boolean))];
  const known = cand.filter((c) => net.edges.some((e) => e.refs.has(c)));
  let out = null;
  if (known.length) out = trace(net, stops, (e) => known.some((c) => e.refs.has(c)));
  out ??= trace(net, stops, null);
  return out ? out.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]) : null;
}
