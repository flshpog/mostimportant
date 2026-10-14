import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@everest/board-data": fileURLToPath(new URL("../board-data/src/index.ts", import.meta.url)),
    },
  },
});
