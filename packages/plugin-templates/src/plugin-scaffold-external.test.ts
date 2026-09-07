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
  await execFileAsync(process.execPath, ['scripts/build-runtime.mjs'], { cwd: pluginSdkRoot });
  await execFileAsync('npm', ['pack', '--silent', '--ignore-scripts', '--pack-destination', packDir], {
    cwd: pluginSdkRoot
  });
  const tarballs = (await readdir(packDir)).filter((entry) => entry.endsWith('.tgz'));
  expect(tarballs).toHaveLength(1);
  return join(packDir, tarballs[0]!);
}

async function installPackedSdk(targetDir: string, tarball: string): Promise<void> {
  await execFileAsync(
    'npm',
    [
      'install',
      '--include=dev',
      '--ignore-scripts',
      '--legacy-peer-deps',
      '--no-package-lock',
      '--no-save',
      '--no-audit',
      '--no-fund',
      tarball
    ],
    { cwd: targetDir }
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
  }, 180_000);

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
