// Adds population (2020 census) and area (km2) to web/public/data/islands.json.
//
// population
//   1. MLIT list (the 255 islands under the Remote Islands Development Act).
//   2. Otherwise the 2020 census basic unit blocks (data/cache/census_part_overlap.json, from
//      scripts/compute_census_overlap.mjs): sum of populated blocks whose representative point is within NEAR_M of
//      the island or with at least 50% of their area on it. If the other blocks with more than 5% of their area on the
//      island hold more than 1% of that sum, no value.
//   3. Otherwise 0 when no populated block touches the island and blocks without population cover at least 90% of it
//      (the 2020 census counted nobody there; the island is on the inhabited-island lists). Marked popZero, shown with a note.
//   4. Otherwise 沖縄県「離島関係資料」 for the islands designated under the Okinawa act (scripts/okinawa_islands.json).
// area
//   MLIT list, otherwise GSI 令和8年全国都道府県市区町村別面積調 付3 島面積 (islands of 1 km2 or more),
//   otherwise 沖縄県「離島関係資料」, otherwise none.
// data/stats_report.txt lists every island outside the MLIT list and checks the census rule against the MLIT and
// Okinawa figures.
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const rel = (...p) => path.join(root, ...p);
const readJson = (p) => JSON.parse(fs.readFileSync(rel(p), "utf8"));

const data = readJson("web/public/data/islands.json");
const mlit = readJson("data/cache/mlit_stats.json");
const gsi = readJson("data/cache/gsi_island_areas.json");
const overlap = readJson("data/cache/census_part_overlap.json");
const okinawa = readJson("scripts/okinawa_islands.json").islands;
const OSM_ALIASES = readJson("scripts/osm_aliases.json");
// names used in the GSI table: 奄美大島 is 大島, 大島 (串本町) is 紀伊大島
const GSI_ALIASES = { "46021": ["大島"], "30002": ["紀伊大島"] };

const nz = (s) => (s || "").normalize("NFKC").replace(/[\s　]/g, "");
// the GSI table writes parts of one island as 新城島<上地>; the list writes 新城島上地
const key = (s) => nz(s).replace(/[<>＜＞]/g, "").replace(/[ヶヵ]/g, "ケ").replace(/[の之]/g, "ノ").replace(/嶋/g, "島");
const cityHeads = (m) =>
  nz(m)
    .replace(/\(.*?\)/g, "")
    .split(/[・、,，]|\d[\d.]*/)
    .map((x) => (x.match(/^(.+?[市町村])/) || [])[1])
    .filter(Boolean)
    .map(key);

const ON_ISLAND = 0.5;
const NEAR_M = 100; // representative point on the island, allowing for coastline differences between the two maps
const AMBIGUOUS = 0.05;
// population in partly-overlapping blocks may be up to 1% of the counted population
const AMBIGUOUS_TOLERANCE = 0.01;
function censusPop(id) {
  const parts = overlap[id]?.parts;
  if (!parts) return null;
  const counted = ([, share, dist]) => share >= ON_ISLAND || (dist != null && dist <= NEAR_M);
  const pop = parts.filter(counted).reduce((s, [p]) => s + p, 0);
  const unclear = parts.filter((x) => !counted(x) && x[1] > AMBIGUOUS).reduce((s, [p]) => s + p, 0);
  return pop > 0 && unclear <= AMBIGUOUS_TOLERANCE * pop ? pop : null;
}
const ZERO_COVERED = 0.9;
const censusZero = (id) => overlap[id]?.parts.length === 0 && (overlap[id].covered ?? 0) >= ZERO_COVERED;

function gsiArea(is) {
  const names = new Set([...is.name.split("・"), ...(OSM_ALIASES[is.id] ?? []), ...(GSI_ALIASES[is.id] ?? [])].map(key));
  const hits = gsi.filter((g) => g.pref === is.pref && [g.name, ...g.alts, ...g.name.split("・")].some((n) => names.has(key(n))));
  const own = cityHeads(is.muni);
  // same name and one of the listed municipalities; a row without a municipality (境界未定) counts only if it is the sole hit
  const inCity = hits.filter((g) => cityHeads(g.muni).some((h) => own.some((o) => h.slice(0, 2) === o.slice(0, 2))));
  if (inCity.length) return inCity[0];
  return hits.length === 1 && cityHeads(hits[0].muni).length === 0 ? hits[0] : null;
}

const within = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(b, 1);
const tally = { popMlit: 0, popCensus: 0, popZero: 0, popOkinawa: 0, popNone: 0, areaMlit: 0, areaGsi: 0, areaOkinawa: 0, areaNone: 0 };
const lines = [];
const checks = { mlitGiven: 0, mlitWithin5: 0, mlitOff: [], okinawaGiven: 0, okinawaWithin5: 0, okinawaOff: [] };
for (const is of data.islands) {
  const m = mlit[is.id];
  const c = censusPop(is.id);
  const ok = okinawa[is.id];
  let popNote;
  delete is.popZero;
  if (m) {
    is.pop = m.pop;
    tally.popMlit++;
    popNote = "mlit";
    if (c != null) {
      checks.mlitGiven++;
      if (within(c, m.pop, 0.05)) checks.mlitWithin5++;
      else checks.mlitOff.push(`${is.name}(${is.muni}) census ${c} / MLIT ${m.pop}`);
    }
  } else if (c != null) {
    is.pop = c;
    tally.popCensus++;
    popNote = "census blocks";
  } else if (censusZero(is.id)) {
    is.pop = 0;
    is.popZero = true;
    tally.popZero++;
    popNote = `census zero (blocks without population cover ${Math.round(overlap[is.id].covered * 100)}%)`;
  } else if (ok?.pop != null) {
    is.pop = ok.pop;
    tally.popOkinawa++;
    popNote = "okinawa";
  } else {
    is.pop = null;
    tally.popNone++;
    popNote = "none";
  }
  if (!m && c != null && ok?.pop != null) {
    checks.okinawaGiven++;
    if (within(c, ok.pop, 0.05)) checks.okinawaWithin5++;
    else checks.okinawaOff.push(`${is.name} census ${c} / 沖縄県 ${ok.pop}`);
  }
  let areaNote;
  const g = m ? null : gsiArea(is);
  if (m) {
    is.area = m.area;
    tally.areaMlit++;
    areaNote = "mlit";
  } else if (g) {
    is.area = g.area;
    tally.areaGsi++;
    areaNote = `gsi ${g.name} ${g.muni}`;
  } else if (ok?.area != null) {
    is.area = ok.area;
    tally.areaOkinawa++;
    areaNote = "okinawa";
  } else {
    is.area = null;
    tally.areaNone++;
    areaNote = "none";
  }
  if (!m) lines.push(`${is.id}\t${is.pref}\t${is.name}\t${is.muni}\tpop=${is.pop ?? "-"} (${popNote})\tarea=${is.area ?? "-"} (${areaNote})`);
}

fs.writeFileSync(rel("web/public/data/islands.json"), JSON.stringify(data));
const summary = [
  `population: MLIT ${tally.popMlit}, census blocks ${tally.popCensus}, census zero ${tally.popZero}, Okinawa document ${tally.popOkinawa}, none ${tally.popNone}`,
  `area: MLIT ${tally.areaMlit}, GSI ${tally.areaGsi}, Okinawa document ${tally.areaOkinawa}, none ${tally.areaNone}`,
  `check, census rule on MLIT islands: value for ${checks.mlitGiven}, within 5% ${checks.mlitWithin5}`,
  `check, census rule on Okinawa islands (outside MLIT): value for ${checks.okinawaGiven}, within 5% ${checks.okinawaWithin5}`,
];
const report = [
  ...summary,
  "",
  "census rule more than 5% off the MLIT figure:",
  ...checks.mlitOff,
  "",
  "census rule more than 5% off the Okinawa figure:",
  ...checks.okinawaOff,
  "",
  "islands outside the MLIT list:",
  ...lines,
];
fs.writeFileSync(rel("data/stats_report.txt"), report.join("\n") + "\n");
console.log(summary.join("\n"));
