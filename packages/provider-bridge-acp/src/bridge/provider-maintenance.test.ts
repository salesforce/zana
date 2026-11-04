import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { CURSOR_ACP_MAINTENANCE, getAcpProviderHealth, __testing } from "./provider-maintenance.js";

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...descriptor, value: platform });
  try {
    return run();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
}

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
  it("distinguishes absent, unsupported and unmaintained commands without reading accounts", async () => {
    const readAccount = vi.fn(async () => null);
    const maintenance = { ...CURSOR_ACP_MAINTENANCE, readAccount };
    expect(await getAcpProviderHealth({ maintenance, command: null })).toMatchObject({
      health: { status: "unknown", statusMessage: "The ACP provider has no launch command." },
    });
    expect(await getAcpProviderHealth({ maintenance, command: " " })).toEqual({ supported: false });
    expect(await getAcpProviderHealth({ maintenance, command: path.join(os.tmpdir(), "missing-acp-command", "agent") })).toMatchObject({
      health: { status: "not_installed", canInstall: true, canUpdate: false },
    });
    expect(await getAcpProviderHealth({ maintenance: undefined, command: process.execPath })).toMatchObject({
      health: { status: "ready", canInstall: false, canUpdate: false, loginCommand: null },
    });
    expect(readAccount).not.toHaveBeenCalled();
  });

  it.each([new Error("account unavailable"), "account unavailable"])("reports account failures after a successful executable probe: %s", async (error) => {
    const result = await getAcpProviderHealth({
      command: process.execPath,
      maintenance: { ...CURSOR_ACP_MAINTENANCE, readAccount: async () => { throw error; } },
    });
    expect(result).toMatchObject({ health: { status: "unknown", statusMessage: "account unavailable" } });
  });

  it("reports unauthenticated when the configured account reader has no credentials", async () => {
    expect(await getAcpProviderHealth({
      command: process.execPath,
      maintenance: { ...CURSOR_ACP_MAINTENANCE, readAccount: async () => null },
    })).toMatchObject({ health: { status: "unauthenticated", accountEmail: null } });
  });

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

  it("honors each native credential location and its environment precedence", () => {
    const home = path.join(os.tmpdir(), "configured-home");
    const profile = path.join(os.tmpdir(), "configured-profile");
    const appData = path.join(os.tmpdir(), "configured-appdata");
    const configHome = path.join(os.tmpdir(), "configured-config");
    withPlatform("win32", () => {
      for (const [env, base] of [
        [{ HOME: home, USERPROFILE: profile, APPDATA: appData }, appData],
        [{ HOME: home, USERPROFILE: profile }, path.join(profile, "AppData", "Roaming")],
        [{ HOME: home }, path.join(home, "AppData", "Roaming")],
        [{}, path.join(os.homedir(), "AppData", "Roaming")],
      ] as const) {
        expect(__testing.cursorAuthFilePath(env)).toBe(path.join(base, "Cursor", "auth.json"));
        expect(__testing.cursorStateDatabasePath(env)).toBe(path.join(base, "Cursor", "User", "globalStorage", "state.vscdb"));
      }
    });
    withPlatform("darwin", () => {
      expect(__testing.cursorAuthFilePath({ HOME: home })).toBe(path.join(home, ".cursor", "auth.json"));
      expect(__testing.cursorStateDatabasePath({ HOME: home })).toBe(path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"));
    });
    withPlatform("linux", () => {
      for (const [env, base] of [
        [{ HOME: home, XDG_CONFIG_HOME: configHome }, configHome],
        [{ HOME: home }, path.join(home, ".config")],
      ] as const) {
        expect(__testing.cursorAuthFilePath(env)).toBe(path.join(base, "cursor", "auth.json"));
        expect(__testing.cursorStateDatabasePath(env)).toBe(path.join(base, "Cursor", "User", "globalStorage", "state.vscdb"));
      }
    });
  });

  it("reads credentials and cached account only from the configured native home", async () => {
    const fixtureHome = mkdtempSync(path.join(os.tmpdir(), "acp-cursor-account-"));
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
    // Exercise file-backed credentials without consulting the macOS keychain.
    Object.defineProperty(process, "platform", { ...descriptor, value: "linux" });
    const env = { HOME: fixtureHome, XDG_CONFIG_HOME: path.join(fixtureHome, "config") };
    const authPath = __testing.cursorAuthFilePath(env);
    const databasePath = __testing.cursorStateDatabasePath(env);
    try {
      expect(await CURSOR_ACP_MAINTENANCE.readAccount({ env })).toBeNull();
      mkdirSync(path.dirname(authPath), { recursive: true });
      writeFileSync(authPath, JSON.stringify({ accessToken: 123 }));
      expect(await CURSOR_ACP_MAINTENANCE.readAccount({ env })).toBeNull();
      writeFileSync(authPath, JSON.stringify({ accessToken: "fixture-token" }));
      expect(await CURSOR_ACP_MAINTENANCE.readAccount({ env })).toEqual({ email: null });
      mkdirSync(path.dirname(databasePath), { recursive: true });
      const database = new DatabaseSync(databasePath);
      try {
        database.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
        database.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run("cursorAuth/cachedEmail", "configured@example.com");
      } finally {
        database.close();
      }
      expect(await CURSOR_ACP_MAINTENANCE.readAccount({ env })).toEqual({ email: "configured@example.com" });
    } finally {
      Object.defineProperty(process, "platform", descriptor);
      rmSync(fixtureHome, { recursive: true, force: true });
    }
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
