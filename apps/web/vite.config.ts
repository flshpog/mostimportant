import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Served from fiovivor.org/board/ on GitHub Pages. Routing is hash-based
  // (#/debug) because Pages has no SPA fallback.
  base: "/board/",
  plugins: [react()],
  resolve: {
    alias: {
      "@docs": fileURLToPath(new URL("../../docs", import.meta.url)),
    },
  },
  server: { port: 5173 },
});
