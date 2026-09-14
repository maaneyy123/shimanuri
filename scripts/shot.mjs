// Dev helper: headless screenshot of the running dev server.
// usage: node scripts/shot.mjs <out.png> [hash] [lon,lat,zoom] [width x height]
import { chromium } from "playwright";

const [out, hash = "", view = "", size = "1280x900"] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/404/.test(m.text()) && errors.push(m.text()));
await page.goto(`http://localhost:5173/${hash ? "#" + hash : ""}`);
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded() && window.__map.getSource("points"), null, { timeout: 30000 });
if (view) {
  const [lon, lat, zoom] = view.split(",").map(Number);
  await page.evaluate(([lon, lat, zoom]) => window.__map.jumpTo({ center: [lon, lat], zoom }), [lon, lat, zoom]);
}
await page.evaluate(() => new Promise((r) => { window.__map.once("idle", r); window.__map.triggerRepaint(); setTimeout(r, 20000); }));
// optional 5th argument: page y offset to capture (e.g. the island list)
const offsetY = Number(process.argv[6] ?? 0);
if (offsetY) await page.evaluate((y) => window.scrollTo(0, y), offsetY);
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, errors }));
await browser.close();
