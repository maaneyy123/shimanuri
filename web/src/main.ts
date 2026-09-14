import type { FeatureCollection } from "geojson";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { decodeLevels, encodeLevels } from "./codec";
import { LAW_LABEL, LEVELS, colorOf, levelColorExpression } from "./levels";

type Island = {
  id: string;
  name: string;
  pref: string;
  muni: string;
  category: string;
  group: string;
  lon: number | null;
  lat: number | null;
  shape: boolean;
  pop: number | null;
  // on an inhabited-island list, but the 2020 census counted nobody on the island
  popZero?: boolean;
  area: number | null;
};
type IslandData = { version: string; versions: Record<string, number>; islands: Island[] };
type SortMode = "pref" | "pop-desc" | "pop-asc" | "area-desc" | "area-asc";

const BASE = import.meta.env.BASE_URL;
const STORAGE_KEY = "shimanuri:levels";
const MAX_LEVEL = 5;
// GSI blank tiles exist for tile zoom 5-14 only. MapLibre loads 256px tiles one zoom above the map zoom,
// so map zoom 4 still shows tile zoom 5; the map never zooms out further so no other base map is shown
const MIN_ZOOM = 4;

const el = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmtPop = (v: number | null) => (v == null ? "-" : v.toLocaleString("ja-JP"));
const fmtArea = (v: number | null) => (v == null ? "-" : v.toFixed(2));
const ZERO_MARK = '<span class="note-mark" title="令和2年国勢調査では住民0人">※</span>';
const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(1)}%`;

async function main() {
  const data: IslandData = await fetch(`${BASE}data/islands.json`).then((r) => r.json());
  const islands = data.islands;
  let levels = readLevels(data) ?? new Uint8Array(islands.length);

  // ---------- map ----------
  const map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {},
      // GSI blank tiles draw the sea white too, so the page background is white as well
      layers: [{ id: "sea", type: "background", paint: { "background-color": "#ffffff" } }],
    },
    bounds: [
      [122.8, 23.9],
      [146.0, 45.6],
    ],
    fitBoundsOptions: { padding: 8 },
    minZoom: MIN_ZOOM,
    localIdeographFontFamily: "'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', sans-serif",
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = map;
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

  const pointData: FeatureCollection = {
    type: "FeatureCollection",
    features: islands.flatMap((is, idx) =>
      is.lon == null || is.lat == null
        ? []
        : [
            {
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: [is.lon, is.lat] },
              properties: { idx, name: is.name, shape: is.shape },
            },
          ],
    ),
  };

  map.on("load", () => {
    const gsi = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';
    map.addSource("gsi-blank", {
      type: "raster",
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png"],
      tileSize: 256,
      minzoom: 5,
      maxzoom: 14,
      attribution: gsi,
    });
    map.addSource("gsi-pale", {
      type: "raster",
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
      tileSize: 256,
      minzoom: 2,
      maxzoom: 18,
      attribution: gsi,
    });
    map.addLayer({ id: "gsi-blank", type: "raster", source: "gsi-blank", paint: { "raster-opacity": 0.9 } });
    map.addLayer({ id: "gsi-pale", type: "raster", source: "gsi-pale", layout: { visibility: "none" } });

    map.addSource("islands", {
      type: "geojson",
      data: `${BASE}data/islands.geojson`,
      promoteId: "idx",
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
    });
    map.addLayer({
      id: "islands-fill",
      type: "fill",
      source: "islands",
      paint: { "fill-color": levelColorExpression, "fill-opacity": 0.95 },
    });
    map.addLayer({
      id: "islands-line",
      type: "line",
      source: "islands",
      paint: { "line-color": "#4d5d69", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.3, 12, 1.2] },
    });

    map.addSource("points", { type: "geojson", data: pointData, promoteId: "idx" });
    const fadeWithShape = ["interpolate", ["linear"], ["zoom"], 9, 1, 11, ["case", ["get", "shape"], 0, 1]] as unknown as maplibregl.ExpressionSpecification;
    const painted = [">", ["coalesce", ["feature-state", "level"], 0], 0] as unknown as maplibregl.ExpressionSpecification;
    map.addLayer({
      id: "points-circle",
      type: "circle",
      source: "points",
      paint: {
        "circle-color": levelColorExpression,
        // painted islands are drawn larger so they stand out on the whole-Japan view
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["case", painted, 5, 2.5], 8, ["case", painted, 7, 4.5], 12, ["case", painted, 8, 6]],
        "circle-stroke-color": "#4d5d69",
        "circle-stroke-width": 1,
        "circle-opacity": fadeWithShape,
        "circle-stroke-opacity": fadeWithShape,
      },
    });
    map.addLayer({
      id: "island-labels",
      type: "symbol",
      source: "points",
      minzoom: 7,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Regular"],
        "text-size": 12,
        "text-offset": [0, 0.8],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: { "text-color": "#23313b", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
    });

    applyAllStates();
  });

  function applyState(idx: number) {
    if (!map.getSource("points")) return;
    map.setFeatureState({ source: "points", id: idx }, { level: levels[idx] });
    if (islands[idx].shape) map.setFeatureState({ source: "islands", id: idx }, { level: levels[idx] });
  }
  function applyAllStates() {
    islands.forEach((_, idx) => applyState(idx));
  }

  // ---------- level buttons ----------
  function levelButtons(idx: number) {
    return LEVELS.map(
      (l) =>
        `<button type="button" data-idx="${idx}" data-v="${l.value}" aria-pressed="${levels[idx] === l.value}" title="${l.label}: ${esc(l.guide)}" style="--c:${l.button}">${l.label}</button>`,
    ).join("");
  }

  // ---------- popup ----------
  let popup: maplibregl.Popup | null = null;
  let popupIdx = -1;
  const popupHtml = (idx: number) => {
    const is = islands[idx];
    return `<div class="popup">
      <div class="popup-title">${esc(is.name)}</div>
      <div class="popup-sub">${esc(is.pref)} ${esc(is.muni)}　${esc(LAW_LABEL[is.category] ?? is.category)}</div>
      <div class="popup-sub">人口 ${fmtPop(is.pop)}${is.pop == null ? "" : " 人"}${is.popZero ? ZERO_MARK : ""}　面積 ${fmtArea(is.area)}${is.area == null ? "" : " km²"}</div>
      <div class="seg seg-popup">${levelButtons(idx)}</div>
      <button type="button" class="link" data-goto-row="${idx}">一覧で見る</button>
    </div>`;
  };
  function openPopup(idx: number, lngLat: maplibregl.LngLatLike) {
    popup?.remove();
    popupIdx = idx;
    // focusAfterOpen would move keyboard focus and let the browser scroll the list
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: "340px", focusAfterOpen: false }).setLngLat(lngLat).setHTML(popupHtml(idx)).addTo(map);
    popup.on("close", () => (popupIdx = -1));
  }
  for (const layer of ["islands-fill", "points-circle"]) {
    map.on("click", layer, (e) => {
      const f = e.features?.[0];
      if (f) openPopup(Number(f.properties.idx), e.lngLat);
    });
    map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
  }
  el("#map").addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLButtonElement>("button[data-v]");
    if (btn) setLevel(Number(btn.dataset.idx), Number(btn.dataset.v));
    const go = t.closest<HTMLButtonElement>("button[data-goto-row]");
    if (go) showRow(Number(go.dataset.gotoRow));
  });

  // ---------- list ----------
  const prefOrder: string[] = [];
  const byPref = new Map<string, Map<string, number[]>>();
  [...islands.keys()]
    .sort((a, b) => islands[a].id.localeCompare(islands[b].id))
    .forEach((idx) => {
      const is = islands[idx];
      if (!byPref.has(is.pref)) {
        byPref.set(is.pref, new Map());
        prefOrder.push(is.pref);
      }
      const groups = byPref.get(is.pref)!;
      if (!groups.has(is.group)) groups.set(is.group, []);
      groups.get(is.group)!.push(idx);
    });

  const rowHtml = (idx: number, withPref: boolean) => {
    const is = islands[idx];
    return `<div class="row" id="row-${idx}" data-idx="${idx}">
      <div class="cell-name"><button type="button" class="island-name" data-fly="${idx}">${esc(is.name)}</button></div>
      <div class="cell-muni">${withPref ? esc(is.pref) + " " : ""}${esc(is.muni)}</div>
      <div class="cell-law">${esc(LAW_LABEL[is.category] ?? is.category)}</div>
      <div class="cell-num">${fmtPop(is.pop)}${is.pop == null ? "" : '<span class="unit">人</span>'}${is.popZero ? ZERO_MARK : ""}</div>
      <div class="cell-num">${fmtArea(is.area)}${is.area == null ? "" : '<span class="unit">km²</span>'}</div>
      <div class="seg">${levelButtons(idx)}</div>
    </div>`;
  };
  const headerHtml = `<div class="row row-head" aria-hidden="true">
      <div class="cell-name">島名</div><div class="cell-muni">市町村</div><div class="cell-law">対象の法律</div>
      <div class="cell-num">人口</div><div class="cell-num">面積</div><div class="seg-head">レベル</div>
    </div>`;

  const list = el("#list");
  let sortMode: SortMode = "pref";
  function renderList() {
    if (sortMode === "pref") {
      list.innerHTML = prefOrder
        .map((pref) => {
          const groups = [...byPref.get(pref)!.entries()];
          return `<section class="pref">
            <h3>${esc(pref)} <span class="count" data-count-pref="${esc(pref)}"></span></h3>
            ${headerHtml}
            ${groups.map(([group, idxs]) => `<div class="group"><h4>${esc(group)}</h4>${idxs.map((idx) => rowHtml(idx, false)).join("")}</div>`).join("")}
          </section>`;
        })
        .join("");
    } else {
      const [field, dir] = sortMode.split("-") as ["pop" | "area", "desc" | "asc"];
      const idxs = [...islands.keys()].sort((a, b) => {
        const va = islands[a][field];
        const vb = islands[b][field];
        if (va == null || vb == null) return va == null ? (vb == null ? 0 : 1) : -1; // no value: always last
        return dir === "desc" ? vb - va : va - vb;
      });
      list.innerHTML = `<section class="pref">${headerHtml}${idxs.map((idx) => rowHtml(idx, true)).join("")}</section>`;
    }
    islands.forEach((_, idx) => refreshRow(idx));
    renderSummary();
    applyFilter();
  }

  const unvisitedOnly = el<HTMLInputElement>("#filter-unvisited");
  function applyFilter() {
    const only = unvisitedOnly.checked;
    list.querySelectorAll<HTMLElement>(".row[data-idx]").forEach((row) => {
      row.hidden = only && levels[Number(row.dataset.idx)] !== 0;
    });
    list.querySelectorAll<HTMLElement>(".group").forEach((g) => (g.hidden = !g.querySelector(".row[data-idx]:not([hidden])")));
    list.querySelectorAll<HTMLElement>(".pref").forEach((p) => (p.hidden = !p.querySelector(".row[data-idx]:not([hidden])")));
  }
  unvisitedOnly.addEventListener("change", applyFilter);

  list.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLButtonElement>("button[data-v]");
    if (btn) setLevel(Number(btn.dataset.idx), Number(btn.dataset.v));
    const fly = t.closest<HTMLButtonElement>("button[data-fly]");
    if (fly) {
      const idx = Number(fly.dataset.fly);
      const is = islands[idx];
      if (is.lon == null || is.lat == null) return;
      // the map stays fixed at the top; only the map moves, the list keeps its scroll position
      // place the island in the upper part of the map so the popup below it stays inside the map
      map.flyTo({ center: [is.lon, is.lat], zoom: Math.max(map.getZoom(), 10), offset: [0, -map.getContainer().clientHeight * 0.25] });
      openPopup(idx, [is.lon, is.lat]);
    }
  });

  function showRow(idx: number) {
    const row = document.getElementById(`row-${idx}`);
    if (!row) return;
    row.hidden = false;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("flash");
    setTimeout(() => row.classList.remove("flash"), 1600);
  }

  function refreshRow(idx: number) {
    document.querySelectorAll<HTMLButtonElement>(`button[data-idx="${idx}"][data-v]`).forEach((b) => {
      b.setAttribute("aria-pressed", String(Number(b.dataset.v) === levels[idx]));
    });
    document.getElementById(`row-${idx}`)?.style.setProperty("--row-color", colorOf(levels[idx]));
  }

  el<HTMLSelectElement>("#sort").addEventListener("change", (e) => {
    sortMode = (e.target as HTMLSelectElement).value as SortMode;
    renderList();
  });

  // ---------- summary ----------
  function renderSummary() {
    const total = islands.length;
    const counts = LEVELS.map((l) => levels.filter((v) => v === l.value).length);
    const score = levels.reduce((s, v) => s + v, 0);
    const painted = levels.filter((v) => v > 0).length;
    const visited = levels.filter((v) => v >= 3).length;
    el("#summary").innerHTML = `
      <div class="summary-line">塗った島 <strong>${painted}</strong> / ${total}（${pct(painted, total)}）　訪問以上 ${visited} 島（${pct(visited, total)}）　合計 ${score} / ${total * MAX_LEVEL} 点</div>
      <ul class="level-counts">${LEVELS.map((l, i) => `<li><span class="chip" style="--c:${l.color}"></span>${l.label} ${counts[i]}</li>`).join("")}</ul>`;
    for (const pref of prefOrder) {
      const target = document.querySelector(`[data-count-pref="${CSS.escape(pref)}"]`);
      if (!target) continue;
      const idxs = [...byPref.get(pref)!.values()].flat();
      target.textContent = `${idxs.filter((i) => levels[i] > 0).length}/${idxs.length}`;
    }
  }

  // ---------- state ----------
  function setLevel(idx: number, v: number) {
    levels[idx] = v;
    applyState(idx);
    refreshRow(idx);
    renderSummary();
    writeUrl();
    // only the viewer's own button presses are saved, so opening someone else's link never overwrites it
    try {
      localStorage.setItem(STORAGE_KEY, encodeLevels(levels, data.version));
    } catch {
      /* storage unavailable: the URL still holds the state */
    }
    if (popupIdx === idx && popup) popup.setHTML(popupHtml(idx));
  }
  function writeUrl() {
    history.replaceState(null, "", `#${encodeLevels(levels, data.version)}`);
  }
  window.addEventListener("hashchange", () => {
    levels = readLevels(data) ?? new Uint8Array(islands.length);
    writeUrl();
    islands.forEach((_, idx) => refreshRow(idx));
    applyAllStates();
    renderSummary();
    applyFilter();
  });

  // ---------- controls ----------
  el<HTMLSelectElement>("#basemap").addEventListener("change", (e) => {
    const pale = (e.target as HTMLSelectElement).value === "pale";
    map.setLayoutProperty("gsi-blank", "visibility", pale ? "none" : "visible");
    map.setLayoutProperty("gsi-pale", "visibility", pale ? "visible" : "none");
  });
  el<HTMLInputElement>("#show-names").addEventListener("change", (e) => {
    map.setLayoutProperty("island-labels", "visibility", (e.target as HTMLInputElement).checked ? "visible" : "none");
  });

  // share: the system share sheet on touch devices, otherwise copy the link
  const toast = el("#share-toast");
  let toastTimer = 0;
  const showToast = (text: string) => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.hidden = true), 2000);
  };
  el("#share").addEventListener("click", async () => {
    writeUrl();
    const url = location.href;
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: "しまぬり", url });
        return;
      } catch {
        /* cancelled: fall back to copying */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast("リンクをコピーしました");
    } catch {
      showToast("コピーできませんでした");
    }
  });

  el("#legend").innerHTML = LEVELS.map((l) => `<li><span class="chip" style="--c:${l.color}"></span>${l.label}</li>`).join("");
  el("#guide").innerHTML = LEVELS.map(
    (l) => `<tr><td><span class="chip" style="--c:${l.color}"></span>${l.label}</td><td>${l.value} 点</td><td>${esc(l.guide)}</td></tr>`,
  ).join("");
  el("#island-count").textContent = String(islands.length);

  renderList();
  writeUrl();
}

// A link with a record uses only that record (an unreadable one gives an empty map);
// the saved record is used only when the page is opened without one.
function readLevels(data: IslandData): Uint8Array | null {
  const decode = (code: string) => decodeLevels(code, data.versions, data.islands.length);
  const hash = location.hash.slice(1);
  if (hash) {
    try {
      return decode(decodeURIComponent(hash));
    } catch {
      return null; // malformed %-escape
    }
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? decode(saved) : null;
  } catch {
    return null;
  }
}

main();
