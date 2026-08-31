import { mergeConfig, defineConfig, type ViteUserConfig } from "vitest/config";

/**
 * Workspace packages import this from `vitest.config.ts`. Keep it small:
 * honor the `source` export-map condition so tests load TS sources instead
 * of stale `dist/` bundles. The BB shared-worker sequencer is not ported.
 */
export function defineWorkspaceTestConfig(config: ViteUserConfig): ViteUserConfig {
  return mergeConfig(
    defineConfig({
      resolve: {
        conditions: ["source"],
      },
      ssr: {
        resolve: {
          conditions: ["source"],
          externalConditions: ["source"],
        },
      },
    }),
    config,
  );
}
