import { describe, expect, it } from 'vitest';
import { isDxProject, scanFilesRecursive, scanFilesRecursiveSteps, runProjectScanAsync, listFilesRecursive, parsePackageDirectories, resolveUnderRoot, fingerprint } from '../lib/dx-project.js';
import { shouldContributeConstitution } from '../lib/constitution.js';

describe('DX project gating', () => {
  it('detects sfdx-project.json and package directories', () => {
    expect(isDxProject('/proj', (path) => path === '/proj/sfdx-project.json')).toBe(true);
    expect(isDxProject('/proj', () => false)).toBe(false);
    expect(isDxProject('', () => true)).toBe(false);
    expect(parsePackageDirectories('{"packageDirectories":[{"path":"app"}]}')).toEqual(['app']);
    expect(parsePackageDirectories('{"packageDirectories":[{}]}')).toEqual(['force-app']);
    expect(parsePackageDirectories('nope')).toEqual(['force-app']);
  });

  it('confines candidate paths to the project root', () => {
    const realpath = (path: string) => path;
    expect(resolveUnderRoot('/proj', 'force-app/main', realpath)).toBe('/proj/force-app/main');
    expect(resolveUnderRoot('/proj', '/etc/passwd', realpath)).toBeNull();
    expect(resolveUnderRoot('/proj', '../secrets', realpath)).toBeNull();
    expect(resolveUnderRoot('/proj', 'force-app\0x', realpath)).toBeNull();
    expect(resolveUnderRoot('', 'force-app', realpath)).toBeNull();
    expect(resolveUnderRoot('/proj', '/proj/force-app', realpath)).toBe('/proj/force-app');
  });

  it('contributes constitution only when an org or DX project is present', () => {
    expect(shouldContributeConstitution({ defaultOrg: '', dxProject: false })).toBe(false);
    expect(shouldContributeConstitution({ defaultOrg: 'dev', dxProject: false })).toBe(true);
    expect(shouldContributeConstitution({ defaultOrg: '', dxProject: true })).toBe(true);
    expect(fingerprint('abc')).toHaveLength(12);
    expect(
      listFilesRecursive('/proj', {
        stat: (path) => (path === '/proj' || path === '/proj/force-app' ? 'dir' : path.endsWith('.cls') ? 'file' : 'missing'),
        readdir: (path) => (path === '/proj' ? ['force-app', 'node_modules'] : path === '/proj/force-app' ? ['A.cls'] : []),
        realpath: (path) => path
      })
    ).toEqual(['/proj/force-app/A.cls']);
  });
});


describe('bounded project discovery', () => {
  it('cooperatively scans the same bounded paths and yields after at most 32 entries', async () => {
    let examined = 0, previous = 0;
    const batches: number[] = [];
    const deps = { realpath: (p: string) => p, stat: () => { examined++; return 'file' as const; }, readdir: () => Array.from({ length: 130 }, (_, i) => `f${i}`) };
    const actual = await runProjectScanAsync(scanFilesRecursiveSteps('/p', deps, 100), async () => {
      batches.push(examined - previous); previous = examined;
    });
    expect(actual).toEqual(scanFilesRecursive('/p', deps, 100));
    expect(actual.truncated).toBe(true);
    expect(batches).toHaveLength(3);
    expect(batches.every(count => count > 0 && count <= 32)).toBe(true);
  });
  it('lets native event-loop work run and preserves traversal failures', async () => {
    let heartbeat = false;
    const beat = new Promise<void>(resolve => setImmediate(() => { heartbeat = true; resolve(); }));
    const deps = { realpath: (p: string) => p, stat: () => 'file' as const, readdir: () => Array.from({ length: 65 }, (_, i) => `f${i}`) };
    await runProjectScanAsync(scanFilesRecursiveSteps('/p', deps));
    expect(heartbeat).toBe(true);
    await beat;
    await expect(runProjectScanAsync((function* () { yield; throw Error('scan failed'); })())).rejects.toThrow('scan failed');
    expect(await runProjectScanAsync(scanFilesRecursiveSteps('/p', { ...deps, readdir: () => { throw Error('denied'); } }))).toEqual({ files: [], truncated: false });
  });
  it('enforces flat file limits and reports incomplete results', () => {
    const deps = { realpath: (p: string) => p, stat: (_p: string) => 'file' as const, readdir: (_p: string) => ['a', 'b', 'c'] };
    expect(scanFilesRecursive('/p', deps, 1)).toEqual({ files: ['/p/a'], truncated: true });
    expect(scanFilesRecursive('/p', { ...deps, readdir: () => ['a'] }, 1)).toEqual({ files: ['/p/a'], truncated: false });
  });
  it('skips caches, prioritizes source, confines links and terminates cycles', () => {
    const readdir = (p: string): string[] => p === '/p' ? ['.pnpm-store', 'aaa', 'force-app', 'escape', 'cycle'] : p === '/p/force-app' ? ['Bot.agent'] : p === '/p/aaa' ? ['noise.txt'] : [];
    const deps = { realpath: (p: string) => p.endsWith('/escape') ? '/outside' : p.endsWith('/cycle') ? '/p' : p, readdir, stat: (p: string) => p.includes('.') ? 'file' as const : 'dir' as const };
    expect(scanFilesRecursive('/p', deps, 1)).toEqual({ files: ['/p/force-app/Bot.agent'], truncated: true });
    expect(scanFilesRecursive('/p', deps, 10, p => p.endsWith('.agent'))).toEqual({ files: ['/p/force-app/Bot.agent'], truncated: false });
  });
  it('bounds directories and examined entries even when no matching files exist', () => {
    let calls = 0;
    const dirs = scanFilesRecursive('/p', { realpath: p => p, stat: () => 'dir', readdir: p => { calls++; return p === '/p' ? Array.from({ length: 1002 }, (_, i) => `d${i}`) : []; } });
    expect(dirs.truncated).toBe(true); expect(calls).toBe(1000);
    const entries = scanFilesRecursive('/p', { realpath: p => p, stat: () => 'file', readdir: () => Array.from({ length: 20001 }, (_, i) => `f${i}`) }, 4000, () => false);
    expect(entries).toEqual({ files: [], truncated: true });
    expect(scanFilesRecursive('/p', { realpath: p => p, stat: () => 'missing', readdir: () => { throw Error('denied'); } }).files).toEqual([]);
  });
});
