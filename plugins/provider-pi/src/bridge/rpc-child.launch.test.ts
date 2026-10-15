import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPiLaunchReportsForTests,
  resolvePiLaunch,
  withPiLaunchEnv,
} from "./rpc-child.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "zcc-pi-launch-"));
  resetPiLaunchReportsForTests();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  resetPiLaunchReportsForTests();
  vi.restoreAllMocks();
});

function writeFile(filePath: string, content = ""): string {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return filePath;
}

describe("resolvePiLaunch", () => {
  it("returns default pi command on non-Windows platforms when no env override is set", () => {
    const launch = resolvePiLaunch({}, "linux");
    expect(launch).toEqual({ command: "pi", args: [] });
  });

  it("resolves Windows Pi install on win32 when pi.cmd and package exist", () => {
    const npmDir = path.join(root, "npm");
    const nodeDir = path.join(root, "node");
    writeFile(path.join(npmDir, "pi.cmd"));
    writeFile(path.join(nodeDir, "node.exe"));
    const pkgDir = path.join(
      npmDir,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
    );
    writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ bin: "dist/cli.js" }),
    );
    writeFile(path.join(pkgDir, "dist", "cli.js"), "// cli");

    const launch = resolvePiLaunch(
      { PATH: `${npmDir}${path.delimiter}${nodeDir}` },
      "win32",
    );
    expect(launch.command).toBe(path.join(nodeDir, "node.exe"));
    expect(launch.args).toEqual([path.join(pkgDir, "dist", "cli.js")]);
    expect(launch.displayExecutablePath).toBe(path.join(npmDir, "pi.cmd"));
    expect(launch.installKind).toBe("npm");
  });

  it("falls back to default pi and logs noteworthy fallback once", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const npmDir = path.join(root, "npm");
    writeFile(path.join(npmDir, "pi.cmd"));
    // Layout unrecognized -> "unrecognized-layout" is a noteworthy fallback

    const launch1 = resolvePiLaunch({ PATH: npmDir }, "win32");
    expect(launch1).toEqual({ command: "pi", args: [] });
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy.mock.calls[0][0]).toContain(
      "pi bridge: using pi shim, windows resolve skipped (unrecognized-layout)",
    );

    // Second call with same failure should be deduplicated
    const launch2 = resolvePiLaunch({ PATH: npmDir }, "win32");
    expect(launch2).toEqual({ command: "pi", args: [] });
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it("does not log stderr for normal non-noteworthy fallbacks like no-shim-on-path", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const launch = resolvePiLaunch({ PATH: root }, "win32");
    expect(launch).toEqual({ command: "pi", args: [] });
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("memoizes resolution keyed by PATH within TTL", () => {
    const npmDir = path.join(root, "npm");
    const nodeDir = path.join(root, "node");
    writeFile(path.join(npmDir, "pi.cmd"));
    writeFile(path.join(nodeDir, "node.exe"));
    const pkgDir = path.join(
      npmDir,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
    );
    writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ bin: "dist/cli.js" }),
    );
    const cliFile = writeFile(path.join(pkgDir, "dist", "cli.js"), "// cli");

    const env = { PATH: `${npmDir}${path.delimiter}${nodeDir}` };
    const first = resolvePiLaunch(env, "win32");
    expect(first.command).toBe(path.join(nodeDir, "node.exe"));

    // If the file is deleted while cached, memoization returns the cached launch
    rmSync(cliFile);
    const second = resolvePiLaunch(env, "win32");
    expect(second).toBe(first);

    // After reset, it re-resolves and notices the missing file
    resetPiLaunchReportsForTests();
    const third = resolvePiLaunch(env, "win32");
    expect(third).toEqual({ command: "pi", args: [] });
  });
});

describe("withPiLaunchEnv", () => {
  it("leaves base env untouched when launch has no env", () => {
    const base = { FOO: "bar" };
    expect(withPiLaunchEnv(base, { command: "pi", args: [] })).toBe(base);
  });

  it("lets launch env override base env", () => {
    const base = {
      PI_MANAGED_INSTALL_ROOT: "wrong/root",
      OTHER: "value",
    };
    const launch = {
      command: "node.exe",
      args: ["cli.js"],
      env: { PI_MANAGED_INSTALL_ROOT: "correct/root" },
    };
    const merged = withPiLaunchEnv(base, launch);
    expect(merged).toEqual({
      PI_MANAGED_INSTALL_ROOT: "correct/root",
      OTHER: "value",
    });
  });
});
