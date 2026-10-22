// Unzip by the central directory, streaming every entry to disk (never holds a whole entry in memory). The central directory is the
// only place that always has the real sizes: feeds with entries over 4 GB or written with data descriptors (the nationwide gtfs.de
// feed) cannot be read from the local headers while streaming.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const readAt = (fd, pos, len) => {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return n < len ? b.subarray(0, n) : b;
};

/** The entries of a ZIP file: { name, method, csize, usize, offset } (zip64 sizes and offsets resolved). */
export function zipEntries(zipFile) {
  const fd = fs.openSync(zipFile, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 70000);
    const tail = readAt(fd, size - tailLen, tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error(`${zipFile}: not a ZIP file (no end record; incomplete download?)`);
    let count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
      const z = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
      if (z < 0) throw new Error(`${zipFile}: zip64 end record missing`);
      count = Number(tail.readBigUInt64LE(z + 32)); cdSize = Number(tail.readBigUInt64LE(z + 40)); cdOff = Number(tail.readBigUInt64LE(z + 48));
    }
    const cd = readAt(fd, cdOff, cdSize);
    const entries = [];
    for (let p = 0; entries.length < count && p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
      const method = cd.readUInt16LE(p + 10), nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
      let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24), offset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      for (let x = p + 46 + nameLen, end = x + extraLen; x + 4 <= end; ) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 1) { // zip64: only the fields that were 0xFFFFFFFF, in this order
          let q = x + 4;
          if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (offset === 0xffffffff) offset = Number(cd.readBigUInt64LE(q));
        }
        x += 4 + len;
      }
      entries.push({ name, method, csize, usize, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally { fs.closeSync(fd); }
}

export async function unzipTo(zipFile, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  const fd = fs.openSync(zipFile, 'r');
  try {
    for (const e of zipEntries(zipFile)) {
      if (e.name.endsWith('/')) continue;
      if (e.method !== 0 && e.method !== 8) throw new Error(`${e.name}: compression method ${e.method} is not supported`);
      const lh = readAt(fd, e.offset, 30);
      const start = e.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const dest = path.join(outDir, path.basename(e.name));
      const source = fs.createReadStream(zipFile, { start, end: start + e.csize - 1, highWaterMark: 1 << 20 });
      await pipeline(source, ...(e.method === 8 ? [zlib.createInflateRaw()] : []), fs.createWriteStream(dest));
      if (fs.statSync(dest).size !== e.usize) throw new Error(`${e.name}: extracted ${fs.statSync(dest).size} bytes, the ZIP lists ${e.usize}`);
      files.push(dest);
    }
  } finally { fs.closeSync(fd); }
  return files;
}
