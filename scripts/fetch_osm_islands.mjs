// Fetches OpenStreetMap island features (place=island|islet) whose name matches an island in
// data/islands_master.csv, one Overpass query per prefecture. Raw responses go to data/cache/osm/<pref>.json.
import fs from "fs";
import path from "path";
const root = path.resolve(import.meta.dirname, "..");
const cache = path.join(root, "data/cache/osm");
fs.mkdirSync(cache, { recursive: true });
const lines = fs.readFileSync(path.join(root, "data/islands_master.csv"), "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
const head = lines[0].split(",");
const rows = lines.slice(1).map(l => Object.fromEntries(l.split(",").map((v, i) => [head[i], v])));
// spelling variants seen in OSM / sources
const variant = s => s.replace(/[ケヶヵ]/g, "[ケヶヵ]").replace(/[ノの之]/g, "[ノの之]").replace(/[島嶋]/g, "[島嶋]");
const byPref = {};
for (const r of rows) (byPref[r.id.slice(0, 2)] ??= new Set()).add(r.name.replace(/・/g, "|"));
const UA = "shimanuri-data-build/0.1 (personal non-commercial island map)";
const endpoint = "https://overpass-api.de/api/interpreter";
const failed = [];
for (const [pc, names] of Object.entries(byPref)) {
  const file = path.join(cache, `${pc}.json`);
  if (fs.existsSync(file)) { console.log(pc, "cached"); continue; }
  const alts = [...names].flatMap(n => n.split("|")).map(variant);
  const q = `[out:json][timeout:300];area["ISO3166-2"="JP-${pc}"]->.p;nwr["place"~"^(island|islet)$"]["name"~"^(${alts.join("|")})$"](area.p);out geom;`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(endpoint, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q) });
    const t = await r.text();
    if (r.ok && t.trim().startsWith("{")) {
      fs.writeFileSync(file, t);
      console.log(pc, "ok", JSON.parse(t).elements.length, "elements", (t.length / 1e6).toFixed(1) + "MB");
      break;
    }
    console.log(pc, "retry", attempt, r.status, t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160));
    await new Promise(res => setTimeout(res, 30000));
  }
  if (!fs.existsSync(file)) failed.push(pc);
  await new Promise(res => setTimeout(res, 5000));
}
if (failed.length) {
  // cached prefectures are skipped, so running the script again fetches only these
  console.error(`Overpass failed for prefectures ${failed.join(", ")}; run this script again`);
  process.exit(1);
}
