/// <reference types="vitest/config" />
import fs from "fs";
import { createRequire } from "module";
import { defineConfig, type Plugin } from "vite";

const require = createRequire(import.meta.url);

// maplibre-gl 6 loads its worker from "./maplibre-gl-worker.mjs" next to the module that imports it, and the worker
// imports "./maplibre-gl-shared.mjs". The build bundles maplibre into assets/index-*.js, so both files go to assets/.
function maplibreWorker(): Plugin {
  return {
    name: "maplibre-worker",
    apply: "build",
    generateBundle() {
      for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
        const source = fs.readFileSync(require.resolve(`maplibre-gl/dist/${file}`));
        this.emitFile({ type: "asset", fileName: `assets/${file}`, source });
      }
    },
  };
}

export default defineConfig({
  root: "web",
  base: "./",
  plugins: [maplibreWorker()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: { port: 5173, strictPort: true },
  // maplibre-gl 6 loads its worker from a sibling file, which the dep optimizer does not copy
  optimizeDeps: { exclude: ["maplibre-gl"] },
  test: { root: "." },
});
