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
      // Use board-data's TypeScript source directly so edits to board.json hot-reload.
      "@everest/board-data": fileURLToPath(new URL("../../packages/board-data/src/index.ts", import.meta.url)),
      "@docs": fileURLToPath(new URL("../../docs", import.meta.url)),
    },
  },
  server: { port: 5173 },
});
