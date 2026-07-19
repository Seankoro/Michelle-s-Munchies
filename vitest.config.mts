import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": r("./src"),
      // The "server-only" guard package throws outside a React Server context,
      // so tests swap it for an empty stub.
      "server-only": r("./src/test/server-only-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
