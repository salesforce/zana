import { defineWorkspaceTestConfig } from "../../vitest.shared.js";
export default defineWorkspaceTestConfig({
  test: {
    name: "@zcc-ext/browser-automation",
    include: ["**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
