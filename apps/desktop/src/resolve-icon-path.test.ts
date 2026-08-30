import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconPathCandidates, resolveIconPath } from './resolve-icon-path.js';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');

function existsIn(paths: string[]) {
  const set = new Set(paths);
  return (p: string) => set.has(p);
}

describe('iconPathCandidates', () => {
  it('uses the release icon inside packaged apps', () => {
    expect(
      iconPathCandidates({
        packaged: true,
        moduleDir: '/unused',
        resourcesPath: '/Applications/Zana.app/Contents/Resources'
      })
    ).toEqual([
      join('/Applications/Zana.app/Contents/Resources', 'icon.icns'),
      join('/Applications/Zana.app/Contents/Resources', 'icon-1024.png')
    ]);
  });

  it('returns no packaged candidates when resourcesPath is missing', () => {
    expect(
      iconPathCandidates({
        packaged: true,
        moduleDir: '/unused'
      })
    ).toEqual([]);
  });

  it('keeps the development icon independent of the packaged files', () => {
    const paths = iconPathCandidates({
      packaged: false,
      moduleDir: '/checkout/out/main',
      resourcesPath: '/electron/dist/Electron.app/Contents/Resources',
      cwd: '/checkout'
    });
    expect(paths[0]).toBe(join('/checkout/out/main', '../../resources', 'icon-dev.png'));
    expect(paths).toContain(join('/checkout', 'resources', 'icon-dev.png'));
    expect(paths.some((p) => p.endsWith('icon.icns'))).toBe(false);
    expect(paths.some((p) => p.endsWith('icon-1024.png'))).toBe(false);
    expect(paths.some((p) => p.endsWith('electron.icns'))).toBe(false);
  });

  it('from a shared chunk dir, the extra ../ reaches the repo resources/', () => {
    const paths = iconPathCandidates({
      packaged: false,
      moduleDir: '/repo/out/main/chunks',
      cwd: '/repo'
    });
    expect(paths).toContain(join('/repo/out/main/chunks', '../../../resources', 'icon-dev.png'));
  });
});

describe('resolveIconPath', () => {
  it('returns the packaged icns', () => {
    const icns = join('/packaged', 'icon.icns');
    expect(
      resolveIconPath({
        packaged: true,
        moduleDir: '/out/main',
        resourcesPath: '/packaged',
        exists: existsIn([icns])
      })
    ).toBe(icns);
  });

  it('prefers icon-dev.png when unpackaged even if the product png is also present', () => {
    const dev = join('/repo/resources', 'icon-dev.png');
    const product = join('/repo/resources', 'icon-1024.png');
    expect(
      resolveIconPath({
        packaged: false,
        moduleDir: '/repo/out/main',
        cwd: '/repo',
        exists: existsIn([dev, product])
      })
    ).toBe(dev);
  });

  it('does not fall back to the shipping icon when icon-dev.png is missing', () => {
    const product = join('/repo', 'resources', 'icon-1024.png');
    expect(
      resolveIconPath({
        packaged: false,
        moduleDir: '/elsewhere',
        cwd: '/repo',
        exists: existsIn([product])
      })
    ).toBeNull();
  });

  it('committed unpackaged icon is visually distinct from the shipping png', () => {
    const dev = readFileSync(join(repoRoot, 'resources', 'icon-dev.png'));
    const shipping = readFileSync(join(repoRoot, 'resources', 'icon-1024.png'));
    expect(dev.equals(shipping)).toBe(false);
  });

  it('returns null when nothing exists', () => {
    expect(
      resolveIconPath({
        packaged: false,
        moduleDir: '/nope',
        exists: () => false
      })
    ).toBeNull();
  });

  it('finds the committed unpackaged icon via cwd', () => {
    expect(resolveIconPath({ packaged: false, moduleDir: '/does-not-exist', cwd: repoRoot })).toBe(
      join(repoRoot, 'resources', 'icon-dev.png')
    );
  });
});
