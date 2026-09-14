// Compares OSM polygon areas with MLIT areas and lists islands whose ratio is outside 0.7-1.4.
import fs from "fs";
import * as turf from "@turf/turf";
const areas = JSON.parse(fs.readFileSync("data/cache/mlit_area.json", "utf8"));
const islands = new Map(JSON.parse(fs.readFileSync("web/public/data/islands.json", "utf8")).islands.map((i) => [i.id, i]));
const raw = JSON.parse(fs.readFileSync("data/cache/islands_raw.geojson", "utf8")).features;
let compared = 0; const off = [];
for (const f of raw) {
  const mlit = areas[f.properties.id];
  if (mlit == null) continue;
  compared++;
  const osm = turf.area(f) / 1e6;
  const ratio = osm / mlit;
  if (ratio < 0.7 || ratio > 1.4) off.push(`${f.properties.id} ${islands.get(f.properties.id).name} OSM ${osm.toFixed(2)} km2 / MLIT ${mlit} km2 = ${ratio.toFixed(2)}`);
}
console.log(`compared ${compared}, outside 0.7-1.4: ${off.length}`);
console.log(off.join("\n"));
