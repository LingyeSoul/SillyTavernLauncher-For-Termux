/**
 * WEBUI 前端构建 — 产物输出到 ../public（随仓库提交）。
 * Termux 安装脚本走 `npm install --omit=dev`，不需要在手机上构建。
 */
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [vue(), vuetify({ autoImport: true })],
  build: {
    outDir: fileURLToPath(new URL("../public", import.meta.url)),
    assetsDir: "static",
    emptyOutDir: true,
    target: "es2020",
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5183,
    proxy: { "/api": "http://127.0.0.1:8300" },
  },
});
