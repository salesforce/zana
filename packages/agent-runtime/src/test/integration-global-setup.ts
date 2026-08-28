/**
 * Global setup for the live-CLI integration suite: build the first-party
 * provider bridges from source and record them where the harness can find
 * them (see `integration-provider-bridges.ts`).
 *
 * This is the same work the plugin runtime does on load — build the bundle,
 * hash it, record it — done once per run so every test file shares one build.
 * Bridges are rebuilt rather than reused from `dist/` so a stale artifact
 * cannot make a live test pass against yesterday's bridge.
 */
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPluginHost } from "@zana-ai/zcc-plugin-build";
import { ensurePluginProcessDataDir } from "@zana-ai/zcc-agent-process-utils";
import type {
  PluginProviderDeclaration,
  ZccPluginApi,
} from "@zana-ai/zcc-plugin-sdk/server";
import {
  INTEGRATION_PROVIDER_BRIDGE_MANIFEST_PATH,
  type IntegrationProviderBridgeManifest,
} from "./integration-provider-bridges.js";

/**
 * Every first-party provider plugin that ships a bridge artifact. Pi is
 * separate: its bridge stays in the daemon bundle (its agent tree cannot be
 * inlined into a relocatable artifact), so its launch names the bundled
 * bridge instead of an artifact.
 */
const PROVIDER_BRIDGE_PLUGIN_IDS = [
  "provider-codex",
  "provider-claude-code",
  "provider-acp",
] as const;

/** Plugins whose bridge the daemon bundles, keyed by bundled bridge id. */
const DAEMON_BUNDLED_BRIDGE_PLUGIN_IDS: Readonly<Record<string, string>> = {
  pi: "provider-pi",
};

function pluginRootDir(pluginId: string): string {
  return fileURLToPath(
    new URL(`../../../../plugins/${pluginId}`, import.meta.url),
  );
}

/**
 * The provider declaration its plugin registers, captured by invoking the
 * server entrypoint against a stub — the same thing the plugin runtime does,
 * so the capabilities on the wire cannot drift from the declaration.
 */
async function loadDeclaration(
  pluginId: string,
): Promise<PluginProviderDeclaration> {
  const moduleUrl = new URL(
    `../../../../plugins/${pluginId}/server.ts`,
    import.meta.url,
  ).href;
  const loaded: unknown = await import(/* @vite-ignore */ moduleUrl);
  const entry = (loaded as { default?: unknown }).default;
  if (typeof entry !== "function") {
    throw new Error(`${pluginId} has no default plugin export`);
  }
  let captured: PluginProviderDeclaration | undefined;
  const zcc = {
    agents: {
      experimental_registerProvider(declaration: PluginProviderDeclaration) {
        captured = declaration;
        return { id: declaration.id, unregister() {} };
      },
    },
  } as unknown as ZccPluginApi;
  (entry as (api: ZccPluginApi) => void)(zcc);
  if (captured === undefined) {
    throw new Error(`${pluginId} registered no provider declaration`);
  }
  return captured;
}

function wireCapabilities(
  declaration: PluginProviderDeclaration,
): IntegrationProviderBridgeManifest[string]["capabilities"] {
  const { capabilities } = declaration;
  return {
    supportsServiceTier: capabilities.supportsServiceTier,
    permissionModes: [...capabilities.permissionModes],
    supportsThreadArchive: capabilities.supportsThreadArchive,
    supportsThreadRename: capabilities.supportsThreadRename,
    fork: capabilities.fork,
  };
}

export async function setup(): Promise<void> {
  const bridgeDataRoot = join(tmpdir(), "zcc-agent-runtime-integration-daemon");
  const manifest: IntegrationProviderBridgeManifest = {};
  for (const pluginId of PROVIDER_BRIDGE_PLUGIN_IDS) {
    const rootDir = pluginRootDir(pluginId);
    const [declaration, build] = await Promise.all([
      loadDeclaration(pluginId),
      buildPluginHost(rootDir, "0.0.0-integration"),
    ]);
    manifest[declaration.id] = {
      pluginId,
      dataDir: await ensurePluginProcessDataDir({
        daemonDataDir: bridgeDataRoot,
        pluginId,
        kind: "bridge-data",
      }),
      source: {
        kind: "artifact",
        digest: build.artifactDigest,
        artifactPath: build.jsPath,
      },
      capabilities: wireCapabilities(declaration),
    };
  }
  for (const [bundledBridgeId, pluginId] of Object.entries(
    DAEMON_BUNDLED_BRIDGE_PLUGIN_IDS,
  )) {
    const declaration = await loadDeclaration(pluginId);
    manifest[declaration.id] = {
      pluginId,
      dataDir: await ensurePluginProcessDataDir({
        daemonDataDir: bridgeDataRoot,
        pluginId,
        kind: "bridge-data",
      }),
      source: { kind: "daemon-bundled", id: bundledBridgeId },
      capabilities: wireCapabilities(declaration),
    };
  }
  await writeFile(
    INTEGRATION_PROVIDER_BRIDGE_MANIFEST_PATH,
    JSON.stringify(manifest, null, 2),
  );
}
