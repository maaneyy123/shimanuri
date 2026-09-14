/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  base: "./",
  build: { outDir: "../dist", emptyOutDir: true },
  server: { port: 5173, strictPort: true },
  // maplibre-gl 6 loads its worker from a sibling file, which the dep optimizer does not copy
  optimizeDeps: { exclude: ["maplibre-gl"] },
  test: { root: "." },
});
