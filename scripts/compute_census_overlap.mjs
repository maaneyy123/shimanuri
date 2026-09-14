// For every island polygon (data/cache/islands_raw.geojson), lists the populated 2020 census small-area parts
// (e-Stat boundary data; JINKO is stored per polygon part) that touch it, with the share of each part's area
// lying on the island. Output: data/cache/census_part_overlap.json { id: [[population, share], ...] }.
// Slow (polygon intersections, about 10 minutes); scripts/build_stats.mjs reads the cached result.
import fs from "fs";
import path from "path";
import shapefile from "shapefile";
import * as turf from "@turf/turf";

const root = path.resolve(import.meta.dirname, "..");
const outFile = path.join(root, "data/cache/census_part_overlap.json");
// incremental: islands already in the cache are skipped (delete the file to recompute everything)
const res = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
const raw = JSON.parse(fs.readFileSync(path.join(root, "data/cache/islands_raw.geojson"), "utf8")).features.filter((f) => !(f.properties.id in res));
const byPref = {};
for (const f of raw) (byPref[f.properties.id.slice(0, 2)] ??= []).push(f);
for (const [pc, feats] of Object.entries(byPref)) {
  const dir = path.join(root, "data/cache/estat", pc);
  const shp = fs.readdirSync(dir).find((x) => x.endsWith(".shp"));
  const src = await shapefile.open(path.join(dir, shp), path.join(dir, shp.replace(/\.shp$/, ".dbf")), { encoding: "shift_jis" });
  const parts = [];
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    if ((r.value.properties.JINKO || 0) > 0 && r.value.geometry) parts.push({ f: r.value, pop: r.value.properties.JINKO, bb: turf.bbox(r.value) });
  }
  for (const isl of feats) {
    const [a, b, c, d] = turf.bbox(isl);
    const list = [];
    for (const p of parts) {
      if (p.bb[0] > c || p.bb[2] < a || p.bb[1] > d || p.bb[3] < b) continue;
      if (!turf.booleanIntersects(p.f, isl)) continue;
      let inter = null;
      try {
        inter = turf.intersect(turf.featureCollection([p.f, isl]));
      } catch {
        inter = null;
      }
      list.push([p.pop, +(inter ? turf.area(inter) / turf.area(p.f) : 0).toFixed(3)]);
    }
    res[isl.properties.id] = list;
  }
  console.error(pc, feats.length);
}
fs.writeFileSync(outFile, JSON.stringify(res));
