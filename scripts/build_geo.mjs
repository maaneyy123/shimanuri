// Joins data/islands_master.csv with OpenStreetMap island shapes and writes the files the web app loads:
//   web/public/data/islands.json      island list in URL-code order, with a representative point
//   data/cache/islands_raw.geojson    island polygons (simplified into web/public/data/islands.geojson by mapshaper)
//   data/cache/need_fallback.json     islands without an Overpass match (input for scripts/fetch_nominatim.mjs)
//   data/geo_report.txt               islands that need a manual look
// Matching: OSM place=island|islet features with the island's name (or an alias in scripts/osm_aliases.json)
// whose position falls in one of the listed municipalities. The municipality of a position is taken from the
// nearest 2020 census small-area point (data/cache/estat). Islands without such a feature fall back to
// Nominatim results (data/cache/nominatim), then to census small areas whose name contains the island name.
import fs from "fs";
import path from "path";
import osmtogeojson from "osmtogeojson";
import * as turf from "@turf/turf";
import shapefile from "shapefile";

const root = path.resolve(import.meta.dirname, "..");
const rel = (...p) => path.join(root, ...p);

const csvText = fs.readFileSync(rel("data/islands_master.csv"), "utf8").replace(/^﻿/, "").trim();
const [header, ...lines] = csvText.split(/\r?\n/);
const cols = header.split(",");
const master = lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])));
const ALIASES = JSON.parse(fs.readFileSync(rel("scripts/osm_aliases.json"), "utf8"));
// points for islands no automatic source could place, each with where the coordinate came from
const MANUAL = JSON.parse(fs.readFileSync(rel("scripts/manual_points.json"), "utf8"));

const nz = (s) => (s || "").normalize("NFKC").replace(/[\s　]/g, "");
const key = (s) => nz(s).replace(/[ヶヵ]/g, "ケ").replace(/[の之]/g, "ノ").replace(/嶋/g, "島");
const cityHead = (m) => {
  const mm = nz(m).replace(/.*支庁/, "").match(/^(.+?[市町村])/);
  return key(mm ? mm[1] : m);
};
const munis = (m) => nz(m).split(/[・、,，]/).map(cityHead).filter(Boolean);
const inMunis = (city, m) => munis(m).some((x) => cityHead(city).startsWith(x) || x.startsWith(cityHead(city)));
const NEAR_DEG2 = 0.03 ** 2; // about 3 km: tolerance for islands just across a municipal boundary

async function readEstat(pc) {
  const dir = rel("data/cache/estat", pc);
  const shp = fs.readdirSync(dir).find((f) => f.endsWith(".shp"));
  const src = await shapefile.open(path.join(dir, shp), path.join(dir, shp.replace(/\.shp$/, ".dbf")), { encoding: "shift_jis" });
  const recs = [];
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    const p = r.value.properties;
    if (p.X_CODE == null || p.Y_CODE == null) continue;
    recs.push({ city: p.CITY_NAME, sname: p.S_NAME || "", pop: p.JINKO || 0, key: `${p.PREF}${p.CITY}${p.KEYCODE1}`, x: p.X_CODE, y: p.Y_CODE });
  }
  return recs;
}

const d2 = (r, [x, y]) => (r.x - x) ** 2 + (r.y - y) ** 2;
function belongs(recs, pt, muni) {
  let best = null;
  for (const r of recs) if (!best || d2(r, pt) < d2(best, pt)) best = r;
  if (best && inMunis(best.city, muni)) return { ok: true, city: best.city };
  const own = recs.filter((r) => inMunis(r.city, muni));
  const near = own.some((r) => d2(r, pt) < NEAR_DEG2);
  return { ok: near, city: best?.city ?? "" };
}

function toArea(f) {
  const g = f?.geometry;
  if (!g) return null;
  if (g.type === "Polygon" || g.type === "MultiPolygon") return turf.feature(g);
  if (g.type === "LineString" && g.coordinates.length > 3) {
    const [a, b] = [g.coordinates[0], g.coordinates.at(-1)];
    if (a[0] === b[0] && a[1] === b[1]) return turf.polygon([g.coordinates]);
  }
  return null;
}
const pointOf = (f) => (toArea(f) ? turf.pointOnFeature(toArea(f)).geometry.coordinates : f.geometry.type === "Point" ? f.geometry.coordinates : turf.centroid(f).geometry.coordinates);

// keep the previous URL-code order; new islands are appended
const outJson = rel("web/public/data/islands.json");
const previous = fs.existsSync(outJson) ? JSON.parse(fs.readFileSync(outJson, "utf8")) : null;
const order = previous ? previous.islands.map((i) => i.id) : [];
for (const m of [...master].sort((a, b) => a.id.localeCompare(b.id))) if (!order.includes(m.id)) order.push(m.id);
const version = previous?.version ?? "A";
const versions = previous?.versions ?? { A: order.length };
if (versions[version] !== order.length) throw new Error(`island count changed (${versions[version]} -> ${order.length}): add a new version char`);

const masterById = new Map(master.map((m) => [m.id, m]));
// known areas (km2, from scripts/build_stats.mjs) help pick the right unnamed coastline ring
const previousArea = new Map((previous?.islands ?? []).filter((i) => i.area != null).map((i) => [i.id, i.area]));

// For point-only islands: single polygons near the point from OSM (data/cache/coast/<id>.json,
// scripts/fetch_coast_polygons.mjs): parts of island/islet multipolygons, closed coastline ways, and rings
// assembled from coastline ways that are split into pieces. A polygon is used when it contains the point, is not a
// main island (<= 50 km2) and is not much bigger than the island: <= max(3 x known area, 5 km2); with a known area
// it must also be >= 1/3 of it. When two islands pick the same polygon, it goes to the one whose known area is
// closer (e.g. 赤島 and 泊島 in 対馬 share one coastline); the other keeps its point.
function coastRing(id, point, knownArea) {
  const file = rel("data/cache/coast", `${id}.json`);
  if (!fs.existsSync(file)) return null;
  const gj = osmtogeojson(JSON.parse(fs.readFileSync(file, "utf8")));
  const polys = [];
  const openLines = [];
  for (const f of gj.features) {
    const g = f.geometry;
    if (g.type === "Polygon") polys.push(turf.polygon(g.coordinates));
    else if (g.type === "MultiPolygon") g.coordinates.forEach((c) => polys.push(turf.polygon(c)));
    else if (g.type === "LineString") {
      const area = toArea(f);
      if (area) polys.push(area);
      else openLines.push(turf.lineString(g.coordinates));
    }
  }
  if (openLines.length) {
    try {
      turf.polygonize(turf.featureCollection(openLines)).features.forEach((p) => polys.push(p));
    } catch {
      /* lines that do not close into rings are ignored */
    }
  }
  const ok = polys
    .map((f) => ({ f, km2: turf.area(f) / 1e6 }))
    .filter(({ f, km2 }) => km2 <= 50 && km2 <= Math.max(3 * (knownArea ?? 0), 5) && (!knownArea || km2 >= knownArea / 3) && turf.booleanPointInPolygon(point, f))
    .sort((a, b) => a.km2 - b.km2)[0];
  return ok ? { geometry: ok.f.geometry, km2: ok.km2, note: `(${ok.km2.toFixed(2)} km2, known ${knownArea ?? "-"})` } : null;
}
const prefData = {};
for (const pc of [...new Set(master.map((m) => m.id.slice(0, 2)))].sort()) {
  const elements = JSON.parse(fs.readFileSync(rel("data/cache/osm", `${pc}.json`), "utf8")).elements;
  const feats = osmtogeojson({ elements }).features.map((f) => ({ f, tags: f.properties.tags ?? f.properties })).filter((x) => x.tags.name);
  prefData[pc] = { feats, estat: await readEstat(pc) };
}

// ---- manual fixes for islands the automatic matching gets wrong (scripts/shape_overrides.json) ----
// point: corrected position; estatKey: census small-area part (containing the point) used as the shape;
// clipToLand: cut that part with the smallest OSM land polygon containing the point; landBox: cut the OSM land
// polygon containing the point with this box; subtract: remove other islands' shapes afterwards.
const OVERRIDES = JSON.parse(fs.readFileSync(rel("scripts/shape_overrides.json"), "utf8"));
function landPolygonsAt(id, pt) {
  const file = rel("data/cache/coast", `${id}.json`);
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const f of osmtogeojson(JSON.parse(fs.readFileSync(file, "utf8"))).features) {
    const g = f.geometry;
    const parts = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const c of parts) {
      const p = turf.polygon(c);
      if (turf.booleanPointInPolygon(pt, p)) out.push(p);
    }
  }
  return out.sort((a, b) => turf.area(a) - turf.area(b));
}
const overrideShape = {};
for (const [id, ov] of Object.entries(OVERRIDES)) {
  if (!ov.point || (!ov.estatKey && !ov.landBox && !ov.waterBbox)) continue;
  const land = landPolygonsAt(ov.landFrom ?? id, ov.point)[0];
  let shape = null;
  if (ov.waterBbox && land) {
    // land minus the water areas drawn on top of it (channels between islands)
    const water = osmtogeojson(JSON.parse(fs.readFileSync(rel("data/cache/water", `${id}.json`), "utf8"))).features.filter((f) => f.geometry.type.includes("Polygon"));
    shape = land;
    for (const w of water) shape = turf.difference(turf.featureCollection([shape, w])) ?? shape;
  } else if (ov.estatKey) {
    const dir = rel("data/cache/estat", id.slice(0, 2));
    const shp = fs.readdirSync(dir).find((f) => f.endsWith(".shp"));
    const src = await shapefile.open(path.join(dir, shp), path.join(dir, shp.replace(/\.shp$/, ".dbf")), { encoding: "shift_jis" });
    for (;;) {
      const r = await src.read();
      if (r.done) break;
      if (r.value.properties.KEYCODE1 === ov.estatKey && r.value.geometry && turf.booleanPointInPolygon(ov.point, r.value)) shape = turf.feature(r.value.geometry);
    }
    if (shape && ov.clipToLand && land) {
      const clipped = turf.bboxClip(land, turf.bbox(shape));
      shape = turf.intersect(turf.featureCollection([shape, clipped])) ?? shape;
    }
  } else if (ov.landBox && land) {
    shape = turf.intersect(turf.featureCollection([turf.bboxClip(land, ov.landBox), turf.bboxPolygon(ov.landBox)]));
  }
  if (!shape) throw new Error(`shape override for ${id} produced nothing`);
  // keep only the piece that holds the island's point (drops slivers of other land inside the cut)
  const piece = turf.flatten(shape).features.find((p) => turf.booleanPointInPolygon(ov.point, p));
  overrideShape[id] = (piece ?? shape).geometry;
}

const report = [];
const polygons = [];
const outIslands = [];
const needFallback = [];
const coastPicks = [];

for (const [idx, id] of order.entries()) {
  const m = masterById.get(id);
  const { feats, estat } = prefData[id.slice(0, 2)];
  const notes = [];
  const parts = m.name.split("・");
  const chosen = [];
  for (const nm of parts) {
    const wanted = new Set([key(nm), ...(ALIASES[id] ?? []).map(key)]);
    const cands = feats
      .filter((x) => wanted.has(key(x.tags.name)) || wanted.has(key(x.tags["name:ja"])))
      .map((x) => ({ ...x, area: toArea(x.f), pt: pointOf(x.f) }))
      .map((c) => ({ ...c, ...belongs(estat, c.pt, m.muni), size: c.area ? turf.area(c.area) : 0 }));
    const pool = cands.filter((c) => c.ok).sort((a, b) => b.size - a.size);
    if (pool.length) chosen.push(pool[0]);
    else if (cands.length) notes.push(`OSM "${nm}" found only in ${[...new Set(cands.map((c) => c.city))].join("/")}`);
  }

  let geom = null;
  let point = null;
  let source = "overpass";
  const areas = chosen.filter((c) => c.area).map((c) => c.area);
  if (areas.length === 1) geom = areas[0].geometry;
  else if (areas.length > 1) geom = turf.union(turf.featureCollection(areas))?.geometry ?? null;
  if (geom) point = turf.pointOnFeature(geom).geometry.coordinates;
  else if (chosen.length) point = chosen[0].pt;

  if (!chosen.length || !geom) {
    needFallback.push({ id, name: m.name, pref: m.pref, muni: m.muni, aliases: ALIASES[id] ?? [] });
    const nomFile = rel("data/cache/nominatim", `${id}.json`);
    const results = fs.existsSync(nomFile) ? JSON.parse(fs.readFileSync(nomFile, "utf8")) : [];
    const names = new Set([...parts, ...(ALIASES[id] ?? [])].map(key));
    // exact island names, or a settlement/district named after the island (e.g. 瀬戸ケ島町, 津島町竹ヶ島)
    const SETTLEMENT = new Set(["quarter", "neighbourhood", "hamlet", "village", "suburb", "locality", "isolated_dwelling"]);
    const hit = results
      .filter((r) => names.has(key(r.name)) || names.has(key((r.display_name || "").split(",")[0])) || (SETTLEMENT.has(r.type) && [...names].some((n) => key(r.name).includes(n))))
      // only island/islet results may supply a shape (a same-named ferry terminal polygon was picked once)
      .map((r) => ({ r, pt: [Number(r.lon), Number(r.lat)], area: ["island", "islet"].includes(r.type) ? toArea({ geometry: r.geojson }) : null }))
      .map((h) => ({ ...h, ...belongs(estat, h.pt, m.muni) }))
      .filter((h) => h.ok)
      .sort((a, b) => (b.area ? 1 : 0) - (a.area ? 1 : 0))[0];
    if (hit && (hit.area || !point)) {
      source = "nominatim";
      geom = hit.area?.geometry ?? geom;
      point = geom ? turf.pointOnFeature(geom).geometry.coordinates : hit.pt;
      notes.length = 0;
    }
  }
  const manual = MANUAL[id];
  if (!point && manual) {
    point = [manual.lon, manual.lat];
    source = "manual";
    notes.push(manual.source);
  }
  if (!point) {
    // census small areas named after the island (e.g. 鳴門町高島, 大瀬戸町松島内郷); stems only when 2+ chars
    const probes = [...new Set([...parts, ...(ALIASES[id] ?? [])].flatMap((n) => [n, n.replace(/島$/, "")]))].map(key).filter((p) => p.length >= 2);
    const hits = estat.filter((r) => inMunis(r.city, m.muni) && probes.some((p) => key(r.sname).includes(p)));
    if (hits.length) {
      point = [hits.reduce((s, r) => s + r.x, 0) / hits.length, hits.reduce((s, r) => s + r.y, 0) / hits.length];
      source = "census-area-name";
      notes.push(`point from census areas ${[...new Set(hits.map((h) => h.sname))].slice(0, 4).join("/")}`);
    } else {
      source = "none";
      notes.push("NOT LOCATED");
    }
  }
  const ov = OVERRIDES[id];
  if (ov?.point) {
    point = ov.point;
    source = "override";
    if (overrideShape[id]) geom = overrideShape[id];
    else if (!ov.subtract) geom = null; // re-pick the shape around the corrected point below
    notes.length = 0;
    notes.push(ov.note);
  }
  let coast = null;
  if (!geom && point) {
    coast = coastRing(id, point, previousArea.get(id));
    if (!coast) notes.push("point only (no polygon)");
  }
  if (geom) polygons.push(turf.feature(geom, { idx, id }));
  if (coast) coastPicks.push({ idx, id, coast, known: previousArea.get(id), reportIndex: report.length });
  if (notes.length || source !== "overpass" || coast) report.push(`${id}\t${m.pref}\t${m.name}\t${m.muni}\t${source}\t${notes.join("; ")}`);
  outIslands.push({
    id,
    name: m.name,
    pref: m.pref,
    muni: m.muni,
    category: m.category,
    group: m.group,
    lon: point ? +point[0].toFixed(5) : null,
    lat: point ? +point[1].toFixed(5) : null,
    shape: Boolean(geom),
  });
}

// resolve coastline polygons picked by more than one island
const sig = (g) => turf.bbox(g).map((v) => v.toFixed(5)).join(",");
const bySig = new Map();
for (const p of coastPicks) (bySig.get(sig(p.coast.geometry)) ?? bySig.set(sig(p.coast.geometry), []).get(sig(p.coast.geometry))).push(p);
for (const picks of bySig.values()) {
  const fit = (p) => (p.known ? Math.abs(Math.log(p.coast.km2 / p.known)) : 1);
  picks.sort((a, b) => fit(a) - fit(b));
  picks.forEach((p, i) => {
    const line = report[p.reportIndex];
    if (i === 0) {
      polygons.push(turf.feature(p.coast.geometry, { idx: p.idx, id: p.id }));
      outIslands[p.idx].shape = true;
      report[p.reportIndex] = `${line}${line.endsWith("\t") ? "" : "; "}shape from OSM coastline ${p.coast.note}`;
    } else {
      report[p.reportIndex] = `${line}${line.endsWith("\t") ? "" : "; "}point only: the coastline polygon ${p.coast.note} went to ${picks[0].id}`;
    }
  });
}

// subtract shapes listed in the overrides (e.g. 大毛島 minus 高島)
for (const [id, ov] of Object.entries(OVERRIDES)) {
  if (!ov.subtract) continue;
  const target = polygons.find((p) => p.properties.id === id);
  if (!target) continue;
  let g = target;
  for (const other of ov.subtract) {
    const o = polygons.find((p) => p.properties.id === other);
    if (o) g = turf.difference(turf.featureCollection([g, o])) ?? g;
  }
  // the remaining piece that holds the island's own point
  const own = outIslands.find((i) => i.id === id);
  const piece = turf.flatten(g).features.find((p) => turf.booleanPointInPolygon([own.lon, own.lat], p));
  target.geometry = (piece ?? g).geometry;
  report.push(`${id}\t${own.pref}\t${own.name}\t${own.muni}\toverride\t${ov.note}`);
}

fs.writeFileSync(rel("data/cache/islands_raw.geojson"), JSON.stringify(turf.featureCollection(polygons)));
fs.writeFileSync(rel("data/cache/need_fallback.json"), JSON.stringify(needFallback, null, 1));
fs.writeFileSync(outJson, JSON.stringify({ version, versions, islands: outIslands }));
fs.writeFileSync(rel("data/geo_report.txt"), "id\tpref\tname\tmuni\tsource\tnotes\n" + report.join("\n") + "\n");
const count = (s) => outIslands.filter(s).length;
console.error(`islands ${outIslands.length}, polygons ${polygons.length}, point only ${count((i) => !i.shape && i.lon != null)}, not located ${count((i) => i.lon == null)}, need fallback ${needFallback.length}`);
