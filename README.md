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

本州・北海道・四国・九州・沖縄本島を除く有人島432島です。人口は令和2年国勢調査、面積は km² で、分からない島は「-」と表示します。人口の「0人※」は、有人島の一覧に載っているものの、令和2年国勢調査では住民が0人だった島です。

## ライセンス

- ソースコード: MIT License（[LICENSE](LICENSE)）
- `web/public/data/` のデータ（`islands.geojson`、`islands.json`）: [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。© OpenStreetMap contributors。人口・面積などの出典は下の表のとおりです。

## データの出典

| データ | 出典 | 使い方 |
|---|---|---|
| 島の形と位置 | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors（Overpass API、Nominatim で取得） | 加工して作成（ODbL） |
| 離島振興法の島の一覧・人口・面積 | 国土交通省「離島振興対策実施地域一覧」「日本の島嶼の構成」（令和8年4月1日現在） | 公共データ利用規約（第1.0版）に基づき加工して作成 |
| 人口（離島振興法以外の島）、所在市町村の判定、一部の島の形 | 総務省統計局「令和2年国勢調査」基本単位区別境界データ・町丁・字等別境界データ（政府統計の総合窓口(e-Stat) https://www.e-stat.go.jp/） | 政府標準利用規約（第2.0版）に基づき加工して作成 |
| 面積（離島振興法以外の島） | 「令和8年全国都道府県市区町村別面積調」付3 島面積（国土地理院）（https://www.gsi.go.jp/KOKUJYOHO/MENCHO-title.htm） | もとに作成 |
| 人口・面積（上の資料で出せない沖縄の島） | 沖縄県「離島関係資料」（令和6年3月） | 島ごとの数値のみ使用（`scripts/okinawa_islands.json`） |
| 一部の島の位置 | 国土地理院 地名検索、Wikipedia | 座標のみ使用 |
| 島名・区分の参照 | 沖縄県「離島関係資料」、鹿児島県「奄美群島の概況」、離島経済新聞「有人離島一覧」 | 島名と区分のみ使用。資料そのものは含めていません |
| 背景地図 | 地理院タイル（白地図・淡色地図） | 表示時に読み込み |

## 開発

必要なもの: Node.js 24

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # URL符号化のテスト
npm run build    # dist/ に出力
```

`scripts/shot.mjs`（開発サーバーの画面をヘッドレスブラウザで撮影）を使うときは、先に `npx playwright install chromium` を実行します。

## 島データの作り直し

必要なもの: Node.js 24、Python 3.12 と PyMuPDF（`pip install pymupdf`）

入力はリポジトリにある次のファイルです。

| ファイル | 内容 |
|---|---|
| `data/islands_master.csv` | 島の一覧（識別番号・都道府県・島名・市町村・区分・諸島） |
| `web/public/data/islands.json` | リンクに入れる島の並び順と版。消さないでください（消すと、それまでのリンクが別の島を指します）。前回の面積は、名前の無い海岸線から島の形を選ぶときにも使います |
| `scripts/osm_aliases.json`、`scripts/manual_points.json`、`scripts/shape_overrides.json` | OpenStreetMap での別名、手作業の位置、手作業の形の修正 |
| `scripts/okinawa_islands.json` | 沖縄県「離島関係資料」の島ごとの人口・面積 |

`data/sources/`（取得した資料）と `data/cache/`（途中結果）はリポジトリに含めません。次のコマンドを上から順に実行すると作られます。

```bash
node scripts/fetch_sources.mjs            # 国交省の一覧、国土地理院の面積調
node scripts/fetch_estat_boundaries.mjs   # 国勢調査の境界（町丁・字等、基本単位区）を取得して展開
node scripts/fetch_osm_islands.mjs        # OpenStreetMap の島（都道府県ごと）
node scripts/build_geo.mjs                # 1回目: 名前で位置と形を決め、名前で見つからない島を書き出す
node scripts/fetch_nominatim.mjs          # 名前で見つからなかった島を Nominatim で探す
node scripts/build_geo.mjs                # 2回目: Nominatim の結果を入れ、海岸線が要る島を書き出す
node scripts/fetch_coast_polygons.mjs     # 点だけの島と手作業の修正に使う海岸線
node scripts/fetch_water_polygons.mjs     # 手作業の修正に使う島の間の水路
node scripts/build_geo.mjs                # 3回目: 形を仕上げる
npx mapshaper -i data/cache/islands_raw.geojson -simplify dp interval=30 keep-shapes -o precision=0.00001 format=geojson web/public/data/islands.geojson
python scripts/extract_mlit_stats.py
python scripts/extract_gsi_island_areas.py
node scripts/compute_census_overlap.mjs   # 島と基本単位区の重なり（形が変わった島だけ計算し直す）
node scripts/build_stats.mjs              # 人口と面積を入れ、data/stats_report.txt に記録
```

- 取得先の負荷を抑えるため、e-Stat は1.5秒、Nominatim は1秒、Overpass は数秒おきに1件ずつ取得します。
- 取得したファイルは `data/sources/`・`data/cache/` に残り、次に実行したときは飛ばします。Overpass は混んでいると失敗することがあり、そのときは失敗したものを表示して終了コード1で止まるので、同じコマンドをもう一度実行してから次へ進んでください。
- OpenStreetMap は日々更新されるので、同じ手順でも島の形が公開中のファイルと変わることがあります。公開中のデータは 2026-09-14 に取得したものです。
- 結果の確認: `data/geo_report.txt`（形と位置の出どころ）、`data/stats_report.txt`（人口・面積の出どころと、国勢調査から出した人口と国交省・沖縄県の値の比較）。`python scripts/check_areas.py` のあと `node scripts/check_areas.mjs` を実行すると、形の面積と国交省の一覧の面積を比べます。
