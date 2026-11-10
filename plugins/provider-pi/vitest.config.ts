import { fileURLToPath } from "node:url";
import { defineWorkspaceTestConfig } from "../../vitest.shared.js";
import { parseTestRetry } from "../../scripts/test-timeout-scale.mjs";

export default defineWorkspaceTestConfig({
  resolve: { alias: [
    { find: /^@zana-ai\/zcc-domain\/thread-runtime$/, replacement: fileURLToPath(new URL("../../packages/domain/src/thread-runtime.ts", import.meta.url)) },
    { find: /^@zana-ai\/zcc-domain$/, replacement: fileURLToPath(new URL("../../packages/domain/src/index.ts", import.meta.url)) },
    { find: /^@zana-ai\/zcc-provider-bridge-protocol\/assembler$/, replacement: fileURLToPath(new URL("../../packages/provider-bridge-protocol/src/assembler/index.ts", import.meta.url)) },
  ] },
  test: {
    silent: "passed-only",
    retry: parseTestRetry(process.env.ZANA_TEST_RETRY),
    name: "zcc-plugin-provider-pi",
    include: ["*.test.ts", "*.test.tsx", "src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "src/bridge/bridge.recorded-conformance.test.ts"],
  },
});
