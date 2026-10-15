import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  absolutePathEntries,
  isNoteworthyFallback,
  resolveWindowsPiInstallation,
  type WindowsPiResolution,
} from "./windows-resolver.js";

const PACKAGE_SEGMENTS = ["node_modules", "@earendil-works", "pi-coding-agent"];

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "zcc-win-pi-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeFile(filePath: string, content = ""): string {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return filePath;
}

function writePackage(packageDir: string, bin: unknown, cliRel?: string): void {
  writeFile(path.join(packageDir, "package.json"), JSON.stringify({ bin }));
  if (cliRel) writeFile(path.join(packageDir, cliRel), "// cli");
}

/** `<root>/<name>/pi.cmd` with a sibling npm package. */
function npmPrefix(name: string, bin: unknown = { pi: "dist/cli.js" }): {
  dir: string;
  packageDir: string;
} {
  const dir = path.join(root, name);
  const packageDir = path.join(dir, ...PACKAGE_SEGMENTS);
  writeFile(path.join(dir, "pi.cmd"), "@ECHO off\r\n");
  writePackage(packageDir, bin, "dist/cli.js");
  return { dir, packageDir };
}

/** `<root>/<name>/pi.cmd` with package under `global/<version>/node_modules/...`. */
function pnpmPrefix(
  name: string,
  globalVersion = "5",
  bin: unknown = { pi: "dist/cli.js" },
): {
  dir: string;
  packageDir: string;
} {
  const dir = path.join(root, name);
  const packageDir = path.join(
    dir,
    "global",
    globalVersion,
    ...PACKAGE_SEGMENTS,
  );
  writeFile(path.join(dir, "pi.cmd"), "@ECHO off\r\n");
  writePackage(packageDir, bin, "dist/cli.js");
  return { dir, packageDir };
}

/** `<root>/.pi/agent/{bin,install}` as written by Pi's managed installer. */
function managedInstall(version = "1.2.0"): {
  binDir: string;
  installRoot: string;
  packageDir: string;
} {
  const agentDir = path.join(root, ".pi", "agent");
  const binDir = path.join(agentDir, "bin");
  const installRoot = path.join(agentDir, "install");
  writeFile(path.join(binDir, "pi.cmd"), "@ECHO off\r\n");
  writeFile(path.join(binDir, "pi-launcher.js"), "// launcher");
  writeFile(path.join(installRoot, "current-version"), `${version}\n`);
  const packageDir = path.join(installRoot, "releases", version, ...PACKAGE_SEGMENTS);
  writePackage(packageDir, { pi: "./dist/bundle/cli.js" }, "dist/bundle/cli.js");
  return { binDir, installRoot, packageDir };
}

function nodeDir(): string {
  const dir = path.join(root, "nodejs");
  writeFile(path.join(dir, "node.exe"), "");
  return dir;
}

function pathOf(...entries: string[]): string {
  return entries.join(path.delimiter);
}

function expectFallback(
  resolution: WindowsPiResolution,
  reason: string,
): void {
  expect(resolution).toMatchObject({ kind: "fallback", reason });
}

describe("resolveWindowsPiInstallation", () => {
  it("launches the managed install's cli.js with node.exe from PATH", () => {
    const managed = managedInstall();
    const node = nodeDir();

    const resolution = resolveWindowsPiInstallation({
      pathEnv: pathOf(managed.binDir, node),
    });

    expect(resolution).toEqual({
      kind: "resolved",
      launch: {
        command: path.join(node, "node.exe"),
        args: [path.join(managed.packageDir, "dist", "bundle", "cli.js")],
        displayExecutablePath: path.join(managed.binDir, "pi.cmd"),
        installKind: "managed",
        env: { PI_MANAGED_INSTALL_ROOT: managed.installRoot },
      },
    });
  });

  it("prefers node.exe beside an npm shim over node on PATH", () => {
    const prefix = npmPrefix("npm");
    writeFile(path.join(prefix.dir, "node.exe"));
    const node = nodeDir();

    const resolution = resolveWindowsPiInstallation({
      pathEnv: pathOf(prefix.dir, node),
    });

    expect(resolution).toEqual({
      kind: "resolved",
      launch: {
        command: path.join(prefix.dir, "node.exe"),
        args: [path.join(prefix.packageDir, "dist", "cli.js")],
        displayExecutablePath: path.join(prefix.dir, "pi.cmd"),
        installKind: "npm",
      },
    });
  });

  it("accepts a string bin", () => {
    const prefix = npmPrefix("npm", "dist/cli.js");
    const resolution = resolveWindowsPiInstallation({
      pathEnv: pathOf(prefix.dir, nodeDir()),
    });
    expect(resolution.kind).toBe("resolved");
  });

  it("uses the first pi.cmd on PATH, like `where pi`", () => {
    const prefix = npmPrefix("npm");
    const managed = managedInstall();

    const resolution = resolveWindowsPiInstallation({
      pathEnv: pathOf(prefix.dir, managed.binDir, nodeDir()),
    });

    expect(resolution).toMatchObject({
      kind: "resolved",
      launch: { installKind: "npm" },
    });
  });

  it("accepts quoted PATH entries", () => {
    const prefix = npmPrefix("npm");
    const resolution = resolveWindowsPiInstallation({
      pathEnv: pathOf(`"${prefix.dir}"`, nodeDir()),
    });
    expect(resolution.kind).toBe("resolved");
  });

  it("ignores relative PATH entries so the cwd can't plant a Pi package", () => {
    npmPrefix("npm");
    // Each entry would reach `<root>/npm` if resolved against cwd = root.
    expectFallback(
      resolveWindowsPiInstallation({
        pathEnv: pathOf(".", "npm", `.${path.sep}npm`, nodeDir()),
      }),
      "no-shim-on-path",
    );
  });

  it("falls back when PATH is undefined or has no pi shim", () => {
    expectFallback(resolveWindowsPiInstallation({ pathEnv: undefined }), "no-shim-on-path");
    expectFallback(resolveWindowsPiInstallation({ pathEnv: nodeDir() }), "no-shim-on-path");
  });

  it("leaves a native pi.exe to the default launcher", () => {
    const dir = path.join(root, "bun");
    writeFile(path.join(dir, "pi.exe"));
    writeFile(path.join(dir, "pi.cmd"));
    expectFallback(resolveWindowsPiInstallation({ pathEnv: dir }), "native-executable");
  });

  it("does not interpret a pi.bat shim", () => {
    const dir = path.join(root, "bat");
    writeFile(path.join(dir, "pi.bat"));
    expectFallback(resolveWindowsPiInstallation({ pathEnv: dir }), "unrecognized-layout");
  });

  it("does not guess at a pi.cmd with no recognisable install beside it", () => {
    const dir = path.join(root, "custom");
    writeFile(path.join(dir, "pi.cmd"));
    expectFallback(
      resolveWindowsPiInstallation({ pathEnv: pathOf(dir, nodeDir()) }),
      "unrecognized-layout",
    );
  });

  it("rejects a bin that escapes the package directory", () => {
    const prefix = npmPrefix("npm", { pi: "../../../evil.js" });
    writeFile(path.join(root, "npm", "evil.js"), "// evil");
    writeFile(path.join(root, "evil.js"), "// evil");
    expectFallback(
      resolveWindowsPiInstallation({ pathEnv: pathOf(prefix.dir, nodeDir()) }),
      "cli-outside-package",
    );
  });

  it("rejects a bin that points at the package directory itself", () => {
    const prefix = npmPrefix("npm", { pi: "." });
    expectFallback(
      resolveWindowsPiInstallation({ pathEnv: pathOf(prefix.dir, nodeDir()) }),
      "cli-outside-package",
    );
  });

  it("rejects a bin that is a directory", () => {
    const prefix = npmPrefix("npm", { pi: "dist" });
    expectFallback(
      resolveWindowsPiInstallation({ pathEnv: pathOf(prefix.dir, nodeDir()) }),
      "invalid-package",
    );
  });

  it.each([
    ["missing bin file", { pi: "dist/missing.js" }],
    ["no pi bin", { other: "dist/cli.js" }],
    ["non-string pi bin", { pi: 42 }],
    ["null bin", null],
  ])("rejects a package with %s", (_label, bin) => {
    const prefix = npmPrefix("npm", bin);
    expectFallback(
      resolveWindowsPiInstallation({ pathEnv: pathOf(prefix.dir, nodeDir()) }),
      "invalid-package",
    );
  });

  it("rejects a malformed package.json", () => {
    const prefix = npmPrefix("npm");
    writeFile(path.join(prefix.packageDir, "package.json"), "{not json");
    expectFallback(
      resolveWindowsPiInstallation({ pathEnv: pathOf(prefix.dir, nodeDir()) }),
      "invalid-package",
    );
  });

  it.each(["..", ".", "../escape", "a/b", ""])(
    "rejects managed current-version %j",
    (version) => {
      const managed = managedInstall();
      writeFile(path.join(managed.installRoot, "current-version"), version);
      expectFallback(
        resolveWindowsPiInstallation({ pathEnv: pathOf(managed.binDir, nodeDir()) }),
        "invalid-managed-version",
      );
    },
  );

  it("resolves pnpm global layout under PNPM_HOME/global/<version>/node_modules", () => {
    const pnpm = pnpmPrefix("pnpm-home", "5");
    const node = nodeDir();

    const resolution = resolveWindowsPiInstallation({
      pathEnv: pathOf(pnpm.dir, node),
    });

    expect(resolution).toEqual({
      kind: "resolved",
      launch: {
        command: path.join(node, "node.exe"),
        args: [path.join(pnpm.packageDir, "dist", "cli.js")],
        displayExecutablePath: path.join(pnpm.dir, "pi.cmd"),
        installKind: "pnpm",
      },
    });
  });

  it("falls back to the shim when no node.exe exists", () => {
    const prefix = npmPrefix("npm");
    expectFallback(resolveWindowsPiInstallation({ pathEnv: prefix.dir }), "node-not-found");
  });

  it("degrades unexpected I/O errors to a fallback", () => {
    const managed = managedInstall();
    // A directory where the version file is expected passes the layout existence
    // check but makes readFileSync throw EISDIR/EPERM, exercising the catch block.
    rmSync(path.join(managed.installRoot, "current-version"));
    mkdirSync(path.join(managed.installRoot, "current-version"));
    writeFile(path.join(managed.installRoot, "x"));
    const resolution = resolveWindowsPiInstallation({
      pathEnv: pathOf(managed.binDir, nodeDir()),
    });
    expect(resolution).toEqual({
      kind: "fallback",
      reason: "unrecognized-layout",
      detail: expect.stringMatching(/EISDIR|EPERM|read/i),
    });
  });
});

describe("absolutePathEntries", () => {
  it("drops empty, relative and duplicate entries", () => {
    const absolute = path.join(root, "a");
    expect(
      absolutePathEntries(pathOf("", "  ", "relative", absolute, absolute)),
    ).toEqual([absolute]);
  });
});

describe("isNoteworthyFallback", () => {
  it("stays quiet for normal situations only", () => {
    expect(isNoteworthyFallback("no-shim-on-path")).toBe(false);
    expect(isNoteworthyFallback("native-executable")).toBe(false);
    expect(isNoteworthyFallback("cli-outside-package")).toBe(true);
    expect(isNoteworthyFallback("node-not-found")).toBe(true);
  });
});
