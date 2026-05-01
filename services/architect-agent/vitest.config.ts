import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "architect-agent",
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
