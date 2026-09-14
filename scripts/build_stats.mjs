// Adds population (2020 census) and area (km2) to web/public/data/islands.json.
//
// population
//   1. MLIT list (the 255 islands under the Remote Islands Development Act).
//   2. Otherwise the 2020 census: sum of populated small-area parts with at least 50% of their area on the
//      island polygon (data/cache/census_part_overlap.json, from scripts/compute_census_overlap.mjs). If the
//      populated parts with 5-50% of their area on the island hold more than 1% of that sum, no value.
//      This rule reproduces the MLIT figure within 5% for 209 of the 213 MLIT islands it gives a value for.
// area
//   MLIT list, otherwise GSI 令和8年全国都道府県市区町村別面積調 付3 島面積 (islands of 1 km2 or more), otherwise none.
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const rel = (...p) => path.join(root, ...p);
const readJson = (p) => JSON.parse(fs.readFileSync(rel(p), "utf8"));

const data = readJson("web/public/data/islands.json");
const mlit = readJson("data/cache/mlit_stats.json");
const gsi = readJson("data/cache/gsi_island_areas.json");
const overlap = readJson("data/cache/census_part_overlap.json");
const OSM_ALIASES = readJson("scripts/osm_aliases.json");
const GSI_ALIASES = { "46021": ["大島"] }; // 奄美大島 is listed as 大島 in the GSI table

const nz = (s) => (s || "").normalize("NFKC").replace(/[\s　]/g, "");
const key = (s) => nz(s).replace(/[ヶヵ]/g, "ケ").replace(/[の之]/g, "ノ").replace(/嶋/g, "島");
const cityHeads = (m) =>
  nz(m)
    .replace(/\(.*?\)/g, "")
    .split(/[・、,，]|\d[\d.]*/)
    .map((x) => (x.match(/^(.+?[市町村])/) || [])[1])
    .filter(Boolean)
    .map(key);

const ON_ISLAND = 0.5;
const AMBIGUOUS = 0.05;
// population in partly-overlapping parts may be up to 1% of the counted population (淡路島: 66 of 126,695)
const AMBIGUOUS_TOLERANCE = 0.01;
function censusPop(id) {
  const parts = overlap[id];
  if (!parts) return null;
  const pop = parts.filter(([, share]) => share >= ON_ISLAND).reduce((s, [p]) => s + p, 0);
  const unclear = parts.filter(([, share]) => share > AMBIGUOUS && share < ON_ISLAND).reduce((s, [p]) => s + p, 0);
  return pop > 0 && unclear <= AMBIGUOUS_TOLERANCE * pop ? pop : null;
}

function gsiArea(is) {
  const names = new Set([...is.name.split("・"), ...(OSM_ALIASES[is.id] ?? []), ...(GSI_ALIASES[is.id] ?? [])].map(key));
  const hits = gsi.filter((g) => g.pref === is.pref && [g.name, ...g.alts, ...g.name.split("・")].some((n) => names.has(key(n))));
  const own = cityHeads(is.muni);
  // same name and one of the listed municipalities; a row without a municipality (境界未定) counts only if it is the sole hit
  const inCity = hits.filter((g) => cityHeads(g.muni).some((h) => own.some((o) => h.slice(0, 2) === o.slice(0, 2))));
  if (inCity.length) return inCity[0];
  return hits.length === 1 && cityHeads(hits[0].muni).length === 0 ? hits[0] : null;
}

const tally = { popMlit: 0, popCensus: 0, popNone: 0, areaMlit: 0, areaGsi: 0, areaNone: 0 };
const lines = [];
for (const is of data.islands) {
  const m = mlit[is.id];
  let popNote;
  if (m) {
    is.pop = m.pop;
    tally.popMlit++;
    popNote = "mlit";
  } else {
    const c = censusPop(is.id);
    is.pop = c;
    tally[c != null ? "popCensus" : "popNone"]++;
    popNote = c != null ? "census" : "none";
  }
  let areaNote;
  if (m) {
    is.area = m.area;
    tally.areaMlit++;
    areaNote = "mlit";
  } else {
    const g = gsiArea(is);
    is.area = g ? g.area : null;
    tally[g ? "areaGsi" : "areaNone"]++;
    areaNote = g ? `gsi ${g.name} ${g.muni}` : "none";
  }
  if (!m) lines.push(`${is.id}\t${is.pref}\t${is.name}\t${is.muni}\tpop=${is.pop ?? "-"} (${popNote})\tarea=${is.area ?? "-"} (${areaNote})`);
}

fs.writeFileSync(rel("web/public/data/islands.json"), JSON.stringify(data));
const summary = [
  `population: MLIT ${tally.popMlit}, census ${tally.popCensus}, none ${tally.popNone}`,
  `area: MLIT ${tally.areaMlit}, GSI ${tally.areaGsi}, none ${tally.areaNone}`,
];
fs.writeFileSync(rel("data/stats_report.txt"), summary.join("\n") + "\n\nislands outside the MLIT list:\n" + lines.join("\n") + "\n");
console.log(summary.join("\n"));
