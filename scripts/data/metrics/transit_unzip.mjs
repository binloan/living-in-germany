// Streaming unzip with fflate (never holds whole entries in memory).
import fs from 'node:fs';
import path from 'node:path';
import { Unzip, UnzipInflate } from 'fflate';

export async function unzipTo(zipFile, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  const done = [];
  const uz = new Unzip();
  uz.register(UnzipInflate);
  uz.onfile = (f) => {
    if (f.name.endsWith('/')) return;
    const dest = path.join(outDir, path.basename(f.name));
    const ws = fs.createWriteStream(dest);
    done.push(new Promise((res, rej) => { ws.on('finish', res); ws.on('error', rej); }));
    files.push(dest);
    f.ondata = (err, chunk, final) => {
      if (err) { ws.destroy(err); return; }
      if (chunk.length) ws.write(chunk);
      if (final) ws.end();
    };
    f.start();
  };
  const rs = fs.createReadStream(zipFile, { highWaterMark: 1 << 20 });
  for await (const chunk of rs) {
    uz.push(chunk);
    await new Promise((r) => setImmediate(r));
  }
  uz.push(new Uint8Array(0), true);
  await Promise.all(done);
  return files;
}
