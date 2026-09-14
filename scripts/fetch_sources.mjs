// Downloads the documents used for population and area into data/sources.
import fs from "fs";
import path from "path";
const dir = path.resolve(import.meta.dirname, "../data/sources");
fs.mkdirSync(dir, { recursive: true });
const SOURCES = [
  ["mlit_ritou_shinko_list_r8.pdf", "https://www.mlit.go.jp/kokudoseisaku/chirit/content/001886615.pdf"],
  ["gsi_menseki_20260401.pdf", "https://www.gsi.go.jp/KOKUJYOHO/MENCHO/backnumber/GSI-menseki20260401.pdf"],
];
const log = [];
for (const [file, url] of SOURCES) {
  const r = await fetch(url);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(path.join(dir, file), buf);
  log.push(`${file}\t${url}\t${r.status}\t${buf.length}`);
}
const day = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(dir, "SOURCES.tsv"), "file\turl\tstatus\tbytes\n" + log.join("\n") + `\n# fetched ${day}\n`);
console.log(log.join("\n"));
