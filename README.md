# しまぬり

行った有人島を6段階で地図に塗って記録するサイトです。ログインは不要で、記録はページのURLに入ります。URLを保存しておけば、あとから開いて続きを塗れます。

## 使い方

- 地図の島、または一覧の居住〜未踏のボタンを押して、その島でのいちばん深い体験を選びます。
- 右上の「共有」で、いまの状態のリンクをコピーできます（スマホでは端末の共有画面が開きます）。
- 左上のロゴを押すと、何も塗っていない地図が開きます。

| レベル | 目安 |
|---|---|
| 居住（5点） | 島に住んだ（3か月程度の長期滞在を含む） |
| 宿泊（4点） | 島内で泊まった（船中泊は除く） |
| 訪問（3点） | 島を歩いた（泊まってはいない） |
| 接地（2点） | 港・空港で降り立っただけ（乗り継ぎなど） |
| 通過（1点） | 船で寄港した、または橋を車・鉄道で渡った（降りていない） |
| 未踏（0点） | 行っていない |

レベルの区分は、都道府県市区町村「落書き帳」で考案された「経県値」のガイドラインを参考にしています。

## 対象の島

本州・北海道・四国・九州・沖縄本島を除く有人島432島です。人口は令和2年国勢調査、面積は km² で、分からない島は「-」と表示します。

## ライセンス

- ソースコード: MIT License（[LICENSE](LICENSE)）
- `web/public/data/` のデータ（`islands.geojson`、`islands.json`）: [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。© OpenStreetMap contributors。人口・面積などの出典は下の表のとおりです。

## データの出典

| データ | 出典 | 使い方 |
|---|---|---|
| 島の形と位置 | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors（Overpass API、Nominatim で取得） | 加工して作成（ODbL） |
| 離島振興法の島の一覧・人口・面積 | 国土交通省「離島振興対策実施地域一覧」「日本の島嶼の構成」（令和8年4月1日現在） | 公共データ利用規約（第1.0版）に基づき加工して作成 |
| 人口（離島振興法以外の島）、所在市町村の判定、一部の島の形 | 総務省統計局「令和2年国勢調査」町丁・字等別境界データ（政府統計の総合窓口(e-Stat) https://www.e-stat.go.jp/） | 政府標準利用規約（第2.0版）に基づき加工して作成 |
| 面積（離島振興法以外の島） | 「令和8年全国都道府県市区町村別面積調」付3 島面積（国土地理院）（https://www.gsi.go.jp/KOKUJYOHO/MENCHO-title.htm） | もとに作成 |
| 一部の島の位置 | 国土地理院 地名検索、Wikipedia | 座標のみ使用 |
| 島名・区分の参照 | 沖縄県「離島関係資料」、鹿児島県「奄美群島の概況」、離島経済新聞「有人離島一覧」 | 島名と区分のみ使用。資料そのものは含めていません |
| 背景地図 | 地理院タイル（白地図・淡色地図） | 表示時に読み込み |

## 開発

必要なもの: Node.js 24、Python 3.12（PyMuPDF）

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # URL符号化のテスト
npm run build    # dist/ に出力
```

島データの作り直し。島の一覧 `data/islands_master.csv`（識別番号・都道府県・島名・市町村・区分・諸島）から、形・人口・面積を作ります。`data/sources/` と `data/cache/` はリポジトリに含めず、次のコマンドで取得します。

```bash
node scripts/fetch_sources.mjs
node scripts/fetch_estat_boundaries.mjs
node scripts/fetch_osm_islands.mjs
node scripts/build_geo.mjs
node scripts/fetch_nominatim.mjs
node scripts/fetch_coast_polygons.mjs
node scripts/fetch_water_polygons.mjs
node scripts/build_geo.mjs
npx mapshaper -i data/cache/islands_raw.geojson -simplify dp interval=30 keep-shapes -o precision=0.00001 format=geojson web/public/data/islands.geojson
python scripts/extract_mlit_stats.py
python scripts/extract_gsi_island_areas.py
node scripts/compute_census_overlap.mjs
node scripts/build_stats.mjs
```
