// Downloads the 2020 census small-area (町丁・字等) boundary shapefiles (JGD2011 lat/lon) from e-Stat
// for every prefecture that has an island in data/islands_master.csv.
import fs from "fs";
import path from "path";
const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "data/sources/estat");
fs.mkdirSync(out, { recursive: true });
const csv = fs.readFileSync(path.join(root, "data/islands_master.csv"), "utf8").replace(/^﻿/, "");
const prefCodes = [...new Set(csv.trim().split(/\r?\n/).slice(1).map(l => l.slice(0, 2)))].sort();
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36" };
for (const code of prefCodes) {
  const file = path.join(out, `A002005212020DDSWC${code}.zip`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) { console.log(code, "cached"); continue; }
  const url = `https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=${code}&coordSys=1&format=shape&downloadType=5&datum=2011`;
  const r = await fetch(url, { headers: UA });
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(file, buf);
  console.log(code, r.status, r.headers.get("content-type"), buf.length);
  await new Promise(res => setTimeout(res, 1500));
}
