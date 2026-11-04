import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "zcc-plugin-provider-codex",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: [
      "node_modules/**",
      "dist/**",
      "src/ai/chatgpt-client.test.ts",
      "src/bridge/bridge.recorded-conformance.test.ts",
      "src/bridge/bridge.conformance.test.ts"
    ]
  }
});
