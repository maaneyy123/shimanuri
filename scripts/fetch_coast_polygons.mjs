// For islands that only have a point (no named OSM polygon), fetches OSM coastline ways and island/islet
// polygons within 1.5 km of the point. Raw responses: data/cache/coast/<id>.json. scripts/build_geo.mjs picks
// the ring that contains the point, or the nearest ring whose area fits the known area.
import fs from "fs";
import path from "path";
const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "data/cache/coast");
fs.mkdirSync(dir, { recursive: true });
const islands = JSON.parse(fs.readFileSync(path.join(root, "web/public/data/islands.json"), "utf8")).islands;
const UA = "shimanuri-data-build/0.1 (personal non-commercial island map)";
for (const is of islands.filter((i) => !i.shape && i.lat != null)) {
  const file = path.join(dir, `${is.id}.json`);
  if (fs.existsSync(file)) continue;
  // big islands have their coastline split into several ways; the radius must reach all of them
  const radius = Math.round(Math.max(1500, 3000 * Math.sqrt(is.area ?? 0)));
  const around = `around:${radius},${is.lat},${is.lon}`;
  const q = `[out:json][timeout:180];(way(${around})["natural"="coastline"];way(${around})["place"~"^(island|islet)$"];relation(${around})["place"~"^(island|islet)$"];);out geom;`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q) });
    const t = await r.text();
    if (r.ok && t.trim().startsWith("{")) {
      fs.writeFileSync(file, t);
      console.log(is.id, is.name, "elements", JSON.parse(t).elements.length);
      break;
    }
    console.log(is.id, "retry", attempt, r.status);
    await new Promise((res) => setTimeout(res, 20000));
  }
  await new Promise((res) => setTimeout(res, 3000));
}
