import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAcpLaunchHealth, type AcpLaunchHealthDeps } from "./launch-health.js";

const dirs: string[] = [];
function temporaryDirectory(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "zcc-launch-health-")));
  dirs.push(dir);
  return dir;
}
function executable(script: string): string {
  const command = join(temporaryDirectory(), "wrapper with spaces");
  writeFileSync(command, `#!/bin/sh\n${script}\n`);
  chmodSync(command, 0o755);
  return command;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("ACP launch health", () => {
  it.each([null, "", "   "])("does not probe an absent command %s", async command => {
    const runCommand = vi.fn();
    expect(await getAcpLaunchHealth({ command }, { runCommand })).toEqual({ supported: false });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it.each(["invalid\0command", "command\nargument", "command\rargument"])("rejects malformed executable %j without spawning", async command => {
    const runCommand = vi.fn();
    expect(await getAcpLaunchHealth({ command }, { runCommand })).toMatchObject({
      health: { status: "unknown", statusMessage: expect.stringContaining("single executable") },
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("uses bounded --version with exactly the configured launch context", async () => {
    vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
    vi.stubEnv("ZCC_PROVIDER_BRIDGE_RECORD_DIR", "/recording");
    const runCommand = vi.fn<AcpLaunchHealthDeps["runCommand"]>(async () => ({ stdout: "release 2.3.4", stderr: "" }));
    const result = await getAcpLaunchHealth({ command: "custom-agent", cwd: "/project", env: { PATH: "/custom/bin", CUSTOM_MODE: "test" } }, { runCommand });
    expect(result).toMatchObject({ health: { status: "ready", installedVersion: "2.3.4" } });
    expect(runCommand).toHaveBeenCalledWith("custom-agent", ["--version"], {
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      cwd: "/project",
      env: expect.objectContaining({ PATH: "/custom/bin", CUSTOM_MODE: "test" }),
    });
    expect(runCommand.mock.calls[0]?.[2].env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    expect(runCommand.mock.calls[0]?.[2].env).not.toHaveProperty("ZCC_PROVIDER_BRIDGE_RECORD_DIR");
  });

  it("keeps successful probes without a semver ready", async () => {
    expect(await getAcpLaunchHealth({ command: "agent" }, {
      runCommand: async () => ({ stdout: "development build", stderr: "" }),
    })).toMatchObject({ health: { status: "ready", installedVersion: null } });
  });

  it("does not treat version-looking output from a failed wrapper as ready", async () => {
    expect(await getAcpLaunchHealth({ command: executable("echo 1.2.3; echo 'missing wrapper target' >&2; exit 127") })).toMatchObject({
      health: { status: "unknown", installedVersion: null, statusMessage: expect.stringContaining("missing wrapper target") },
    });
  });

  it("resolves a PATH override and applies env/cwd in the child", async () => {
    const cwd = temporaryDirectory();
    const command = executable('[ "$1" = "--version" ] && [ "$PWD" = "$EXPECTED_CWD" ] && [ "$HEALTH_MODE" = "fixture" ] || exit 9\necho 4.5.6');
    const path = join(command, "..");
    expect(await getAcpLaunchHealth({
      command: "wrapper with spaces", cwd,
      env: { PATH: path, EXPECTED_CWD: cwd, HEALTH_MODE: "fixture" },
    })).toMatchObject({ health: { status: "ready", installedVersion: "4.5.6" } });
  });

  it("distinguishes a missing executable from an invalid cwd", async () => {
    const cwd = temporaryDirectory();
    expect(await getAcpLaunchHealth({ command: join(cwd, "absent"), cwd })).toMatchObject({ health: { status: "not_installed" } });
    expect(await getAcpLaunchHealth({ command: process.execPath, cwd: join(cwd, "absent") })).toMatchObject({ health: { status: "unknown" } });
  });

  it("does not interpret shell metacharacters", async () => {
    const sentinel = join(temporaryDirectory(), "should-not-exist");
    const command = `nonexistent; touch ${sentinel}`;
    expect(await getAcpLaunchHealth({ command })).toMatchObject({ health: { status: "not_installed" } });
    const { existsSync } = await import("node:fs");
    expect(existsSync(sentinel)).toBe(false);
  });

  it.each(["Command timed out after 5000ms", "Command output exceeded its byte limit"])("reports %s as unhealthy", async message => {
    expect(await getAcpLaunchHealth({ command: "agent" }, {
      runCommand: async () => { throw new Error(message); },
    })).toMatchObject({ health: { status: "unknown", statusMessage: expect.stringContaining(message) } });
  });

  it("bounds and redacts wrapper diagnostics", async () => {
    vi.stubEnv("PROVIDER_API_KEY", "ambient-credential-123");
    const result = await getAcpLaunchHealth({ command: "agent", env: { CUSTOM_KEY: "configured-credential-456" } }, {
      runCommand: async () => { throw new Error(`\u001b[31mambient-credential-123 configured-credential-456 ${"x".repeat(10_000)}`); },
    });
    if (!result.supported) throw new Error("expected health");
    expect(result.health.statusMessage).toContain("[redacted] [redacted]");
    expect(result.health.statusMessage).not.toMatch(/credential|\u001b/u);
    expect(result.health.statusMessage!.length).toBeLessThan(2_250);
  });

  it("handles a non-Error rejection without serializing its contents", async () => {
    expect(await getAcpLaunchHealth({ command: "agent" }, {
      runCommand: async () => { throw { secret: "do-not-serialize" }; },
    })).toMatchObject({ health: { status: "unknown", statusMessage: expect.stringContaining("Executable probe failed.") } });
  });
});
