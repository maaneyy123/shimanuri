// Downloads the documents used for population and area into data/sources.
// The GSI server needs TLS legacy renegotiation, which Node's fetch refuses, so this uses https with that option.
import crypto from "crypto";
import fs from "fs";
import https from "https";
import path from "path";

const dir = path.resolve(import.meta.dirname, "../data/sources");
fs.mkdirSync(dir, { recursive: true });
const SOURCES = [
  ["mlit_ritou_shinko_list_r8.pdf", "https://www.mlit.go.jp/kokudoseisaku/chirit/content/001886615.pdf"],
  ["gsi_menseki_20260401.pdf", "https://www.gsi.go.jp/KOKUJYOHO/MENCHO/backnumber/GSI-menseki20260401.pdf"],
];
const agent = new https.Agent({ secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT });

function get(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { agent, headers: { "User-Agent": "shimanuri-data-build/0.1" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          resolve(get(new URL(res.headers.location, url).href, redirects - 1));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      })
      .on("error", reject);
  });
}

const log = [];
for (const [file, url] of SOURCES) {
  const { status, body } = await get(url);
  if (status !== 200) throw new Error(`${url}: HTTP ${status}`);
  fs.writeFileSync(path.join(dir, file), body);
  log.push(`${file}\t${url}\t${status}\t${body.length}`);
}
const day = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(dir, "SOURCES.tsv"), "file\turl\tstatus\tbytes\n" + log.join("\n") + `\n# fetched ${day}\n`);
console.log(log.join("\n"));
