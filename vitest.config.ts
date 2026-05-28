import { defineConfig } from "vitest/config";

// Standalone test config so vitest doesn't load the build's vite.config.ts
// (which requires the INPUT env var for the single-file UI build).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
