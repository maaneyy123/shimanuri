"""Extracts area (km2) and 2020 census population for the 255 islands from the MLIT list
(data/sources/mlit_ritou_shinko_list_r8.pdf) keyed by island id -> data/cache/mlit_stats.json."""
import csv, json, re, unicodedata
from collections import defaultdict
from pathlib import Path
import pymupdf
ROOT = Path(__file__).resolve().parent.parent
nz = lambda s: unicodedata.normalize("NFKC", s).replace(" ", "").replace("　", "")
PREFS = set("北海道 宮城県 山形県 東京都 新潟県 石川県 静岡県 愛知県 三重県 滋賀県 兵庫県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県".split())
rows, pref, muni = [], None, None
for page in pymupdf.open(ROOT / "data/sources/mlit_ritou_shinko_list_r8.pdf"):
    lines = defaultdict(list)
    for b in page.get_text("rawdict")["blocks"]:
        for line in b.get("lines", []):
            for span in line["spans"]:
                for ch in span["chars"]:
                    if ch["c"].strip():
                        lines[round((ch["bbox"][1] + ch["bbox"][3]) / 2 / 3)].append((ch["bbox"][0], ch["c"]))
    for y in sorted(lines):
        cols = {"p": "", "i": "", "m": "", "a": "", "n": ""}
        for x, c in sorted(lines[y]):
            k = "p" if x < 135 else None if x < 217 else "i" if x < 297 else "m" if x < 378 else "a" if x < 455 else "n"
            if k: cols[k] += c
        p, i, m, a, n = (nz(cols[k]) for k in "piman")
        if p in PREFS: pref = p
        if not i or re.search(r"\d", i) or "有人離島" in i or i in ("名", "島名") or "時点" in i or not pref: continue
        if m and m != "〃": muni = m
        am, pm = re.search(r"[\d.]+", a), re.search(r"[\d,]+", n)
        if am and pm:
            rows.append({"pref": pref, "name": i, "muni": muni, "area": float(am.group()), "pop": int(pm.group().replace(",", ""))})
master = list(csv.DictReader(open(ROOT / "data/islands_master.csv", encoding="utf-8-sig")))
out = {}
for r in rows:
    c = [x for x in master if x["pref"] == r["pref"] and x["name"] == r["name"] and x["category"] == "離島振興法"]
    if len(c) > 1:
        c = [x for x in c if x["muni"][:2] == (r["muni"] or "")[:2]] or c
    if len(c) == 1: out[c[0]["id"]] = {"area": r["area"], "pop": r["pop"]}
json.dump(out, open(ROOT / "data/cache/mlit_stats.json", "w", encoding="utf-8"), ensure_ascii=False)
print("mlit stats", len(out))
