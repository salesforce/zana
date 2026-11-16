import { describe, expect, it } from "vitest";
import { bridgeLaunchProcessKey } from "./bridge-launch-process-key.js";
import type { AgentRuntimeBridgeLaunch } from "./types.js";

describe("bridgeLaunchProcessKey", () => {
  const base: AgentRuntimeBridgeLaunch = {
    pluginId: "provider-example",
    dataDir: "/tmp/provider-example",
    source: {
      kind: "artifact",
      digest: "a".repeat(64),
      artifactPath: "/tmp/provider-example/host.mjs",
    },
    capabilities: {
      providerInstallation: false,
      supportsServiceTier: false,
      permissionModes: ["full"],
      supportsThreadArchive: false,
      supportsThreadRename: false,
      fork: "none",
    },
    providerOptions: { launch: { command: "example" } },
    envPassthrough: [],
  };

  it("changes with provider-owned statics and ignores object key order", () => {
    expect(bridgeLaunchProcessKey(base)).toBe(
      bridgeLaunchProcessKey({
        ...base,
        providerOptions: { launch: { command: "example" } },
      }),
    );
    expect(bridgeLaunchProcessKey(base)).not.toBe(
      bridgeLaunchProcessKey({
        ...base,
        providerOptions: { launch: { command: "other" } },
      }),
    );
  });

  it("changes with each capability declaration at the same artifact hash", () => {
    const renamed: AgentRuntimeBridgeLaunch = {
      ...base,
      capabilities: {
        ...base.capabilities,
        supportsThreadRename: true,
      },
    };
    const rewound: AgentRuntimeBridgeLaunch = {
      ...renamed,
      capabilities: { ...renamed.capabilities, fork: "tip" },
    };

    expect(
      new Set(
        [base, renamed, rewound].map((launch) =>
          bridgeLaunchProcessKey(launch),
        ),
      ),
    ).toHaveLength(3);
  });

  it("changes when passthrough changes and ignores declaration order", () => {
    const declared = { ...base, envPassthrough: ["ZCC_SECOND", "ZCC_FIRST"] };
    expect(bridgeLaunchProcessKey(declared)).not.toBe(bridgeLaunchProcessKey(base));
    expect(bridgeLaunchProcessKey(declared)).toBe(bridgeLaunchProcessKey({ ...declared, envPassthrough: ["ZCC_FIRST", "ZCC_SECOND"] }));
    expect(bridgeLaunchProcessKey(base)).toBe(bridgeLaunchProcessKey({ ...base, envPassthrough: undefined }));
  });
  it('separates new machine environment generations without changing unconfigured launches', () => {
    const first = { ...base, environmentRevision: 'first' };
    expect(bridgeLaunchProcessKey(first)).not.toBe(bridgeLaunchProcessKey(base));
    expect(bridgeLaunchProcessKey(first)).not.toBe(bridgeLaunchProcessKey({ ...base, environmentRevision: 'second' }));
    expect(bridgeLaunchProcessKey({ ...base, environmentRevision: undefined })).toBe(bridgeLaunchProcessKey(base));
  });
});
