// Polite Overpass helper shared by env_green / env_amenities: cached, tiled, mirror fallback.
import fs from 'node:fs';
import path from 'node:path';
import { USER_AGENT, loadCells } from './lib.mjs';

const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run `ql` (Overpass QL, may contain {{bbox}}) -> parsed JSON; cached at cacheFile. */
export async function overpass(ql, cacheFile) {
  if (fs.existsSync(cacheFile) && fs.statSync(cacheFile).size > 0) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(ql),
        signal: AbortSignal.timeout(420000),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${txt.slice(0, 120)}`);
      const j = JSON.parse(txt);
      if (j.remark && /runtime error|timed out/i.test(j.remark)) throw new Error('overpass remark: ' + j.remark);
      fs.writeFileSync(cacheFile + '.tmp', txt);
      fs.renameSync(cacheFile + '.tmp', cacheFile);
      await sleep(4000);
      return j;
    } catch (e) {
      lastErr = e;
      console.warn(`overpass attempt ${attempt + 1} (${url}) failed: ${e.message}`);
      await sleep(10000 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** Bounding box of all cells (+margin deg) as [south, west, north, east]. */
export function cellsBBox(margin = 0.012) {
  const c = loadCells();
  return [Math.min(...c.lat) - margin, Math.min(...c.lon) - margin * 1.7, Math.max(...c.lat) + margin, Math.max(...c.lon) + margin * 1.7];
}

/** Split bbox into nx*ny tiles with small overlap (deg). */
export function tiles(bbox, nx, ny, overlap = 0) {
  const [s, w, n, e] = bbox, out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    out.push([
      +(s + ((n - s) * j) / ny - overlap).toFixed(5), +(w + ((e - w) * i) / nx - overlap).toFixed(5),
      +(s + ((n - s) * (j + 1)) / ny + overlap).toFixed(5), +(w + ((e - w) * (i + 1)) / nx + overlap).toFixed(5),
    ]);
  }
  return out;
}
