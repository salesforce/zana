import { describe, expect, it } from "vitest";
import { describePiVersionProbeFailure } from "./provider-maintenance.js";

describe("describePiVersionProbeFailure", () => {
  it("names execFile's own timeout with the 15 s budget", () => {
    expect(
      describePiVersionProbeFailure(
        Object.assign(new Error("spawn timeout"), {
          killed: true,
          signal: "SIGTERM",
          code: null,
        }),
      ),
    ).toBe("timed out after 15 s");
  });

  it("distinguishes an external SIGTERM from the timeout", () => {
    expect(
      describePiVersionProbeFailure(
        Object.assign(new Error("killed"), {
          killed: false,
          signal: "SIGTERM",
          code: null,
        }),
      ),
    ).toBe("was stopped by SIGTERM before it answered");
  });

  it("reports a non-zero exit and falls back to the message", () => {
    expect(
      describePiVersionProbeFailure(
        Object.assign(new Error("Command failed"), { code: 2, killed: false }),
      ),
    ).toBe("exited with 2");
    expect(describePiVersionProbeFailure(new Error("ENOENT: pi"))).toBe(
      "ENOENT: pi",
    );
  });
});

describe("isManagedPi", () => {
  it("returns false for null executable path", async () => {
    const { isManagedPi } = await import("./provider-maintenance.js");
    expect(await isManagedPi(null)).toBe(false);
  });

  it("returns false for standard npm executable paths", async () => {
    const { isManagedPi } = await import("./provider-maintenance.js");
    expect(await isManagedPi("/usr/local/bin/pi")).toBe(false);
    expect(await isManagedPi("C:\\npm\\pi.cmd")).toBe(false);
  });

  it("identifies paths under ~/.pi/agent as managed", async () => {
    const { isManagedPi } = await import("./provider-maintenance.js");
    const os = await import("node:os");
    const path = await import("node:path");
    const managedPi = path.join(os.homedir(), ".pi", "agent", "bin", "pi");
    expect(await isManagedPi(managedPi)).toBe(true);
  });

  it("identifies paths under PI_MANAGED_INSTALL_ROOT as managed", async () => {
    const { isManagedPi } = await import("./provider-maintenance.js");
    const path = await import("node:path");
    const prev = process.env.PI_MANAGED_INSTALL_ROOT;
    try {
      process.env.PI_MANAGED_INSTALL_ROOT = "/opt/custom/pi-managed";
      expect(await isManagedPi("/opt/custom/pi-managed/bin/pi")).toBe(true);
      expect(await isManagedPi("/usr/bin/pi")).toBe(false);
    } finally {
      if (prev === undefined) {
        delete process.env.PI_MANAGED_INSTALL_ROOT;
      } else {
        process.env.PI_MANAGED_INSTALL_ROOT = prev;
      }
    }
  });
});
