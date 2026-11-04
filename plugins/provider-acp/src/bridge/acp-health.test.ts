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
    expect(await getGenericAcpProviderHealth({ command: null })).toEqual({ supported: false });
    expect(await getGenericAcpProviderHealth({ command: "   " })).toEqual({ supported: false });
  });

  it("reports not_installed when the command is absent from PATH", async () => {
    const previous = process.env.PATH;
    process.env.PATH = "/usr/bin:/bin";
    try {
      expect(await getGenericAcpProviderHealth({ command: "zcc-missing-opencode-cli" })).toMatchObject({
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
      expect(await getGenericAcpProviderHealth({ command: "opencode" })).toMatchObject({
        supported: true,
        health: { status: "ready", installedVersion: "1.2.3" },
      });
    } finally {
      process.env.PATH = previous;
    }
  });

  it("rejects a broken wrapper even when the executable exists", async () => {
    mkdirSync(binDir, { recursive: true });
    const binary = join(binDir, "broken-wrapper");
    writeFileSync(binary, "#!/bin/sh\necho 'wrapper target is missing' >&2\nexit 127\n");
    chmodSync(binary, 0o755);
    expect(await getGenericAcpProviderHealth({ command: binary })).toMatchObject({
      supported: true,
      health: { status: "unknown", statusMessage: expect.stringContaining("wrapper target is missing") },
    });
  });
});
