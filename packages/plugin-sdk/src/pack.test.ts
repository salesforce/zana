import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const pluginSdkRoot = fileURLToPath(new URL('..', import.meta.url));

describe('npm pack @zana-ai/zcc-plugin-sdk', () => {
  it('emits a consumer tarball with dist testing entries and no workspace protocol', async () => {
    const packDir = await mkdtemp(join(tmpdir(), 'zcc-plugin-sdk-pack-'));
    try {
      if (!existsSync(join(pluginSdkRoot, 'dist', 'testing', 'app.js'))) {
        await execFileAsync(process.execPath, ['scripts/build-runtime.mjs'], { cwd: pluginSdkRoot });
      }
      await execFileAsync('npm', ['pack', '--silent', '--ignore-scripts', '--pack-destination', packDir], {
        cwd: pluginSdkRoot
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
    } finally {
      await rm(packDir, { recursive: true, force: true });
    }
  }, 60_000);
});
