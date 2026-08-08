import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    // Opening the dev server in a browser (for Glass Lab, or any frontend
    // work) has no Rust side, so InnerTube calls would be blocked by CORS.
    // Forwarding them server-side makes the app usable as guest in a plain
    // tab. Dev only — the packaged app always goes through the Tauri http
    // plugin, which needs no proxy. See `innertubeFetch` in
    // `src/lib/innertube/shared.ts`.
    proxy: {
      "/__ytm": {
        target: "https://music.youtube.com",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/__ytm/, ""),
        // `Origin`, `Referer` and the `Sec-Fetch-*` family are forbidden
        // header names, so the ones the client sets in BASE_HEADERS are
        // dropped and the browser's own (localhost) values go out instead.
        // InnerTube answers those with a 403 "Sorry" page. Only the proxy can
        // put them right, because it is not a browser.
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("origin", "https://music.youtube.com");
            proxyReq.setHeader("referer", "https://music.youtube.com/");
            proxyReq.setHeader("sec-fetch-site", "same-origin");
            proxyReq.setHeader("sec-fetch-mode", "same-origin");
            proxyReq.setHeader("sec-fetch-dest", "empty");
          });
        },
      },
    },
  },
}));
