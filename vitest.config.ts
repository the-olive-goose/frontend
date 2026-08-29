import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Run the suite ON THE LIVE SHOP. jsdom defaults to http://localhost/, which
    // is now the one hostname the site treats as work-in-progress rather than
    // trade: the GA4 tag and the Meta Pixel deliberately never load there. Left
    // at the default, every test asserting what those tags send would be
    // asserting against a page that correctly refuses to load them.
    environmentOptions: { jsdom: { url: "https://theolivegoose.ie/" } },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
