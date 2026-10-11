import { defineWorkspaceTestConfig } from "../../vitest.shared.js";
export default defineWorkspaceTestConfig({
  test: {
    name: "@zcc-ext/storage-retention",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
