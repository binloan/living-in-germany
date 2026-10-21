// OpenStreetMap track network (rail incl. S-Bahn, subway, tram) -> cities/<id>/generated/rail-graph.json
// Used by the server to lay commute routes exactly on the tracks. Run: node scripts/data/02-rail-graph.mjs
import path from 'node:path';
import { CITY, RAW, GEN, writeJson } from './lib.mjs';
import { overpass, tiles } from './lib_overpass.mjs';
import { snapLeg } from '../../server/railsnap.js';

const BBOX = [CITY.bbox.s, CITY.bbox.w, CITY.bbox.n, CITY.bbox.e]; // south, west, north, east
const NETS = { rail: 'rail', light_rail: 'rail', subway: 'subway', tram: 'tram' };

const ql = (b) => `[out:json][timeout:300];
(
  way["railway"~"^(rail|light_rail)$"]["service"!~"yard|siding|spur|industrial|military"]["usage"!~"industrial|military|tourism"](${b.join(',')});
  way["railway"="subway"]["service"!~"yard|siding|spur"](${b.join(',')});
  way["railway"="tram"]["service"!~"yard|siding|spur"](${b.join(',')});
);
out geom;`;

// ---- download (tiled, cached)
const ways = new Map(); // osm way id -> { net, pts: [[lon, lat]] }
let i = 0;
for (const b of tiles(BBOX, 3, 2, 0.01)) {
  const j = await overpass(ql(b), path.join(RAW, 'osm_rail', `tile-${i++}.json`));
  for (const el of j.elements ?? []) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const net = NETS[el.tags?.railway];
    if (net && !ways.has(el.id)) ways.set(el.id, { net, pts: el.geometry.map((g) => [g.lon, g.lat]) });
  }
}
console.log(`ways: ${ways.size}`);

// ---- which line (ref) runs on which way: OSM route relations (RB22, S3, U8, M10, ...)
const relQl = (b) => `[out:json][timeout:300];
rel["route"~"^(train|light_rail|subway|tram)$"]["ref"](${b.join(',')});
out body;`;
const wayRefs = new Map(); // way id -> Set(ref)
i = 0;
for (const b of tiles(BBOX, 3, 2, 0.01)) {
  const j = await overpass(relQl(b), path.join(RAW, 'osm_rail', `rel-${i++}.json`));
  for (const el of j.elements ?? []) {
    if (el.type !== 'relation' || !el.tags?.ref) continue;
    const ref = String(el.tags.ref).trim();
    for (const m of el.members ?? []) {
      if (m.type !== 'way') continue;
      (wayRefs.get(m.ref) || wayRefs.set(m.ref, new Set()).get(m.ref)).add(ref);
    }
  }
}
console.log(`ways with a line: ${wayRefs.size}`);

// ---- per network: node graph -> contract chains (same lines on both sides) -> simplify polylines
const key = (p) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;
const M = 111195;
function perpDist(p, a, b) {
  const kx = M * Math.cos((a[1] * Math.PI) / 180);
  const ax = a[0] * kx, ay = a[1] * M, bx = b[0] * kx, by = b[1] * M, px = p[0] * kx, py = p[1] * M;
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  let max = 0, idx = 0;
  for (let k = 1; k < pts.length - 1; k++) { const d = perpDist(pts[k], pts[0], pts.at(-1)); if (d > max) { max = d; idx = k; } }
  if (max <= tol) return [pts[0], pts.at(-1)];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}
const r5 = (v) => Math.round(v * 1e5) / 1e5;

const refList = [];
const refIdx = new Map();
const ridx = (r) => { let v = refIdx.get(r); if (v == null) { v = refList.length; refIdx.set(r, v); refList.push(r); } return v; };

const out = {};
for (const net of ['rail', 'subway', 'tram']) {
  const nodeIdx = new Map();
  const nodePts = [];
  const adj = [];
  const segRefs = new Map(); // "a|b" (a<b) -> Set(ref)
  const id = (p) => {
    const k = key(p);
    let n = nodeIdx.get(k);
    if (n == null) { n = nodePts.length; nodeIdx.set(k, n); nodePts.push(p); adj.push(new Set()); }
    return n;
  };
  for (const [wid, w] of ways) {
    if (w.net !== net) continue;
    const refs = wayRefs.get(wid);
    for (let k = 1; k < w.pts.length; k++) {
      const x = id(w.pts[k - 1]), y = id(w.pts[k]);
      if (x === y) continue;
      adj[x].add(y); adj[y].add(x);
      const sk = x < y ? `${x}|${y}` : `${y}|${x}`;
      const set = segRefs.get(sk) || segRefs.set(sk, new Set()).get(sk);
      if (refs) for (const r of refs) set.add(r);
    }
  }
  const sig = (x, y) => [...(segRefs.get(x < y ? `${x}|${y}` : `${y}|${x}`) ?? [])].sort().join(',');
  const isJ = (n) => {
    if (adj[n].size !== 2) return true;
    const [p, q] = [...adj[n]];
    return sig(n, p) !== sig(n, q);
  };
  const seen = new Set();
  const edges = [];
  const junc = new Map();
  const jid = (n) => { let v = junc.get(n); if (v == null) { v = junc.size; junc.set(n, v); } return v; };
  for (let n = 0; n < nodePts.length; n++) {
    if (!isJ(n)) continue;
    for (const first of adj[n]) {
      if (seen.has(`${n}|${first}`)) continue;
      const chain = [n];
      let prev = n, cur = first;
      while (!isJ(cur)) {
        chain.push(cur);
        const next = [...adj[cur]].find((x) => x !== prev);
        if (next == null) break;
        prev = cur; cur = next;
      }
      chain.push(cur);
      seen.add(`${n}|${first}`);
      seen.add(`${cur}|${prev}`);
      if (n === cur && chain.length < 4) continue;
      const pts = simplify(chain.map((c) => nodePts[c]), 1.2);
      const refs = [...(segRefs.get(n < first ? `${n}|${first}` : `${first}|${n}`) ?? [])].map(ridx);
      edges.push([jid(n), jid(cur), pts.slice(1, -1).flatMap((p) => [r5(p[0]), r5(p[1])]), refs]);
    }
  }
  const nodes = [...junc.keys()].map((n) => [r5(nodePts[n][0]), r5(nodePts[n][1])]);
  out[net] = { nodes, edges };
  console.log(`${net}: ${nodes.length} junctions, ${edges.length} edges`);
}
// ---- close the gaps in lines. A route relation can miss the ways inside a station (or any other stretch): the line then
// breaks into pieces with a hole of up to a kilometre at the station. Pieces of one line are joined along the shortest
// stretch of track (any track, at most BRIDGE_M long); the joining edges get the line's ref, so they are drawn and routed on.
const BRIDGE_M = 1500;
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}
for (const net of ['rail', 'subway', 'tram']) {
  const G = out[net];
  const len = G.edges.map(([a, b, inner]) => {
    const pts = [G.nodes[a]];
    for (let k = 0; k < inner.length; k += 2) pts.push([inner[k], inner[k + 1]]);
    pts.push(G.nodes[b]);
    let L = 0;
    for (let k = 1; k < pts.length; k++) L += Math.hypot((pts[k][0] - pts[k - 1][0]) * M * 0.61, (pts[k][1] - pts[k - 1][1]) * M);
    return L;
  });
  const adj = G.nodes.map(() => []);
  G.edges.forEach(([a, b], i) => { adj[a].push([b, i]); adj[b].push([a, i]); });
  const byRef = new Map();
  G.edges.forEach((e, i) => { for (const r of e[3]) (byRef.get(r) || byRef.set(r, new Set()).get(r)).add(i); });
  let joins = 0;
  for (const [r, ids] of byRef) {
    for (let guard = 0; guard < 40; guard++) {
      const nodesOf = new Map();
      for (const i of ids) for (const n of [G.edges[i][0], G.edges[i][1]]) (nodesOf.get(n) || nodesOf.set(n, []).get(n)).push(i);
      const comp = new Map();
      let nc = 0;
      for (const n0 of nodesOf.keys()) {
        if (comp.has(n0)) continue;
        comp.set(n0, nc);
        const stack = [n0];
        while (stack.length) {
          const u = stack.pop();
          for (const i of nodesOf.get(u)) { const v = G.edges[i][0] === u ? G.edges[i][1] : G.edges[i][0]; if (!comp.has(v)) { comp.set(v, nc); stack.push(v); } }
        }
        nc++;
      }
      if (nc <= 1) break;
      const size = new Array(nc).fill(0);
      for (const i of ids) size[comp.get(G.edges[i][0])] += len[i];
      let joined = false;
      for (const c of [...size.keys()].sort((x, y) => size[y] - size[x])) {
        const dist = new Map(), prev = new Map();
        const heap = new MinHeap();
        for (const [n, cc] of comp) if (cc === c) { dist.set(n, 0); heap.push([0, n]); }
        let hit = -1;
        while (heap.size) {
          const [d, u] = heap.pop();
          if (d > (dist.get(u) ?? Infinity)) continue;
          if (comp.has(u) && comp.get(u) !== c) { hit = u; break; }
          for (const [v, i] of adj[u]) {
            const nd = d + len[i];
            if (nd <= BRIDGE_M && nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, [u, i]); heap.push([nd, v]); }
          }
        }
        if (hit < 0) continue;
        for (let v = hit; prev.has(v); v = prev.get(v)[0]) {
          const i = prev.get(v)[1];
          ids.add(i);
          if (!G.edges[i][3].includes(r)) G.edges[i][3].push(r);
        }
        joins++;
        joined = true;
        break;
      }
      if (!joined) break;
    }
  }
  console.log(`${net}: ${joins} gaps in lines closed`);
}
out.refs = refList;
writeJson(path.join(GEN, 'rail-graph.json'), out);
console.log(`rail-graph.json written (${refList.length} lines)`);

// ---- redraw the map's lines from OSM: each line (RB22, S3, U8, M10 ...) = the tracks its OSM route relations use.
// The timetable shapes are coarse in places (straight chords), OSM is exact. Runs after the GTFS stage because
// that stage rewrites transit-lines.json. Lines without enough OSM coverage keep their timetable shape.
import fs from 'node:fs';
const linesFile = path.join(GEN, 'transit-lines.json');
if (fs.existsSync(linesFile)) {
  const NET_OF_MODE = { R: 'rail', S: 'rail', U: 'subway', T: 'tram' };
  const lenOf = (parts) => parts.reduce((sum, p) => sum + p.reduce((s2, q, k) => (k ? s2 + Math.hypot((q[0] - p[k - 1][0]) * M * 0.61, (q[1] - p[k - 1][1]) * M) : 0), 0), 0);
  const edgesByRef = {};
  for (const net of ['rail', 'subway', 'tram']) {
    edgesByRef[net] = new Map();
    for (const [ea, eb, inner, refs] of out[net].edges) {
      const pts = [out[net].nodes[ea]];
      for (let k = 0; k < inner.length; k += 2) pts.push([inner[k], inner[k + 1]]);
      pts.push(out[net].nodes[eb]);
      for (const r of refs) (edgesByRef[net].get(refList[r]) || edgesByRef[net].set(refList[r], []).get(refList[r])).push(pts);
    }
  }
  // OSM ways that end a few metres short of each other (not sharing a node) would still show a hole: join the pieces of
  // one line with a short straight connector where their ends are closer than CONNECT_M. Drawing only, routing is not affected.
  const CONNECT_M = 250;
  const ptKey = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const distM = (p, q) => Math.hypot((p[0] - q[0]) * M * 0.61, (p[1] - q[1]) * M);
  function connect(parts) {
    const out2 = parts.slice();
    for (let guard = 0; guard < 60; guard++) {
      const par = out2.map((_, i) => i);
      const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      const at = new Map();
      out2.forEach((p, i) => { for (const q of p) { const k = ptKey(q); if (at.has(k)) par[find(i)] = find(at.get(k)); else at.set(k, i); } });
      if (new Set(out2.map((_, i) => find(i))).size <= 1) break;
      // an end of one piece to the nearest point (end or inner vertex) of another piece
      const ends = [], verts = [];
      out2.forEach((p, i) => {
        ends.push([p[0], find(i)], [p.at(-1), find(i)]);
        for (const q of p) verts.push([q, find(i)]);
      });
      let best = null;
      for (const [e, ce] of ends) {
        for (const [v, cv] of verts) {
          if (ce === cv || Math.abs(e[1] - v[1]) * M > CONNECT_M) continue;
          const d = distM(e, v);
          if (d <= CONNECT_M && (!best || d < best.d)) best = { d, p: e, q: v };
        }
      }
      if (!best) break;
      connLens.push(best.d);
      out2.push([best.p, best.q]);
    }
    return out2;
  }
  const connLens = [];
  let shapeJoins = 0;
  // Lines that keep their timetable shape (too little OSM coverage) come as separate trip shapes with holes between them:
  // join the pieces along the real tracks (shortest track path between their closest ends).
  function bridgeShapes(parts, mode, name) {
    const out3 = parts.slice();
    for (let guard = 0; guard < 20; guard++) {
      const par = out3.map((_, i) => i);
      const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      const at = new Map();
      out3.forEach((p, i) => { for (const q of p) { const k = ptKey(q); if (at.has(k)) par[find(i)] = find(at.get(k)); else at.set(k, i); } });
      if (new Set(out3.map((_, i) => find(i))).size <= 1) break;
      const ends = [];
      out3.forEach((p, i) => ends.push([p[0], find(i)], [p.at(-1), find(i)]));
      let best = null;
      for (let x = 0; x < ends.length; x++) for (let y = x + 1; y < ends.length; y++) {
        if (ends[x][1] === ends[y][1]) continue;
        const d = distM(ends[x][0], ends[y][0]);
        if (d <= 25000 && (!best || d < best.d)) best = { d, p: ends[x][0], q: ends[y][0] };
      }
      if (!best) break;
      const path = snapLeg(CITY, mode, [best.p, best.q], name);
      const distinct = path ? new Set(path.map(ptKey)).size : 0;
      if (distinct >= 2) out3.push(path);
      else if (best.d <= CONNECT_M) out3.push([best.p, best.q]); // the track path collapses to a point: the ends touch
      else break;
    }
    return out3;
  }
  let connectors = 0;
  const fc = JSON.parse(fs.readFileSync(linesFile, 'utf8'));
  let osm = 0, kept = 0;
  for (const feat of fc.features) {
    const mode = feat.properties.mode;
    const parts = feat.geometry.type === 'LineString' ? [feat.geometry.coordinates] : feat.geometry.coordinates;
    const edges = edgesByRef[NET_OF_MODE[mode]]?.get(feat.properties.name);
    if (edges && lenOf(edges) >= 0.6 * lenOf(parts)) { const joined = connect(edges); connectors += joined.length - edges.length; feat.geometry = { type: 'MultiLineString', coordinates: joined }; osm++; }
    else { const joined = connect(bridgeShapes(parts, mode, feat.properties.name)); shapeJoins += joined.length - parts.length; feat.geometry = { type: 'MultiLineString', coordinates: joined }; kept++; }
  }
  writeJson(linesFile, fc);
  console.log(`transit-lines.json: ${osm} lines redrawn from OSM tracks (${connectors} short connectors, longest ${Math.round(Math.max(0, ...connLens))} m, median ${Math.round(connLens.sort((x, y) => x - y)[connLens.length >> 1] ?? 0)} m), ${kept} keep the timetable shape (${shapeJoins} holes closed along the tracks)`);
}
