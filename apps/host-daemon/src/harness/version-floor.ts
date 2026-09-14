import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { compareVersions } from '@zana-ai/zcc-domain';

/** Present CLI whose probe banner is not a numeric version. Truthy for preflight. */
export const UNVERSIONED_HARNESS = 'unknown';

/** Extract one exact numeric CLI version; ranges and aliases are deliberately unsupported. */
export function normalizeHarnessVersion(output: string): string | undefined {
  return output.match(/(?:^|[^0-9])v?(\d+\.\d+\.\d+)(?:[^0-9]|$)/)?.[1];
}

function looksLikeUsageBanner(output: string): boolean {
  return /^Usage:/m.test(output);
}

function harnessCommandName(binaryPath: string): string {
  return basename(binaryPath).replace(/\.(cmd|exe|bat)$/i, '');
}

function readNamedPackageVersion(pkgPath: string, expectedName: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: unknown; version?: unknown };
    if (pkg.name !== expectedName || typeof pkg.version !== 'string') return undefined;
    return normalizeHarnessVersion(pkg.version);
  } catch {
    return undefined;
  }
}

function npmLayoutPackageJson(binaryPath: string, expectedName: string): string {
  const prefix = dirname(dirname(binaryPath));
  return process.platform === 'win32'
    ? join(prefix, 'node_modules', expectedName, 'package.json')
    : join(prefix, 'lib', 'node_modules', expectedName, 'package.json');
}

function versionFromBinaryPath(binaryPath: string, expectedName: string): string | undefined {
  if (basename(dirname(binaryPath)) === 'bin') {
    const fromLayout = readNamedPackageVersion(npmLayoutPackageJson(binaryPath, expectedName), expectedName);
    if (fromLayout) return fromLayout;
  }
  let cursor = binaryPath;
  try {
    cursor = realpathSync(binaryPath);
  } catch {
    /* keep the unresolved path */
  }
  for (let i = 0; i < 8; i++) {
    const version = readNamedPackageVersion(join(cursor, 'package.json'), expectedName);
    if (version) return version;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return undefined;
}

/**
 * Read `name`/`version` from the npm package that owns a resolved CLI binary.
 * Confined to the binary's npm prefix and a short walk from its realpath;
 * a random `~/package.json` cannot match because the package name must equal
 * the command basename (`mastracode` has no `--version` and prints Usage).
 */
export function harnessPackageVersion(
  binaryPath: string,
  extraBinDirs: readonly string[] = []
): string | undefined {
  if (!binaryPath) return undefined;
  const expectedName = harnessCommandName(binaryPath);
  if (!expectedName) return undefined;
  const seen = new Set<string>();
  for (const candidate of [binaryPath, ...extraBinDirs.map((dir) => join(dir, expectedName))]) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const version = versionFromBinaryPath(candidate, expectedName);
    if (version) return version;
  }
  return undefined;
}

/** Numeric x.y.z only. Help dumps, aliases, and {@link UNVERSIONED_HARNESS} are not comparable. */
export function comparableCliVersion(value: string | undefined): string | undefined {
  if (!value || value === UNVERSIONED_HARNESS) return undefined;
  return looksLikeUsageBanner(value) ? undefined : normalizeHarnessVersion(value);
}

/**
 * Enforce a reviewed CLI floor only when the installed version is numeric.
 * A present CLI whose probe is Usage-help (Mastra Code) must still launch.
 */
export function versionFloorDecision(
  installedVersion: string | undefined,
  requiredVersion: string
): { ok: true } | { ok: false; reason: string } {
  const parsed = comparableCliVersion(installedVersion);
  if (parsed) {
    if (compareVersions(parsed, requiredVersion) < 0) {
      return {
        ok: false,
        reason: `CLI version below reviewed floor (installed ${parsed}, requires >= ${requiredVersion})`
      };
    }
    return { ok: true };
  }
  if (installedVersion) return { ok: true };
  return {
    ok: false,
    reason: 'CLI version below reviewed floor (installed version could not be determined)'
  };
}

export function resolveProbedHarnessVersion(
  probeOut: string,
  binaryPath: string,
  extraBinDirs: readonly string[] = []
): string | undefined {
  const fromBanner = looksLikeUsageBanner(probeOut) ? undefined : normalizeHarnessVersion(probeOut);
  return fromBanner ?? harnessPackageVersion(binaryPath, extraBinDirs);
}
