import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    environment: "node",
    testTimeout: 15_000,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["app.tsx", "server.ts", "src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/kit/test/**", "src/server/test-db.ts", "src/app/test-harness.tsx"],
      reporter: ["text-summary", "text"],
    },
  },
});
