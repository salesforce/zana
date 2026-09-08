import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "@zana-ai/zcc-provider-bridge-acp",
    include: ["src/**/*.test.ts"],
    exclude: [
      "dist/**",
      "node_modules/**",
      "src/bridge/bridge.recorded-conformance.test.ts",
    ],
  },
});
