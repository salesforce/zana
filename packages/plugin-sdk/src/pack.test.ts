import { execFile } from 'node:child_process';
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { withPluginSdkDistLock } from '../scripts/dist-lock.mjs';

const execFileAsync = promisify(execFile);
const pluginSdkRoot = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

describe('npm pack @zana-ai/zcc-plugin-sdk', () => {
  it('emits a consumer tarball with dist testing entries and no workspace protocol', async () => {
    const packDir = await mkdtemp(join(tmpdir(), 'zcc-plugin-sdk-pack-'));
    try {
      await withPluginSdkDistLock(async () => {
        await execFileAsync(process.execPath, ['scripts/build-runtime.mjs'], { cwd: pluginSdkRoot });
        await execFileAsync('npm', ['pack', '--silent', '--ignore-scripts', '--pack-destination', packDir], {
          cwd: pluginSdkRoot
        });
      });
      const tarballs = (await readdir(packDir)).filter((name) => name.endsWith('.tgz'));
      expect(tarballs).toHaveLength(1);
      const tarball = join(packDir, tarballs[0]!);
      const listing = (await execFileAsync('tar', ['-tzf', tarball])).stdout.split('\n');
      expect(listing).toContain('package/dist/testing/index.js');
      expect(listing).toContain('package/dist/testing/app.js');
      expect(listing.some((entry) => entry.startsWith('package/src/'))).toBe(false);

      await execFileAsync('tar', ['-xzf', tarball, '-C', packDir]);
      const extractDir = join(packDir, 'package');
      const manifest = JSON.parse(await readFile(join(extractDir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        exports: Record<string, { import?: string; types?: string }>;
      };
      expect(JSON.stringify(manifest.dependencies ?? {})).not.toContain('workspace:');
      expect(JSON.stringify(manifest.optionalDependencies ?? {})).not.toContain('workspace:');
      expect(JSON.stringify(manifest.peerDependencies ?? {})).not.toContain('workspace:');

      for (const subpath of ['./testing', './testing/app'] as const) {
        const entry = manifest.exports[subpath];
        expect(entry?.import).toBeTruthy();
        expect(entry?.types).toMatch(/bundled-types\//);
        await expect(access(join(extractDir, entry!.import!.replace(/^\.\//u, '')))).resolves.toBeUndefined();
        await expect(access(join(extractDir, entry!.types!.replace(/^\.\//u, '')))).resolves.toBeUndefined();
      }

      // Compile against the published declarations, outside the monorepo's source aliases.
      const consumer = join(packDir, 'project-icons.mts');
      await writeFile(consumer, `/// <reference path="./package/bundled-types/zcc-plugin-sdk.d.ts" />
import { PROJECT_ICONS, type ProjectIcon } from '@zana-ai/zcc-plugin-sdk';
import { PROJECT_ICONS as SERVER_ICONS, type ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
const icon: ProjectIcon = PROJECT_ICONS[1];
declare const zcc: ZccPluginApi;
await zcc.sdk.projects.setIcon({ projectId: 'crm', icon });
const saved: ProjectIcon | undefined = (await zcc.sdk.projects.list())[0]?.icon;
createFakePluginHost({ setProjectIcon: async ({ icon }) => { const valid: ProjectIcon = icon; } });
// @ts-expect-error Only supported icon names are accepted.
await zcc.sdk.projects.setIcon({ projectId: 'crm', icon: 'ArbitraryIcon' });
const serverIcon: ProjectIcon = SERVER_ICONS[1];
`);
      await execFileAsync(process.execPath, [join(dirname(require.resolve('typescript/package.json')), 'bin/tsc'),
        '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', consumer
      ], { cwd: packDir });
    } finally {
      await rm(packDir, { recursive: true, force: true });
    }
  }, 60_000);
});
