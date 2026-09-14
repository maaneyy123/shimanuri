"""Cross-check: OSM polygon area of each matched island vs the MLIT area (離島振興法の255島).
Writes data/cache/mlit_area.json; the comparison itself is done by scripts/check_areas.mjs."""
import json, re, unicodedata
from collections import defaultdict
from pathlib import Path
import pymupdf, csv
ROOT = Path(__file__).resolve().parent.parent
nz = lambda s: unicodedata.normalize("NFKC", s).replace(" ", "").replace("　", "")
doc = pymupdf.open(ROOT / "data/sources/mlit_ritou_shinko_list_r8.pdf")
PREFS = set("北海道 宮城県 山形県 東京都 新潟県 石川県 静岡県 愛知県 三重県 滋賀県 兵庫県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県".split())
rows_out, pref, muni = [], None, None
for page in doc:
    rows = defaultdict(list)
    for b in page.get_text("rawdict")["blocks"]:
        for line in b.get("lines", []):
            for span in line["spans"]:
                for ch in span["chars"]:
                    if ch["c"].strip():
                        rows[round((ch["bbox"][1] + ch["bbox"][3]) / 2 / 3)].append((ch["bbox"][0], ch["c"]))
    for y in sorted(rows):
        cols = {"p": "", "i": "", "m": "", "a": ""}
        for x, c in sorted(rows[y]):
            k = "p" if x < 135 else None if x < 217 else "i" if x < 297 else "m" if x < 378 else "a" if x < 455 else None
            if k: cols[k] += c
        p, i, m, a = (nz(cols[k]) for k in "pima")
        if p in PREFS: pref = p
        if not i or re.search(r"\d", i) or "有人離島" in i or i in ("名", "島名") or "時点" in i or not pref: continue
        if m and m != "〃": muni = m
        am = re.search(r"[\d.]+", a.replace("(", "").replace(")", ""))
        if am: rows_out.append({"pref": pref, "name": i, "muni": muni, "area": float(am.group())})
master = list(csv.DictReader(open(ROOT / "data/islands_master.csv", encoding="utf-8-sig")))
out = {}
for r in rows_out:
    c = [x for x in master if x["pref"] == r["pref"] and x["name"] == r["name"] and x["category"] == "離島振興法"]
    if len(c) > 1:
        c = [x for x in c if x["muni"][:2] == (r["muni"] or "")[:2]] or c
    if len(c) == 1: out[c[0]["id"]] = r["area"]
json.dump(out, open(ROOT / "data/cache/mlit_area.json", "w", encoding="utf-8"), ensure_ascii=False)
print("areas", len(out))
