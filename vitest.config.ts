import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["test/**/*.test.ts"],
          exclude: ["test/live/**"],
          setupFiles: ["test/helpers/window.ts"],
        },
      },
      {
        test: {
          name: "live",
          environment: "node",
          include: ["test/live/**/*.live.test.ts"],
          setupFiles: ["test/live/setup.ts"],
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
