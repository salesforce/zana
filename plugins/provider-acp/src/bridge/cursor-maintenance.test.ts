import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import * as acpHealth from "./acp-health.js";
import {
  isCursorLaunchCommand,
  getCursorProviderHealth,
  normalizeCursorUsage,
  readCursorAuthCredentials,
} from "./cursor-maintenance.js";

describe("Cursor ACP maintenance", () => {
  it("checks the configured Cursor command before reading account credentials", async () => {
    const readAuthFile = vi.fn();
    const result = await getCursorProviderHealth({ readAuthFile }, { command: "/missing/configured-cursor" });
    expect(result).toMatchObject({ health: { status: "not_installed" } });
    expect(readAuthFile).not.toHaveBeenCalled();
  });

  it.each([undefined, "/injected-home"])("reads auth from the launch HOME, preserving injected home %s", async (homeDir) => {
    const readAuthFile = vi.fn(async () => JSON.stringify({ accessToken: "tok", email: "alternate@example.com" }));
    const readKeychain = vi.fn(async () => null);
    const result = await getCursorProviderHealth(
      { homeDir, readAuthFile, readKeychain },
      { command: process.execPath, env: { HOME: "/alternate-home", USERPROFILE: "/alternate-home" } },
    );
    expect(result).toMatchObject({ health: { status: "ready", accountEmail: "alternate@example.com" } });
    expect(readAuthFile).toHaveBeenCalledWith(join(homeDir ?? "/alternate-home", ".cursor", "auth.json"));
    expect(readKeychain).not.toHaveBeenCalled();
  });

  it.each([
    { env: { HOME: "/launch-home", USERPROFILE: "/launch-profile" }, expectedHome: "/launch-profile" },
    { env: { HOME: "/launch-home" }, expectedHome: "/launch-home" },
  ])("uses Windows launch home precedence: $expectedHome", async ({ env, expectedHome }) => {
    // The executable probe is independent of Windows credential path selection.
    const ready = await acpHealth.getGenericAcpProviderHealth({ command: process.execPath });
    const probe = vi.spyOn(acpHealth, "getGenericAcpProviderHealth").mockResolvedValue(ready);
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
    const readAuthFile = vi.fn(async () => JSON.stringify({ accessToken: "fixture-token", email: "configured@example.com" }));
    Object.defineProperty(process, "platform", { ...descriptor, value: "win32" });
    try {
      const result = await getCursorProviderHealth(
        { readAuthFile, readKeychain: async () => null },
        { command: "configured-cursor-agent", env },
      );
      expect(result).toMatchObject({ health: { status: "ready", accountEmail: "configured@example.com" } });
      expect(readAuthFile).toHaveBeenCalledWith(join(expectedHome, ".cursor", "auth.json"));
      expect(probe).toHaveBeenCalledWith({ command: "configured-cursor-agent", env });
    } finally {
      Object.defineProperty(process, "platform", descriptor);
      probe.mockRestore();
    }
  });
  it("normalizes dashboard windows and rejects malformed usage", () => {
    expect(
      normalizeCursorUsage(
        {
          email: "dev@example.com",
          membershipType: "pro",
          windows: [{ label: "Fast", usedPercent: 41.2, resetsAt: null }],
        },
        null,
      ),
    ).toEqual({
      status: "ok",
      accountEmail: "dev@example.com",
      planLabel: "pro",
      windows: [{ label: "Fast", usedPercent: 41, resetsAt: null }],
    });
    expect(normalizeCursorUsage({ not: "usage" }, "dev@example.com")).toEqual({
      status: "error",
      message: "Cursor usage response was malformed.",
      planLabel: null,
      accountEmail: "dev@example.com",
    });
  });

  it("reads host-local auth.json", async () => {
    await expect(
      readCursorAuthCredentials({
        homeDir: "/tmp/missing-cursor-home",
        readAuthFile: async () => {
          throw new Error("missing");
        },
        readKeychain: async () => null,
      }),
    ).resolves.toBeNull();
    await expect(
      readCursorAuthCredentials({
        readAuthFile: async () =>
          JSON.stringify({ accessToken: "tok", email: "dev@example.com" }),
        readKeychain: async () => null,
      }),
    ).resolves.toEqual({
      accessToken: "tok",
      accountEmail: "dev@example.com",
    });
  });

  it("recognizes the Cursor launch command", () => {
    expect(isCursorLaunchCommand("cursor-agent")).toBe(true);
    expect(isCursorLaunchCommand("/opt/bin/cursor-agent")).toBe(true);
    expect(isCursorLaunchCommand("opencode")).toBe(false);
  });
});
