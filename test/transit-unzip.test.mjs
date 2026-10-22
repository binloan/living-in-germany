// Unzipping a timetable feed by its central directory: deflated and stored entries, folders skipped, the end record required.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { unzipTo, zipEntries } from '../scripts/data/metrics/transit_unzip.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'unzip-'));

test('unzipTo writes every file of the archive with its exact content', async () => {
  const dir = tmp();
  const big = 'stop_id,stop_name\n' + Array.from({ length: 5000 }, (_, i) => `${i},Stop ${i}`).join('\n') + '\n';
  const zip = path.join(dir, 'feed.zip');
  fs.writeFileSync(zip, zipSync({
    'agency.txt': [strToU8('agency_id,agency_name\n1,Test\n'), { level: 0 }],
    'stops.txt': strToU8(big),
    'sub/routes.txt': strToU8('route_id\n1\n'),
  }));
  assert.deepEqual(zipEntries(zip).map((e) => e.name).sort(), ['agency.txt', 'stops.txt', 'sub/routes.txt']);
  const out = path.join(dir, 'out');
  const files = await unzipTo(zip, out);
  assert.equal(files.length, 3);
  assert.equal(fs.readFileSync(path.join(out, 'stops.txt'), 'utf8'), big);
  assert.equal(fs.readFileSync(path.join(out, 'agency.txt'), 'utf8'), 'agency_id,agency_name\n1,Test\n');
  assert.equal(fs.readFileSync(path.join(out, 'routes.txt'), 'utf8'), 'route_id\n1\n', 'entries are written flat, by file name');
});

test('a truncated download is reported, not unpacked', () => {
  const dir = tmp();
  const zip = path.join(dir, 'cut.zip');
  const whole = zipSync({ 'a.txt': strToU8('hello hello hello') });
  fs.writeFileSync(zip, whole.subarray(0, whole.length - 30));
  assert.throws(() => zipEntries(zip), /not a ZIP file/);
});
