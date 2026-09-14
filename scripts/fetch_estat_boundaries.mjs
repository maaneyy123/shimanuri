// Downloads the 2020 census boundary shapefiles (JGD2011 lat/lon) from e-Stat and extracts them:
//   町丁・字等 (small areas): one archive per prefecture with an island -> data/cache/estat/<pref code>/
//     used to check an island's municipality and for some shape overrides (scripts/build_geo.mjs)
//   基本単位区 (basic unit blocks): one archive per municipality with an island -> data/cache/estat_block/<city code>/
//     each block carries its own population (JINKO), used for island populations (scripts/compute_census_overlap.mjs)
// Archives are kept in data/sources/estat and data/sources/estat_block; the municipality codes of each island are
// written to data/cache/island_city_codes.json.
import fs from "fs";
import path from "path";
import shapefile from "shapefile";
import { extractZip } from "./unzip.mjs";

const root = path.resolve(import.meta.dirname, "..");
const rel = (...p) => path.join(root, ...p);
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36" };
const master = fs.readFileSync(rel("data/islands_master.csv"), "utf8").replace(/^﻿/, "").trim().split(/\r?\n/).slice(1).map((l) => l.split(","));

async function download(surveyId, code, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return "cached";
  const url = `https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=${surveyId}&code=${code}&coordSys=1&format=shape&downloadType=5&datum=2011`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  await new Promise((res) => setTimeout(res, 1500));
  return r.status;
}

const prefCodes = [...new Set(master.map(([id]) => id.slice(0, 2)))].sort();
for (const pc of prefCodes) {
  const file = rel("data/sources/estat", `A002005212020DDSWC${pc}.zip`);
  console.log("small areas", pc, await download("A002005212020", pc, file));
  extractZip(file, rel("data/cache/estat", pc));
}

// municipality codes from the municipality names in the small-area data (wards: 福岡市 -> 福岡市東区 etc.)
const nz = (s) => (s ?? "").normalize("NFKC").replace(/\s/g, "").replace(/[ヶヵ]/g, "ケ");
const islandCodes = {};
const unmatched = [];
for (const pc of prefCodes) {
  const dir = rel("data/cache/estat", pc);
  const src = await shapefile.openDbf(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith(".dbf"))), { encoding: "shift_jis" });
  const byName = new Map();
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    if (r.value.CITY_NAME) byName.set(nz(r.value.CITY_NAME), r.value.PREF + r.value.CITY);
  }
  const names = [...byName.keys()];
  for (const [id, , name, muni] of master.filter(([id]) => id.startsWith(pc))) {
    const codes = new Set();
    for (const part of nz(muni).split(/[・、,]/)) {
      let hits = names.filter((n) => n === part);
      if (!hits.length) hits = names.filter((n) => n.startsWith(part));
      if (!hits.length) hits = names.filter((n) => n.endsWith(part));
      if (hits.length) hits.forEach((n) => codes.add(byName.get(n)));
      else unmatched.push(`${id} ${name} ${part}`);
    }
    islandCodes[id] = [...codes].sort();
  }
}
if (unmatched.length) throw new Error(`municipality not found in the census data: ${unmatched.join(", ")}`);
fs.writeFileSync(rel("data/cache/island_city_codes.json"), JSON.stringify(islandCodes));

const cityCodes = [...new Set(Object.values(islandCodes).flat())].sort();
for (const code of cityCodes) {
  const file = rel("data/sources/estat_block", `B002005212020DDSWC${code}.zip`);
  console.log("basic unit blocks", code, await download("B002005212020", code, file));
  extractZip(file, rel("data/cache/estat_block", code));
}
console.log(`prefectures ${prefCodes.length}, municipalities ${cityCodes.length}`);
