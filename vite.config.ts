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
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core", "framer-motion"],
  },
}));
