import { describe, expect, it } from "vitest";
import type { PluginProviderOptionsContext } from "@zana-ai/zcc-plugin-sdk";
import { createFakePluginHost } from "@zana-ai/zcc-plugin-sdk/testing";
import plugin from "./server.js";
import { piProviderDeclaration } from "./src/declaration.js";

const registeredDeclaration = piProviderDeclaration;

function loadPiPlugin() {
  const host = createFakePluginHost({ pluginId: "provider-pi" });
  plugin(host.zcc);
  const declaration = host.harness.providers.find((entry) => entry.id === "pi");
  if (declaration === undefined) {
    throw new Error("expected Pi to be registered");
  }
  return { declaration, host };
}

function providerOptions(settings: PluginProviderOptionsContext["settings"]) {
  const { declaration } = loadPiPlugin();
  if (declaration.deriveProviderOptions === undefined) {
    throw new Error("expected Pi provider options");
  }
  return declaration.deriveProviderOptions({
    threadId: "thread-1",
    projectId: "project-1",
    model: "sf-llm-gateway/claude",
    permissionMode: "full",
    settings,
  });
}

describe("the pi plugin's environment passthrough", () => {
  it("declares the bridge command override variables so a host-set value reaches the bridge", () => {
    expect(registeredDeclaration().env).toEqual({
      passthrough: ["ZCC_PI_BRIDGE_COMMAND", "ZCC_PI_BRIDGE_ARGS", "BB_PI_BRIDGE_COMMAND", "BB_PI_BRIDGE_ARGS"],
    });
  });

  it("registers CLI passthrough and maintenance on the actual plugin entry", () => {
    expect(loadPiPlugin().declaration).toEqual(expect.objectContaining({
      env: registeredDeclaration().env,
      maintenance: { health: true, usage: false, installation: true },
      capabilities: expect.objectContaining({ permissionModes: ["full"] }),
    }));
  });
});

describe("the pi plugin's settings", () => {
  it("trusts system certificates by default and derives an explicit opt-out", () => {
    expect(loadPiPlugin().host.harness.settings.trustSystemCertificates).toMatchObject({
      type: "boolean",
      default: true,
    });
    expect(providerOptions({})).toEqual({ trustSystemCertificates: true });
    expect(providerOptions({ trustSystemCertificates: "yes" })).toEqual({ trustSystemCertificates: true });
    expect(providerOptions({ trustSystemCertificates: false })).toEqual({ trustSystemCertificates: false });
  });
});

function rootPaths(
  side: readonly (string | { readonly path: string })[] | undefined,
): string[] {
  return (side ?? []).map((root) =>
    typeof root === "string" ? root : root.path,
  );
}

describe("the pi plugin's skill roots", () => {
  it("declares pi's documented directories and resolves the rest per host", () => {
    const declaration = registeredDeclaration();
    const roots = declaration.experimental_nativeSkillRoots;
    expect(rootPaths(roots?.user)).toEqual([
      ".pi/agent/skills",
      ".agents/skills",
    ]);
    expect(rootPaths(roots?.project)).toEqual([".pi/skills", ".agents/skills"]);
    expect(declaration.experimental_resolvesNativeRoots).toBe(true);
  });
});
