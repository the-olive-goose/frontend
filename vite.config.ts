import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode: _mode }) => ({
  server: {
    host: "::",
    port: 8080,
    strictPort: true,
    hmr: {
      overlay: true,
    },
    // Uploaded files are the one thing dev cannot reach on its own. API calls in
    // dev go to an absolute VITE_API_URL (src/lib/apiBase.ts), but an uploaded
    // photo is stored as the bare `/uploads/…` path the server issued — that is
    // deliberate, because the value an admin saves is the value the live site
    // ships, and it is same-origin there. Without this hop that path resolves
    // against the dev server, which has no such route, so Vite's SPA fallback
    // answers with index.html and every uploaded photo renders as a broken
    // image in dev while being perfectly correct in production.
    proxy: {
      "/uploads": { target: process.env.VITE_API_URL || "http://localhost:3001", changeOrigin: true },
    },
  },
  // `npm run build && npm run preview` serves the REAL production bundle, which
  // always calls /api on its own origin (see src/lib/apiBase.ts). In production
  // Netlify supplies that /api hop via public/_redirects; locally nothing would,
  // so preview would 404 every API call and the prod bundle would be untestable
  // off Netlify. Mirror the _redirects rules here so preview reproduces the live
  // topology exactly — same-origin, first-party cookie — against a local backend.
  // Keep in sync with public/_redirects.
  // Port left at Vite's 4173 default on purpose: 8080 is the dev server and 8081 is
  // the e2e runner's frontend (e2e/setup/config.mjs), both --strictPort.
  preview: {
    proxy: {
      "/api": { target: process.env.PREVIEW_API_TARGET || "http://localhost:3001", changeOrigin: true },
      "/uploads": { target: process.env.PREVIEW_API_TARGET || "http://localhost:3001", changeOrigin: true },
    },
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        /**
         * Split the dependencies that never change from the app code that
         * changes every deploy. A shopper who came back after a release then
         * re-downloads our code rather than React and Framer Motion along with
         * it, and the browser parses the pieces in parallel instead of chewing
         * through one 800 KB file before it can paint.
         *
         * Only the libraries the storefront itself runs on are named here.
         * There is deliberately no catch-all `vendor` bucket: it would put
         * admin-only weight (recharts) in the same chunk as something the home
         * page imports, and every shopper would download the charting library
         * to look at a candle. Anything unnamed is left to Rollup, which keeps
         * it with whichever route actually pulls it in.
         */
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // React, the router and the router's own core share a chunk: they
          // reference each other at module scope, and splitting them apart
          // produces a circular chunk graph with an unpredictable load order.
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|@remix-run[\\/]router)[\\/]/.test(id)) {
            return "vendor-react";
          }
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) {
            return "vendor-motion";
          }
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("@tanstack")) return "vendor-query";
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core", "framer-motion"],
  },
}));
