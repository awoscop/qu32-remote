import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@qu32/sdk/protocol", replacement: src("./sdk/src/protocol/index.ts") },
      { find: "@qu32/sdk", replacement: src("./sdk/src/index.ts") },
    ],
  },
  test: { include: ["sdk/test/**/*.test.ts", "gateway/test/**/*.test.ts"], testTimeout: 15000 },
});
