import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-provider-claude-code",
    include: ["src/**/*.test.ts"],
    exclude: [
      "node_modules/**",
      "dist/**",
      "src/native-roots.test.ts",
      "src/server.test.ts",
      "src/bridge/bridge.recorded-conformance.test.ts",
      "src/bridge/bridge.conformance.test.ts",
      "src/bridge/__tests__/bridge.calibration.test.ts"
    ]
  }
});
