import { describe, expect, it } from "vitest";
import {
  isCursorLaunchCommand,
  normalizeCursorUsage,
  readCursorAuthCredentials,
} from "./cursor-maintenance.js";

describe("Cursor ACP maintenance", () => {
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
