// Fetches OSM water polygons (natural=water, water=*, waterway=*) inside the "waterBbox" of each entry in
// scripts/shape_overrides.json. Used where OSM draws the channel between two islands as a water area on top of
// one merged coastline (e.g. 高島 and 大毛島 in 鳴門市). Output: data/cache/water/<id>.json.
import fs from "fs";
import path from "path";
const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "data/cache/water");
fs.mkdirSync(dir, { recursive: true });
const overrides = JSON.parse(fs.readFileSync(path.join(root, "scripts/shape_overrides.json"), "utf8"));
for (const [id, ov] of Object.entries(overrides)) {
  if (!ov.waterBbox) continue;
  const file = path.join(dir, `${id}.json`);
  if (fs.existsSync(file)) continue;
  const [w, s, e, n] = ov.waterBbox;
  const q = `[out:json][timeout:120][bbox:${s},${w},${n},${e}];(way["natural"="water"];relation["natural"="water"];way["water"];relation["water"];way["waterway"];);out geom;`;
  for (let attempt = 1; attempt <= 8; attempt++) {
    const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "User-Agent": "shimanuri-data-build/0.1 (personal non-commercial island map)", "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q) });
    const t = await r.text();
    if (r.ok && t.trim().startsWith("{")) {
      fs.writeFileSync(file, t);
      console.log(id, "elements", JSON.parse(t).elements.length);
      break;
    }
    console.log(id, "retry", attempt, r.status);
    await new Promise((res) => setTimeout(res, 45000));
  }
}
