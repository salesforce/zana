import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  archName,
  resolveOpencodeResourceDir,
  trimOtherOpencodeArches
} from './after-pack-trim-opencode.mjs';

describe('after-pack-trim-opencode', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fakeMacApp(): string {
    const appOutDir = mkdtempSync(join(tmpdir(), 'zcc-opencode-pack-'));
    roots.push(appOutDir);
    const opencode = join(appOutDir, 'Zana.app', 'Contents', 'Resources', 'opencode');
    mkdirSync(join(opencode, 'arm64'), { recursive: true });
    mkdirSync(join(opencode, 'x64'), { recursive: true });
    writeFileSync(join(opencode, 'arm64', 'opencode'), 'arm');
    writeFileSync(join(opencode, 'x64', 'opencode'), 'x64');
    return appOutDir;
  }

  it('maps electron-builder Arch codes to names', () => {
    expect(archName(1)).toBe('x64');
    expect(archName(3)).toBe('arm64');
    expect(archName(4)).toBe('universal');
    expect(archName('arm64')).toBe('arm64');
  });

  it('resolves mac extraResources under the .app bundle', () => {
    const appOutDir = fakeMacApp();
    expect(resolveOpencodeResourceDir(appOutDir, 'darwin')).toBe(
      join(appOutDir, 'Zana.app', 'Contents', 'Resources', 'opencode')
    );
  });

  it('drops the unused arch from a darwin arm64 pack', () => {
    const appOutDir = fakeMacApp();
    expect(trimOtherOpencodeArches(appOutDir, 'darwin', 3)).toEqual(['x64']);
    const opencode = join(appOutDir, 'Zana.app', 'Contents', 'Resources', 'opencode');
    expect(existsSync(join(opencode, 'arm64', 'opencode'))).toBe(true);
    expect(existsSync(join(opencode, 'x64'))).toBe(false);
  });

  it('drops the unused arch from a darwin x64 pack', () => {
    const appOutDir = fakeMacApp();
    expect(trimOtherOpencodeArches(appOutDir, 'darwin', 'x64')).toEqual(['arm64']);
    const opencode = join(appOutDir, 'Zana.app', 'Contents', 'Resources', 'opencode');
    expect(existsSync(join(opencode, 'x64', 'opencode'))).toBe(true);
    expect(existsSync(join(opencode, 'arm64'))).toBe(false);
  });

  it('keeps both arches for a universal pack', () => {
    const appOutDir = fakeMacApp();
    expect(trimOtherOpencodeArches(appOutDir, 'darwin', 4)).toEqual([]);
    const opencode = join(appOutDir, 'Zana.app', 'Contents', 'Resources', 'opencode');
    expect(existsSync(join(opencode, 'arm64', 'opencode'))).toBe(true);
    expect(existsSync(join(opencode, 'x64', 'opencode'))).toBe(true);
  });

  it('is a no-op when extraResources did not copy opencode', () => {
    const appOutDir = mkdtempSync(join(tmpdir(), 'zcc-opencode-empty-'));
    roots.push(appOutDir);
    mkdirSync(join(appOutDir, 'Zana.app', 'Contents', 'Resources'), { recursive: true });
    expect(trimOtherOpencodeArches(appOutDir, 'darwin', 'arm64')).toEqual([]);
  });
});
