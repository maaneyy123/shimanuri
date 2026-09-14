// Minimal ZIP extraction (stored and deflated entries) with Node's zlib, so the data build needs no unzip command.
import fs from "fs";
import path from "path";
import zlib from "zlib";

export function extractZip(file, outDir) {
  const buf = fs.readFileSync(file);
  let eocd = buf.length - 22; // end of central directory record
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error(`not a zip file: ${file}`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  fs.mkdirSync(outDir, { recursive: true });
  const names = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central directory in ${file}`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const data = buf.subarray(start, start + compSize);
    const out = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
    if (!out) throw new Error(`unsupported compression method ${method} in ${file}`);
    // the e-Stat archives hold the shapefile parts without folders
    const base = path.basename(name);
    fs.writeFileSync(path.join(outDir, base), out);
    names.push(base);
  }
  return names;
}
