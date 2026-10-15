import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Windows-only Pi launch resolution.
 *
 * Why this exists: on Windows, `pi` is a `pi.cmd` shim. cross-spawn runs
 * `.cmd` files through `cmd.exe`, and the managed install's `pi-launcher.js`
 * re-spawns Pi with `stdio: "inherit"`. Both forward only fds 0–2, so the
 * bridge's fd 3/4 channel never reaches Pi. We therefore locate the shim the
 * user's shell would run, identify which install it belongs to, and launch
 * that install's `cli.js` directly with a real `node.exe`.
 *
 * Trust rules (the bridge cwd is often an untrusted project checkout):
 * - only absolute PATH entries are considered;
 * - install layouts are recognised by directory structure, never by parsing
 *   shim text;
 * - the package's `bin` must realpath-resolve to a regular file inside the
 *   package directory (the same check Pi's own `pi-launcher.js` performs);
 * - Electron's `process.execPath` is never used as the Node runtime: the
 *   bridge strips `ELECTRON_RUN_AS_NODE` from the child env, so it would
 *   start a GUI app instead of Node.
 * Anything unrecognised falls back to the plain shim.
 */

export type WindowsPiInstallKind = "managed" | "npm" | "pnpm";

export interface ResolvedWindowsPi {
  /** Absolute path to a real `node.exe`. */
  command: string;
  /** `[cliPath]` — the package's declared `pi` bin. */
  args: string[];
  /** The `pi.cmd` shim the user's shell would run; shown in Settings. */
  displayExecutablePath: string;
  installKind: WindowsPiInstallKind;
  env?: Record<string, string>;
}

/** Fallback reasons the caller may want to surface; see `isNoteworthyFallback`. */
export type WindowsPiFallbackReason =
  | "no-shim-on-path"
  | "native-executable"
  | "unrecognized-layout"
  | "invalid-managed-version"
  | "invalid-package"
  | "cli-outside-package"
  | "node-not-found";

export type WindowsPiResolution =
  | { kind: "resolved"; launch: ResolvedWindowsPi }
  | { kind: "fallback"; reason: WindowsPiFallbackReason; detail: string };

export interface ResolveWindowsPiOptions {
  /** The PATH value to search (e.g. `env.PATH`). */
  pathEnv: string | undefined;
}

const PI_PACKAGE_SEGMENTS = ["@earendil-works", "pi-coding-agent"] as const;
const MANAGED_VERSION_PATTERN = /^[0-9A-Za-z._+-]+$/;
/**
 * Shim extensions in default PATHEXT order. `where pi` would pick the first
 * one present in the first matching directory.
 */
const SHIM_EXTENSIONS = [".com", ".exe", ".bat", ".cmd"] as const;

class FallbackError extends Error {
  constructor(
    readonly reason: WindowsPiFallbackReason,
    readonly detail: string,
  ) {
    super(`${reason}: ${detail}`);
  }
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/** Absolute PATH entries only; Windows allows quoted entries. */
export function absolutePathEntries(pathEnv: string | undefined): string[] {
  if (!pathEnv) return [];
  const entries: string[] = [];
  for (const rawEntry of pathEnv.split(path.delimiter)) {
    const entry = rawEntry.trim().replace(/^"(.*)"$/u, "$1");
    if (entry && path.isAbsolute(entry) && !entries.includes(entry)) {
      entries.push(entry);
    }
  }
  return entries;
}

interface PiShim {
  directory: string;
  shimPath: string;
}

function findFirstPiShim(pathEntries: readonly string[]): PiShim {
  for (const directory of pathEntries) {
    for (const extension of SHIM_EXTENSIONS) {
      const shimPath = path.join(directory, `pi${extension}`);
      if (!isFile(shimPath)) continue;
      if (extension === ".cmd") return { directory, shimPath };
      // A native pi.exe (e.g. Bun) keeps custom fds without our help.
      throw new FallbackError(
        extension === ".exe" || extension === ".com"
          ? "native-executable"
          : "unrecognized-layout",
        shimPath,
      );
    }
  }
  throw new FallbackError("no-shim-on-path", "pi.cmd not found on PATH");
}

function isPathInside(child: string, parent: string): boolean {
  const relativePath = path.relative(parent, child);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}

/**
 * Returns the realpath of the package's `pi` bin, guaranteed to be a regular
 * file inside the (realpath'd) package directory.
 */
function resolveContainedCli(packageDir: string): string {
  let declaredBin: string | undefined;
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(packageDir, "package.json"), "utf8"),
    ) as { bin?: unknown };
    if (typeof manifest.bin === "string") {
      declaredBin = manifest.bin;
    } else if (manifest.bin !== null && typeof manifest.bin === "object") {
      const piBin = (manifest.bin as Record<string, unknown>).pi;
      declaredBin = typeof piBin === "string" ? piBin : undefined;
    }
  } catch (error) {
    throw new FallbackError(
      "invalid-package",
      `${packageDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!declaredBin) {
    throw new FallbackError("invalid-package", `${packageDir}: no pi bin`);
  }

  let realPackageDir: string;
  let realCliPath: string;
  try {
    realPackageDir = realpathSync(packageDir);
    realCliPath = realpathSync(path.resolve(packageDir, declaredBin));
  } catch {
    throw new FallbackError("invalid-package", `${packageDir}: bin missing`);
  }
  if (!isPathInside(realCliPath, realPackageDir)) {
    throw new FallbackError("cli-outside-package", realCliPath);
  }
  if (!isFile(realCliPath)) {
    throw new FallbackError("invalid-package", `${realCliPath}: not a file`);
  }
  return realCliPath;
}

interface ResolvedInstall {
  installKind: WindowsPiInstallKind;
  cliPath: string;
  env?: Record<string, string>;
}

/** Mirrors `~/.pi/agent/bin/pi-launcher.js` (layout "releases-v1"). */
function resolveManagedInstall(shimDirectory: string): ResolvedInstall {
  const installRoot = path.join(path.dirname(shimDirectory), "install");
  const currentVersion = readFileSync(
    path.join(installRoot, "current-version"),
    "utf8",
  ).trim();
  if (
    !currentVersion ||
    currentVersion === "." ||
    currentVersion === ".." ||
    !MANAGED_VERSION_PATTERN.test(currentVersion)
  ) {
    throw new FallbackError("invalid-managed-version", currentVersion);
  }
  const packageDir = path.join(
    installRoot,
    "releases",
    currentVersion,
    "node_modules",
    ...PI_PACKAGE_SEGMENTS,
  );
  return {
    installKind: "managed",
    cliPath: resolveContainedCli(packageDir),
    // pi-launcher.js sets this so Pi's self-update knows its install root.
    env: { PI_MANAGED_INSTALL_ROOT: installRoot },
  };
}

function resolvePnpmGlobalInstall(shimDirectory: string): ResolvedInstall | null {
  const globalDir = path.join(shimDirectory, "global");
  if (!isDirectory(globalDir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(globalDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const candidate = path.join(
      globalDir,
      entry,
      "node_modules",
      ...PI_PACKAGE_SEGMENTS,
    );
    if (isDirectory(candidate)) {
      return {
        installKind: "pnpm",
        cliPath: resolveContainedCli(candidate),
      };
    }
  }
  const directCandidate = path.join(
    globalDir,
    "node_modules",
    ...PI_PACKAGE_SEGMENTS,
  );
  if (isDirectory(directCandidate)) {
    return {
      installKind: "pnpm",
      cliPath: resolveContainedCli(directCandidate),
    };
  }
  return null;
}

function resolveInstallForShim(shimDirectory: string): ResolvedInstall {
  const isManaged =
    isFile(path.join(shimDirectory, "pi-launcher.js")) &&
    existsSync(
      path.join(path.dirname(shimDirectory), "install", "current-version"),
    );
  if (isManaged) return resolveManagedInstall(shimDirectory);

  const npmPackageDir = path.join(
    shimDirectory,
    "node_modules",
    ...PI_PACKAGE_SEGMENTS,
  );
  if (isDirectory(npmPackageDir)) {
    return { installKind: "npm", cliPath: resolveContainedCli(npmPackageDir) };
  }

  const pnpmInstall = resolvePnpmGlobalInstall(shimDirectory);
  if (pnpmInstall !== null) return pnpmInstall;

  throw new FallbackError("unrecognized-layout", shimDirectory);
}

/** npm shims prefer a `node.exe` beside them, then `node` on PATH. */
function findNodeExecutable(
  shimDirectory: string,
  pathEntries: readonly string[],
): string {
  for (const directory of [shimDirectory, ...pathEntries]) {
    const candidate = path.join(directory, "node.exe");
    if (isFile(candidate)) return candidate;
  }
  throw new FallbackError("node-not-found", "node.exe not found on PATH");
}

export function resolveWindowsPiInstallation(
  options: ResolveWindowsPiOptions,
): WindowsPiResolution {
  try {
    const pathEntries = absolutePathEntries(options.pathEnv);
    const shim = findFirstPiShim(pathEntries);
    const install = resolveInstallForShim(shim.directory);
    const nodeExecutable = findNodeExecutable(shim.directory, pathEntries);
    return {
      kind: "resolved",
      launch: {
        command: nodeExecutable,
        args: [install.cliPath],
        displayExecutablePath: shim.shimPath,
        installKind: install.installKind,
        ...(install.env ? { env: install.env } : {}),
      },
    };
  } catch (error) {
    if (error instanceof FallbackError) {
      return { kind: "fallback", reason: error.reason, detail: error.detail };
    }
    // Unexpected I/O (e.g. a racing uninstall). The shim is still a valid
    // launch, so degrade instead of failing the session.
    return {
      kind: "fallback",
      reason: "unrecognized-layout",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * "No shim" and "native exe" are normal situations; everything else means a
 * Pi install exists but could not be launched directly, so it's worth a log.
 */
export function isNoteworthyFallback(reason: WindowsPiFallbackReason): boolean {
  return reason !== "no-shim-on-path" && reason !== "native-executable";
}
