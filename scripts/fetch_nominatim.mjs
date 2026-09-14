// Looks up islands listed in data/cache/need_fallback.json with the public Nominatim API
// (1 request per second, results cached in data/cache/nominatim/<id>.json).
import fs from "fs";
import path from "path";
const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "data/cache/nominatim");
fs.mkdirSync(dir, { recursive: true });
const list = JSON.parse(fs.readFileSync(path.join(root, "data/cache/need_fallback.json"), "utf8"));
const UA = "shimanuri-data-build/0.1 (personal non-commercial island map; one-off lookup of ~50 island names)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failed = [];
for (const is of list) {
  const file = path.join(dir, `${is.id}.json`);
  if (fs.existsSync(file)) continue;
  const muni = is.muni.split(/[・、,]/)[0];
  const queries = [...new Set([is.name, ...is.aliases].flatMap((n) => [`${n} ${muni}`, `${n} ${is.pref}`]))];
  const results = [];
  let ok = true;
  for (const q of queries) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&countrycodes=jp&limit=5&accept-language=ja&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.ok) results.push(...(await r.json()));
    else {
      ok = false;
      console.log(is.id, q, r.status);
    }
    await sleep(1100);
  }
  // an island with a failed query is not cached, so it is looked up again next time
  if (!ok) {
    failed.push(is.id);
    continue;
  }
  const seen = new Set();
  const unique = results.filter((x) => !seen.has(x.osm_type + x.osm_id) && seen.add(x.osm_type + x.osm_id));
  fs.writeFileSync(file, JSON.stringify(unique));
  console.log(is.id, is.name, is.muni, "->", unique.length, unique.slice(0, 3).map((x) => `${x.name}(${x.type})`).join(", "));
}
if (failed.length) {
  console.error(`Nominatim failed for islands ${failed.join(", ")}; run this script again`);
  process.exit(1);
}
