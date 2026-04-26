import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "friday-cron",
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
