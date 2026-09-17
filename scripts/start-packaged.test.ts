import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  missingPackagedAppMessage,
  packagedAppCandidates,
  resolvePackagedApp,
  startPackagedCommand
} from './start-packaged.mjs';

const repoRoot = dirname(fileURLToPath(new URL('.', import.meta.url)));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('start-packaged', () => {
  it('prefers dist/mac-arm64 on darwin arm64', () => {
    expect(packagedAppCandidates({ root: '/repo', platform: 'darwin', arch: 'arm64' })[0]).toBe(
      '/repo/dist/mac-arm64/Zana.app'
    );
    expect(packagedAppCandidates({ root: '/repo', platform: 'darwin', arch: 'x64' })[0]).toBe(
      '/repo/dist/mac/Zana.app'
    );
  });

  it('resolves the first existing candidate', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-start-packaged-'));
    roots.push(root);
    mkdirSync(join(root, 'dist', 'mac-arm64'), { recursive: true });
    writeFileSync(join(root, 'dist', 'mac-arm64', 'Zana.app'), 'app');
    expect(resolvePackagedApp({ root, platform: 'darwin', arch: 'arm64' })).toBe(
      join(root, 'dist', 'mac-arm64', 'Zana.app')
    );
  });

  it('returns null when nothing is packaged', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-start-packaged-missing-'));
    roots.push(root);
    expect(resolvePackagedApp({ root, platform: 'darwin', arch: 'arm64' })).toBeNull();
  });

  it('opens with `open` on macOS and execs the binary elsewhere', () => {
    expect(startPackagedCommand('/app/Zana.app', 'darwin')).toEqual({
      command: 'open',
      args: ['/app/Zana.app']
    });
    expect(startPackagedCommand('/app/Zana.exe', 'win32')).toEqual({
      command: '/app/Zana.exe',
      args: []
    });
  });

  it('tells the caller to run pnpm dist', () => {
    const message = missingPackagedAppMessage(['/repo/dist/mac-arm64/Zana.app']);
    expect(message).toContain('pnpm dist');
    expect(message).toContain('pnpm preview');
    expect(message).toContain('/repo/dist/mac-arm64/Zana.app');
  });

  it('wires root `start` to this script and drops the turbo duplicates', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.start).toBe('node scripts/start-packaged.mjs');
    expect(pkg.scripts.dev).toBe('node scripts/dev-local.mjs');
    expect(pkg.scripts.dev).not.toBe(pkg.scripts.start);
    expect(pkg.scripts['dev:prod']).toBe('node scripts/dev-local.mjs --packaged');
    expect(pkg.scripts['start:prod']).toBeUndefined();
    expect(pkg.scripts.prestart).toBeUndefined();
    expect(pkg.scripts['dev:legacy']).toBeUndefined();
    expect(pkg.scripts['start:legacy']).toBeUndefined();
  });
});
