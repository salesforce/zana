import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLUGIN_SDK_VERSION } from '@zana-ai/zcc-plugin-sdk';
import { withPluginSdkDistLock } from '../../plugin-sdk/scripts/dist-lock.mjs';
import { scaffoldPlugin } from './index.js';

const execFileAsync = promisify(execFile);
const pluginSdkRoot = fileURLToPath(new URL('../../plugin-sdk', import.meta.url));
const sdkRequire = createRequire(join(pluginSdkRoot, 'package.json'));

const LINKED_DEPENDENCIES = [
  '@testing-library/dom',
  '@testing-library/react',
  'jsdom',
  'react',
  'react-dom',
  'vitest'
] as const;

function packageRoot(name: string): string {
  const roots = [sdkRequire];
  if (name === '@testing-library/dom') {
    roots.push(createRequire(sdkRequire.resolve('@testing-library/react/package.json')));
  }
  for (const req of roots) {
    try {
      return dirname(req.resolve(`${name}/package.json`));
    } catch {
      /* try the next resolver */
    }
  }
  let current = dirname(sdkRequire.resolve(name === '@testing-library/dom' ? '@testing-library/react' : name));
  while (true) {
    try {
      const manifest = JSON.parse(readFileSync(join(current, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (manifest.name === name) return current;
    } catch {
      /* keep walking */
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`package root not found: ${name}`);
    current = parent;
  }
}

async function packPluginSdk(packDir: string): Promise<string> {
  await mkdir(packDir, { recursive: true });
  // A stale `dist/` from a prior run must never be packed as-is: its mere
  // existence says nothing about whether it matches the current source, so
  // rebuild unconditionally rather than gating on a presence check.
  await withPluginSdkDistLock(async () => {
    await execFileAsync(process.execPath, ['scripts/build-runtime.mjs'], { cwd: pluginSdkRoot });
    await execFileAsync('npm', ['pack', '--silent', '--ignore-scripts', '--pack-destination', packDir], {
      cwd: pluginSdkRoot
    });
  });
  const tarballs = (await readdir(packDir)).filter((entry) => entry.endsWith('.tgz'));
  expect(tarballs).toHaveLength(1);
  return join(packDir, tarballs[0]!);
}

async function installPackedSdk(targetDir: string, tarball: string): Promise<void> {
  const args = [
    'install',
    '--include=dev',
    '--ignore-scripts',
    '--legacy-peer-deps',
    '--omit=dev',
    '--no-package-lock',
    '--no-save',
    '--no-audit',
    '--no-fund',
    tarball
  ];
  // Build a SANITIZED child env: some host shells (e.g. a devbar npm shim,
  // sourced by the git pre-push hook but not an interactive shell) export
  // `npm_config_allow_scripts`, and npm rejects that config on a project-scoped
  // install with `EALLOWSCRIPTS` — deterministically, so all retries fail the
  // same way and the failure only shows up under the hook, never in a bare
  // `pnpm test`. We already pass `--ignore-scripts`, so scripts never run; drop
  // every inherited allow-scripts variant to make the install shell-agnostic.
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (/^npm_config_allow[_-]?scripts$/i.test(key)) delete childEnv[key];
  }
  childEnv.npm_config_cache = join(targetDir, '.npm-cache');
  childEnv.npm_config_loglevel = 'error';
  let lastError: unknown;
  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await execFileAsync('npm', args, {
        cwd: targetDir,
        // Keep cache and partial output inside the disposable fixture; retry a
        // clean install if another concurrent Vitest worker temporarily
        // exhausts npm resources. maxBuffer is lifted well above the default
        // 1 MiB so parallel-load npm chatter can't overflow the pipe and kill
        // the install mid-flight.
        env: childEnv,
        maxBuffer: 64 * 1024 * 1024
      });
      return;
    } catch (error) {
      lastError = error;
      await rm(join(targetDir, 'node_modules'), { recursive: true, force: true });
      // Back off before retrying: the transient failure is another worker
      // temporarily exhausting npm/disk resources, and an INSTANT retry just
      // races the same contention (three rapid attempts all lose together).
      // Exponential backoff (0.5s, 1s, 2s, 4s) lets the contention clear.
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  }
  // Surface the FULL failure shape (code/signal/killed + captured output), not
  // just stdout/stderr — a maxBuffer/timeout kill leaves those empty, which is
  // exactly the uninformative "failed after N attempts" this diagnoses.
  const failed = lastError as {
    message?: string;
    code?: string | number;
    signal?: string;
    killed?: boolean;
    stdout?: string;
    stderr?: string;
  };
  throw new Error(
    `packed SDK install failed after ${attempts} attempts ` +
      `(code=${failed.code ?? '?'} signal=${failed.signal ?? '?'} killed=${failed.killed ?? '?'}): ` +
      `${failed.message ?? ''}\n${failed.stdout ?? ''}${failed.stderr ?? ''}`
  );
}

function linkExternalDependencies(targetDir: string): void {
  for (const name of LINKED_DEPENDENCIES) {
    const target = join(targetDir, 'node_modules', name);
    mkdirSync(dirname(target), { recursive: true });
    rmSync(target, { recursive: true, force: true });
    symlinkSync(packageRoot(name), target, 'dir');
  }
}

async function runVitest(targetDir: string): Promise<void> {
  const vitestRoot = packageRoot('vitest');
  try {
    await execFileAsync(process.execPath, [join(vitestRoot, 'vitest.mjs'), 'run', '--passWithNoTests=false'], {
      cwd: targetDir
    });
  } catch (error) {
    const failed = error as { stderr?: string; stdout?: string };
    throw new Error(`external scaffold tests failed:\n${failed.stdout ?? ''}${failed.stderr ?? ''}`);
  }
}

describe('external plugin scaffold tests', () => {
  let packRoot: string;
  let tarball: string;
  let pluginDir: string;

  beforeAll(async () => {
    packRoot = await mkdtemp(join(tmpdir(), 'zcc-scaffold-pack-'));
    tarball = await packPluginSdk(join(packRoot, 'pack'));
    pluginDir = join(packRoot, 'plugin');
    await scaffoldPlugin({
      targetDir: pluginDir,
      id: 'external-todos',
      name: 'External todos',
      kind: 'main-panel'
    });
    await installPackedSdk(pluginDir, tarball);
    linkExternalDependencies(pluginDir);
  // Full suite runs package packing beside Electron/build work. Keep setup
  // bounded, but allow its known isolated 77s path room under shared load.
  }, 300_000);

  afterAll(async () => {
    await rm(packRoot, { recursive: true, force: true });
  });

  it('pins the packed SDK version and keeps the pin off file:', async () => {
    const pkg = JSON.parse(await readFile(join(pluginDir, 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>;
    };
    expect(pkg.devDependencies?.['@zana-ai/zcc-plugin-sdk']).toBe(PLUGIN_SDK_VERSION);
    expect(pkg.devDependencies?.['@zana-ai/zcc-plugin-sdk']).not.toMatch(/^file:/);
    await expect(
      access(join(pluginDir, 'node_modules', '@zana-ai', 'zcc-plugin-sdk', 'dist', 'testing', 'app.js'))
    ).resolves.toBeUndefined();
  });

  it('runs generated backend and frontend tests against the packed harness', async () => {
    await runVitest(pluginDir);
  }, 60_000);
});
