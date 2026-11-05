import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { homedir } from 'node:os';
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from 'node:timers/promises';
import { omitNpmScriptPolicyEnv } from "@zana-ai/zcc-agent-process-utils";
import { resolveBundledNpmCli } from './npm-cli.js';

const run = promisify(execFile);
const FETCH_TIMEOUT_MS = 120_000;
const LOCK_STALE_MS = 5 * 60_000;
const pending = new Map<string, Promise<PluginBuildToolchain>>();

export interface ToolchainOptions {
  onFetchStart?: () => void;
  onFetchDone?: (elapsedMs: number) => void;
  ignoreLocal?: boolean;
  /** Internal bootstrap/test seam; never supplied by the renderer. */
  npmCliPath?: string;
  timeoutMs?: number;
  lockWaitMs?: number;
}

export function getPluginBuildToolchain(dataDir = process.env.ZCC_DATA_DIR || join(homedir(), '.zcc'), options?: ToolchainOptions): Promise<PluginBuildToolchain> {
  return resolvePluginBuildToolchain(join(dataDir, 'plugins'), options);
}

export const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "var __filename = __fileURLToPath(import.meta.url);",
  "var __dirname = __pathDirname(__filename);",
].join("\n");

export const PLUGIN_TOOLCHAIN_PINS = {
  esbuild: "0.28.1",
  "@tailwindcss/node": "4.3.0",
  "@tailwindcss/oxide": "4.3.0",
  tailwindcss: "4.3.0",
} as const;

export interface PluginBuildToolchain {
  esbuild: string;
  tailwindNode: string;
  tailwindOxide: string;
  tailwindCssDir: string;
}

function pinKey(): string {
  return Object.entries(PLUGIN_TOOLCHAIN_PINS)
    .map(([name, version]) => `${name}@${version}`)
    .sort()
    .join(",");
}

export function toolchainCacheDir(baseDir: string): string {
  const key = Object.values(PLUGIN_TOOLCHAIN_PINS).join("-");
  return join(baseDir, `toolchain-${process.platform}-${process.arch}-${key}`);
}

function packageDir(require: NodeRequire, name: string): string | null {
  let dir: string;
  try {
    dir = dirname(require.resolve(name));
  } catch {
    return null;
  }
  for (let depth = 0; depth < 10; depth += 1) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          (parsed as { name?: unknown }).name === name
        ) {
          return dir;
        }
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function readVersion(require: NodeRequire, name: string): string | null {
  const dir = packageDir(require, name);
  if (dir === null) return null;
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    );
    const version =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { version?: unknown }).version
        : undefined;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

function toolchainFrom(require: NodeRequire): PluginBuildToolchain | null {
  for (const [name, pinned] of Object.entries(PLUGIN_TOOLCHAIN_PINS)) {
    if (readVersion(require, name) !== pinned) return null;
  }
  try {
    const tailwindCssDir = packageDir(require, "tailwindcss");
    if (tailwindCssDir === null) return null;
    return {
      esbuild: pathToFileURL(require.resolve("esbuild")).href,
      tailwindNode: pathToFileURL(require.resolve("@tailwindcss/node")).href,
      tailwindOxide: pathToFileURL(require.resolve("@tailwindcss/oxide")).href,
      tailwindCssDir,
    };
  } catch {
    return null;
  }
}

function resolveLocalToolchain(): PluginBuildToolchain | null {
  return toolchainFrom(createRequire(import.meta.url));
}

async function isInstalled(dir: string): Promise<boolean> {
  try {
    const raw = await readFile(join(dir, ".zcc-toolchain.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { pins?: unknown }).pins !== pinKey()
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return toolchainFrom(createRequire(join(dir, "noop.js"))) !== null;
}

export async function resolvePluginBuildToolchain(
  baseDir: string,
  options?: ToolchainOptions,
): Promise<PluginBuildToolchain> {
  if (options?.ignoreLocal !== true) {
    const local = resolveLocalToolchain();
    if (local !== null) return local;
  }

  const dir = toolchainCacheDir(baseDir);
  const existing = pending.get(dir);
  if (existing) return existing;
  const download = resolveCachedToolchain(dir, options);
  pending.set(dir, download);
  try {
    return await download;
  } finally {
    if (pending.get(dir) === download) pending.delete(dir);
  }
}

/** Serialize separate CLI/server processes as well as concurrent in-process calls. */
async function acquireCacheLock(dir: string, waitMs: number): Promise<() => Promise<void>> {
  const lockDir = `${dir}.lock`;
  const started = Date.now();
  await mkdir(dirname(dir), { recursive: true });
  for (;;) {
    try {
      await mkdir(lockDir);
      return async () => { await rm(lockDir, { recursive: true, force: true }); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const info = await stat(lockDir).catch(() => null);
      if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        // A killed bootstrap leaves a lock; live installs have a shorter deadline.
        const retired = `${lockDir}.expired-${randomUUID()}`;
        try { await rename(lockDir, retired); } catch { continue; }
        await rm(retired, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started >= waitMs) throw new Error('timed out waiting for the plugin build toolchain');
      await delay(100);
    }
  }
}

async function resolveCachedToolchain(dir: string, options?: ToolchainOptions): Promise<PluginBuildToolchain> {
  if (await isInstalled(dir)) {
    const cached = toolchainFrom(createRequire(join(dir, "noop.js")));
    if (cached !== null) return cached;
  }
  const unlock = await acquireCacheLock(dir, options?.lockWaitMs ?? LOCK_STALE_MS + FETCH_TIMEOUT_MS);
  const staging = `${dir}.staging-${randomUUID()}`;
  try {
    // A different process may have finished while this caller waited.
    if (await isInstalled(dir)) return toolchainFrom(createRequire(join(dir, 'noop.js')))!;
    options?.onFetchStart?.();
    const startedAt = Date.now();
    await mkdir(staging, { recursive: true });
    await writeFile(
      join(staging, "package.json"),
      `${JSON.stringify({ name: "zcc-plugin-toolchain", private: true, version: "0.0.0" }, null, 2)}\n`,
    );
    await run(
      process.execPath,
      [
        options?.npmCliPath ?? resolveBundledNpmCli(),
        "install",
        "--prefix",
        staging,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        ...Object.entries(PLUGIN_TOOLCHAIN_PINS).map(
          ([name, version]) => `${name}@${version}`,
        ),
      ],
      {
        maxBuffer: 2 * 1024 * 1024,
        timeout: options?.timeoutMs ?? FETCH_TIMEOUT_MS,
        windowsHide: true,
        env: {
          ...omitNpmScriptPolicyEnv(process.env),
          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {})
        },
      },
    );
    const staged = toolchainFrom(createRequire(join(staging, "noop.js")));
    if (staged === null) {
      throw new Error(
        "the downloaded plugin build toolchain is incomplete or misversioned",
      );
    }
    await writeFile(
      join(staging, ".zcc-toolchain.json"),
      `${JSON.stringify({ pins: pinKey() }, null, 2)}\n`,
    );
    // Only replace a broken cache after its replacement has been validated.
    await rm(dir, { recursive: true, force: true });
    await rename(staging, dir);
    const promoted = toolchainFrom(createRequire(join(dir, "noop.js")));
    if (promoted === null) throw new Error(errorPromoting(dir));
    options?.onFetchDone?.(Date.now() - startedAt);
    return promoted;
  } finally {
    try { await rm(staging, { recursive: true, force: true }); }
    finally { await unlock(); }
  }
}

function errorPromoting(dir: string): string {
  return `could not install the plugin build toolchain into ${dir}`;
}
