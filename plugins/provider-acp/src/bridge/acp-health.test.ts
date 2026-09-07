import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getGenericAcpProviderHealth } from "./acp-health.js";

const binDir = join(tmpdir(), `zcc-acp-health-${process.pid}`);

afterEach(() => {
  rmSync(binDir, { recursive: true, force: true });
});

describe("getGenericAcpProviderHealth", () => {
  it("returns a noop when the launch command is missing", async () => {
    expect(await getGenericAcpProviderHealth(null)).toEqual({ supported: false });
    expect(await getGenericAcpProviderHealth("   ")).toEqual({ supported: false });
  });

  it("reports not_installed when the command is absent from PATH", async () => {
    const previous = process.env.PATH;
    process.env.PATH = "/usr/bin:/bin";
    try {
      expect(await getGenericAcpProviderHealth("zcc-missing-opencode-cli")).toMatchObject({
        supported: true,
        health: { status: "not_installed" },
      });
    } finally {
      process.env.PATH = previous;
    }
  });

  it("reports ready when the command resolves on PATH", async () => {
    mkdirSync(binDir, { recursive: true });
    const binary = join(binDir, "opencode");
    writeFileSync(binary, "#!/bin/sh\necho 1.2.3\n");
    chmodSync(binary, 0o755);
    const previous = process.env.PATH;
    process.env.PATH = `${binDir}:/usr/bin:/bin`;
    try {
      expect(await getGenericAcpProviderHealth("opencode")).toMatchObject({
        supported: true,
        health: { status: "ready", installedVersion: "1.2.3" },
      });
    } finally {
      process.env.PATH = previous;
    }
  });

  it("treats a which miss as installed when --version still runs", async () => {
    expect(
      await getGenericAcpProviderHealth("opencode", {
        resolveExecutablePath: async () => null,
        readCliVersion: async () => "1.2.3",
      }),
    ).toMatchObject({
      supported: true,
      health: { status: "ready", installedVersion: "1.2.3" },
    });
  });
});
