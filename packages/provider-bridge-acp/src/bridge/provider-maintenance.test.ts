import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { CURSOR_ACP_MAINTENANCE, getAcpProviderHealth, __testing } from "./provider-maintenance.js";

function cursorMissingInstallationStatus() {
  return {
    executableName: "cursor-agent",
    executablePath: null,
    installed: false,
    installSource: "notInstalled" as const,
    currentVersion: null,
    latestVersion: null,
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction: {
      kind: "install" as const,
      label: "Install" as const,
      command: "install Cursor",
    },
    needsUpdate: false,
    versionUnsupported: false,
  };
}

describe("ACP provider maintenance", () => {
  it("passes the executable launch context into account maintenance", async () => {
    const readAccount = vi.fn(async () => ({ email: "alternate@example.com" }));
    const context = { cwd: process.cwd(), env: { HOME: "/alternate-home" } };
    const result = await getAcpProviderHealth({
      command: process.execPath,
      maintenance: { ...CURSOR_ACP_MAINTENANCE, readAccount },
      ...context,
    });
    expect(result).toMatchObject({ health: { status: "ready", accountEmail: "alternate@example.com" } });
    expect(readAccount).toHaveBeenCalledWith(context);
  });

  it("resolves Cursor credential and account paths in the supplied launch environment", () => {
    const env = { HOME: "/alternate-home", USERPROFILE: "/alternate-home" };
    const auth = process.platform === "win32"
      ? path.join(env.HOME, "AppData", "Roaming", "Cursor", "auth.json")
      : process.platform === "darwin"
        ? path.join(env.HOME, ".cursor", "auth.json")
        : path.join(env.HOME, ".config", "cursor", "auth.json");
    const state = process.platform === "win32"
      ? path.join(env.HOME, "AppData", "Roaming", "Cursor", "User", "globalStorage", "state.vscdb")
      : process.platform === "darwin"
        ? path.join(env.HOME, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb")
        : path.join(env.HOME, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
    expect(__testing.cursorAuthFilePath(env)).toBe(auth);
    expect(__testing.cursorStateDatabasePath(env)).toBe(state);
  });

  it("normalizes Cursor plan and spend limits without reading daemon state", () => {
    expect(
      __testing.normalizeUsage(
        {
          billingCycleEnd: "1767225600000",
          planUsage: { totalPercentUsed: 72.2 },
          spendLimitUsage: {
            overallUsed: "1250",
            overallLimit: "5000",
          },
        },
        { planInfo: { planName: "Pro" } },
        "cursor@example.com",
      ),
    ).toEqual({
      status: "ok",
      accountEmail: "cursor@example.com",
      planLabel: "Pro",
      windows: [
        {
          label: "Plan usage",
          usedPercent: 72,
          resetsAt: "2026-01-01T00:00:00.000Z",
        },
        {
          label: "On-demand spend",
          usedPercent: 25,
          resetsAt: "2026-01-01T00:00:00.000Z",
          cost: { usedUsdCents: 1250, limitUsdCents: 5000 },
        },
      ],
    });
  });

  it("offers the installer only through a fresh matching action", () => {
    expect(
      __testing.buildProviderInstallationRun(
        cursorMissingInstallationStatus(),
        {
          maintenance: CURSOR_ACP_MAINTENANCE,
          command: "cursor-agent",
          action: "install",
        },
      ),
    ).toMatchObject({
      available: true,
      command: { command: "sh" },
      verification: { kind: "installed" },
    });
    expect(
      __testing.buildProviderInstallationRun(
        { ...cursorMissingInstallationStatus(), installAction: null },
        { maintenance: undefined, command: "opencode", action: "install" },
      ),
    ).toEqual({
      available: false,
      message: "opencode install is not available on this host.",
    });
    expect(
      __testing.buildProviderInstallationRun(
        cursorMissingInstallationStatus(),
        {
          maintenance: undefined,
          command: "opencode",
          action: "install",
        },
      ),
    ).toEqual({
      available: false,
      message: "opencode install is not available on this host.",
    });
  });
});
