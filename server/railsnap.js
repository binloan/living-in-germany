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
const SOFT_SNAP_M = 150;
const OFF_LINE = 1.8; // cost factor of a track that is not the line's own
const BRIDGE_M = 1500;

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
    nets[name] = buildNet(g, raw.refs);
  }
  // all three networks as one graph, for lines that change between them (a U-Bahn in a tunnel and on the surface, a tram on rail track)
  const key = (p) => `${p[0]},${p[1]}`;
  const union = { nodes: [], edges: [] };
  const at = new Map();
  for (const [name, g] of Object.entries(raw)) {
    if (name === 'refs') continue;
    const map = g.nodes.map((p) => {
      const k = key(p);
      if (!at.has(k)) { at.set(k, union.nodes.length); union.nodes.push(p); }
      return at.get(k);
    });
    for (const [a, b, inner, rs] of g.edges) union.edges.push([map[a], map[b], inner, rs]);
  }
  nets.all = buildNet(union, raw.refs);
  return nets;
}

function buildNet(g, refList) {
  const edges = g.edges.map(([a, b, inner, rs]) => {
    const pts = [g.nodes[a]];
    for (let i = 0; i < inner.length; i += 2) pts.push([inner[i], inner[i + 1]]);
    pts.push(g.nodes[b]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    return { a, b, pts, cum, len: cum.at(-1), refs: new Set((rs ?? []).map((i) => refList[i])) };
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
  return { nodes: g.nodes, edges, adj, cells };
}

/** Nearest point on any track segment within SNAP_M. */
function snapPoint(net, p, allow, maxM = SNAP_M) {
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
      if (d < maxM && (!best || d < best.d)) {
        const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const segLen = e.cum[k] - e.cum[k - 1];
        best = { ei, k, q, d, pos: e.cum[k - 1] + segLen * t };
      }
    }
  }
  return best;
}

/** The track point a stop sits on: with `soft`, the nearest allowed track if one is close, else the nearest track of any kind. */
function snapStop(net, p, allow, soft) {
  return soft ? snapPoint(net, p, allow, SOFT_SNAP_M) ?? snapPoint(net, p, null) : snapPoint(net, p, allow);
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
function pathBetween(net, A, B, allow, soft = 0) {
  // soft: tracks outside `allow` are not forbidden but cost `soft` times their length, and a stop sits on the nearest track of any
  // kind unless one of the allowed tracks is close by (a relation that misses the ways of a station then cannot pull the line off it)
  const s = snapStop(net, A, allow, soft), t = snapStop(net, B, allow, soft);
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
        if (allow && !allow(e) && !soft) continue;
        relax(to, allow && !allow(e) ? e.len * soft : e.len, fwd ? e.pts : [...e.pts].reverse());
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
function pairPath(net, a, b, allow, soft = 0) {
  const onLine = allow ? pathBetween(net, a, b, allow, soft) : null;
  const any = !onLine || allow ? pathBetween(net, a, b, null) : null;
  let seg = onLine ?? any;
  if (onLine && any && pathLen(onLine) > pathLen(any) * 1.25 + 500) seg = any;
  return seg;
}

function trace(net, stops, allow) {
  const out = [];
  let failed = 0;
  for (let i = 1; i < stops.length; i++) {
    const seg = pairPath(net, stops[i - 1], stops[i], allow);
    if (!seg) { failed++; out.push(stops[i - 1], stops[i]); continue; }
    out.push(...seg);
  }
  return failed > Math.max(0, Math.floor((stops.length - 1) / 3)) ? null : out;
}

/** The spellings of a line ref (with and without the space of "RB 22") that some track of the network carries. */
const refsOf = (net, ref) => {
  const cand = [...new Set([ref, ref?.replace(/\s+/g, '')].filter(Boolean))];
  return cand.filter((c) => net.edges.some((e) => e.refs.has(c)));
};

/**
 * The drawn path of a line through the stops of one of its trips (for the map's line layer, built at data time). Like snapLeg, but a
 * pair of stops that no track connects (a stretch OSM does not carry) is joined by a straight connector between the two track points
 * when they are less than BRIDGE_M apart, and left as a gap when they are further: { parts: [lon, lat][][], gaps, bridged } or null.
 */
export function traceLine(city, mode, stops, ref) {
  const nets = load(city);
  const own = nets[NET_OF[mode]] ? traceOn(nets[NET_OF[mode]], stops, ref) : null;
  if (own && !own.gaps && !own.bridged) return own;
  const all = nets.all ? traceOn(nets.all, stops, ref) : null;
  const open = (r) => r.gaps * 1000 + r.bridged;
  return all && (!own || open(all) < open(own)) ? all : own;
}

function traceOn(net, stops, ref) {
  if (stops.length < 2) return null;
  const known = refsOf(net, ref);
  const allow = known.length ? (e) => known.some((c) => e.refs.has(c)) : null;
  const parts = [];
  let cur = [], gaps = 0, bridged = 0;
  for (let i = 1; i < stops.length; i++) {
    let seg = pairPath(net, stops[i - 1], stops[i], allow, OFF_LINE);
    if (!seg) {
      const s = snapStop(net, stops[i - 1], allow, OFF_LINE), t = snapStop(net, stops[i], allow, OFF_LINE);
      if (s && t && dist(s.q, t.q) <= BRIDGE_M) { seg = [s.q, t.q]; bridged++; }
    }
    if (!seg) { gaps++; if (cur.length > 1) parts.push(cur); cur = []; continue; }
    for (const p of seg) { const q = cur.at(-1); if (!q || q[0] !== p[0] || q[1] !== p[1]) cur.push(p); }
  }
  if (cur.length > 1) parts.push(cur);
  return { parts: parts.map((c) => c.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)])), gaps, bridged };
}

/**
 * Track-following geometry for a transit leg through its stops ([lon, lat] each, in travel order).
 * `ref` is the line (RB22, S3, M10 ...): only tracks that OSM assigns to that line are used, so the
 * path is the one the train really takes. Falls back to any track, then to null (router geometry kept).
 */
export function snapLeg(city, mode, stops, ref) {
  const net = load(city)[NET_OF[mode]];
  if (!net || stops.length < 2) return null;
  const known = refsOf(net, ref);
  let out = null;
  if (known.length) out = trace(net, stops, (e) => known.some((c) => e.refs.has(c)));
  out ??= trace(net, stops, null);
  return out ? out.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]) : null;
}
