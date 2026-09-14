"""Extracts the island area table (付3 島面積, islands of 1 km2 or more) from the GSI
全国都道府県市区町村別面積調 (data/sources/gsi_menseki_20260401.pdf) -> data/cache/gsi_island_areas.json.
Rows are rebuilt from span positions: name x<150, reading 150-240, area 240-285, municipality x>=288."""
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
nz = lambda s: unicodedata.normalize("NFKC", s).replace("　", "").strip()

doc = pymupdf.open(ROOT / "data/sources/gsi_menseki_20260401.pdf")
rows, pref = [], None
for page in doc:
    text = page.get_text()
    if "島面積" not in text and "島　　名" not in text:
        continue
    if "湖沼" in text and "島　　名" not in text:
        continue
    lines = defaultdict(list)
    for b in page.get_text("dict")["blocks"]:
        for line in b.get("lines", []):
            for s in line["spans"]:
                t = s["text"].strip()
                if t:
                    lines[round((s["bbox"][1] + s["bbox"][3]) / 2)].append((s["bbox"][0], s["bbox"][2], t))
    for y in sorted(lines):
        spans = sorted(lines[y])
        for x0, x1, t in spans:
            m = re.match(r"^\[(.+)\]$", nz(t))
            if m:
                pref = m.group(1)
        name = next((t for x0, x1, t in spans if x0 < 150 and not t.startswith("[")), None)
        area = next((t for x0, x1, t in spans if 235 <= x1 <= 285 and re.fullmatch(r"[\d,]+\.\d+", nz(t))), None)
        muni = " ".join(t for x0, x1, t in spans if x0 >= 288)
        if name and area and pref:
            nm = nz(name)
            alts = re.findall(r"\((.+?)\)", nm)
            base = re.sub(r"\(.*?\)", "", nm)
            rows.append({"pref": pref, "name": base, "alts": alts, "area": float(nz(area).replace(",", "")), "muni": nz(muni)})

out = ROOT / "data/cache/gsi_island_areas.json"
json.dump(rows, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print("gsi island rows", len(rows), "prefs", len({r["pref"] for r in rows}))
