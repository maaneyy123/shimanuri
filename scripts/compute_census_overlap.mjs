// For every island polygon (data/cache/islands_raw.geojson), lists the populated 2020 census basic unit blocks
// (基本単位区, data/cache/estat_block, the municipalities in data/cache/island_city_codes.json) that touch it, with
// the share of each block's area lying on the island and the distance (m) from the block's representative point
// (X_CODE, Y_CODE) to the island (0 when inside). A block drawn as several polygons (one per islet) counts once, with
// the area of all its polygons. Blocks along a coast often include sea, so the share alone can be low for blocks that
// are entirely on the island.
// Output: data/cache/census_part_overlap.json { id: { sig, parts: [[population, share, distance], ...] } }.
// An island whose shape is unchanged (same sig: bbox and area) keeps its previous result; others are recomputed.
import fs from "fs";
import path from "path";
import shapefile from "shapefile";
import * as turf from "@turf/turf";

const root = path.resolve(import.meta.dirname, "..");
const rel = (...p) => path.join(root, ...p);
const outFile = rel("data/cache/census_part_overlap.json");
const previous = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
const islandCodes = JSON.parse(fs.readFileSync(rel("data/cache/island_city_codes.json"), "utf8"));
const islands = JSON.parse(fs.readFileSync(rel("data/cache/islands_raw.geojson"), "utf8")).features;
const sig = (f) => [...turf.bbox(f).map((v) => v.toFixed(5)), (turf.area(f) / 1e6).toFixed(4)].join(",");

const blockCache = new Map();
async function blocksOf(code) {
  if (blockCache.has(code)) return blockCache.get(code);
  const dir = rel("data/cache/estat_block", code);
  const shp = fs.readdirSync(dir).find((x) => x.endsWith(".shp"));
  const src = await shapefile.open(path.join(dir, shp), path.join(dir, shp.replace(/\.shp$/, ".dbf")), { encoding: "shift_jis" });
  const byKey = new Map();
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    const p = r.value.properties;
    if (!r.value.geometry) continue;
    const b = byKey.get(p.KEY_CODE) ?? byKey.set(p.KEY_CODE, { pop: 0, pt: null, parts: [] }).get(p.KEY_CODE);
    // the population sits on one of the block's polygons; take the representative point from that polygon
    if ((p.JINKO || 0) > b.pop || !b.pt) b.pt = p.X_CODE != null && p.Y_CODE != null ? [p.X_CODE, p.Y_CODE] : b.pt;
    b.pop = Math.max(b.pop, p.JINKO || 0);
    b.parts.push(r.value);
  }
  const list = [...byKey.values()]
    .filter((b) => b.pop > 0)
    .map((b) => ({ ...b, bb: turf.bbox(turf.featureCollection(b.parts)), area: b.parts.reduce((s, f) => s + turf.area(f), 0) }));
  blockCache.set(code, list);
  return list;
}

const res = {};
let recomputed = 0;
for (const isl of islands) {
  const id = isl.properties.id;
  const s = sig(isl);
  if (previous[id]?.sig === s) {
    res[id] = previous[id];
    continue;
  }
  const [a, b, c, d] = turf.bbox(isl);
  const parts = [];
  for (const code of islandCodes[id] ?? []) {
    for (const blk of await blocksOf(code)) {
      if (blk.bb[0] > c || blk.bb[2] < a || blk.bb[1] > d || blk.bb[3] < b) continue;
      let onIsland = 0;
      for (const f of blk.parts) {
        if (!turf.booleanIntersects(f, isl)) continue;
        try {
          const inter = turf.intersect(turf.featureCollection([f, isl]));
          if (inter) onIsland += turf.area(inter);
        } catch {
          /* invalid geometry: counted as not on the island */
        }
      }
      if (onIsland > 0) {
        const dist = blk.pt ? Math.max(0, Math.round(turf.pointToPolygonDistance(blk.pt, isl, { units: "meters" }))) : null;
        parts.push([blk.pop, +(onIsland / blk.area).toFixed(3), dist]);
      }
    }
  }
  res[id] = { sig: s, parts };
  recomputed++;
}
fs.writeFileSync(outFile, JSON.stringify(res));
console.error(`islands ${islands.length}, recomputed ${recomputed}`);
