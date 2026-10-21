// Runs the transit metrics in order: node scripts/data/metrics/transit_run.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CITY_ID } from '../lib.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
for (const f of ['transit_gtfs.mjs']) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [path.join(dir, f), '--city', CITY_ID], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}
