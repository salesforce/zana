import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const maintenanceState = vi.hoisted(() => ({
  launch: {
    command: "C:\\nodejs\\node.exe",
    args: ["C:\\pi\\agent\\releases\\1.2.0\\dist\\cli.js"],
    displayExecutablePath: "C:\\pi\\agent\\bin\\pi.cmd",
    installKind: "managed" as const,
    env: { PI_MANAGED_INSTALL_ROOT: "C:\\pi\\agent\\install" },
  },
  latestVersion: "1.3.0",
  currentVersion: "1.2.0",
}));

vi.mock("./rpc-child.js", () => ({
  resolvePiLaunch: () => maintenanceState.launch,
  withPiLaunchEnv: (base: Record<string, string>, launch: { env?: Record<string, string> }) =>
    launch.env ? { ...base, ...launch.env } : base,
}));

vi.mock("@zana-ai/zcc-plugin-sdk/provider-bridge", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@zana-ai/zcc-plugin-sdk/provider-bridge")>();
  return {
    ...original,
    experimental_runPortableCommand: vi.fn(async () => ({
      stdout: `${maintenanceState.currentVersion}\n`,
      stderr: "",
    })),
    experimental_npmLatestVersion: vi.fn(async () => maintenanceState.latestVersion),
    experimental_probeNpmGlobalPackage: vi.fn(async () => ({
      npmBin: path.join("C:", "npm"),
      npmGlobalPackageVersion: null,
    })),
    experimental_resolveExecutablePath: vi.fn(async () => null),
  };
});

import {
  getPiProviderInstallationRun,
  getPiProviderInstallationStatus,
  probePiVersion,
} from "./provider-maintenance.js";

describe("provider-maintenance with managed Windows Pi installation", () => {
  it("uses displayExecutablePath and offers 'pi update self' for managed install", async () => {
    const status = await getPiProviderInstallationStatus();

    expect(status.installed).toBe(true);
    expect(status.executablePath).toBe(
      maintenanceState.launch.displayExecutablePath,
    );
    expect(status.currentVersion).toBe("1.2.0");
    expect(status.latestVersion).toBe("1.3.0");
    expect(status.needsUpdate).toBe(true);
    expect(status.installAction).toEqual({
      kind: "update",
      label: "Update",
      command: "pi update self",
    });
  });

  it("returns 'pi update self' for installation run on managed install", async () => {
    const run = await getPiProviderInstallationRun("update");

    expect(run).toMatchObject({
      available: true,
      command: {
        command: maintenanceState.launch.displayExecutablePath,
        args: ["update", "self"],
        displayCommand: "pi update self",
      },
    });
  });

  it("probes version using launch command, args, and launch.env", async () => {
    const probe = await probePiVersion();
    expect(probe).toEqual({
      version: "1.2.0",
      failure: null,
    });
  });
});
