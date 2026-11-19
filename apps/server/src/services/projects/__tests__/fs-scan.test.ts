import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { opendir, open } from 'node:fs/promises';

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, opendir: vi.fn(fs.opendir), open: vi.fn(fs.open) };
});
import { resolveDoc, searchFiles, walkFiles } from '../fs.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'zcc-fs-scan-')); });
afterEach(() => { vi.clearAllMocks(); rmSync(root, { recursive: true, force: true }); });
function file(rel: string, text = 'needle\n') {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  return path;
}

describe('asynchronous project scans', () => {
  it('keeps pathological regex evaluation off the event loop and returns partial results on timeout', async () => {
    file('pathological.txt', 'a'.repeat(32) + '!');
    let ticks = 0; const timer = setInterval(() => ticks++, 10);
    try {
      const result = await searchFiles(root, '(a+)+$', { regex: true });
      expect(result).toMatchObject({ hits: [], scanned: 1, truncated: true });
      expect(ticks).toBeGreaterThan(5);
      expect(await searchFiles(root, 'x'.repeat(4097), { regex: true })).toMatchObject({ truncated: true, scanned: 0 });
    } finally { clearInterval(timer); }
  });
  it('yields to the event loop and skips denied directories', async () => {
    file('src/a.ts'); file('node_modules/hidden.ts'); file('.git/hidden');
    let ticked = false;
    const tick = new Promise<void>((resolve) => setImmediate(() => { ticked = true; resolve(); }));
    const { files } = await walkFiles(root);
    expect(ticked).toBe(true);
    expect(files).toEqual([{ rel: 'src/a.ts', path: join(root, 'src/a.ts') }]);
    await tick;
  });

  it('returns an empty list for missing and unreadable roots', async () => {
    expect(await walkFiles(join(root, 'missing'))).toEqual({ files: [], truncated: false });
    vi.mocked(opendir).mockRejectedValueOnce(new Error('denied'));
    expect((await walkFiles(root)).files).toEqual([]);
  });

  it('deduplicates symlink cycles and rejects external and broken links', async () => {
    file('src/a.ts');
    symlinkSync(root, join(root, 'src/loop'));
    symlinkSync(join(root, 'src'), join(root, 'alias'));
    symlinkSync(tmpdir(), join(root, 'outside'));
    symlinkSync(join(root, 'missing'), join(root, 'broken'));
    symlinkSync(join(root, 'src/a.ts'), join(root, 'linked.ts'));
    symlinkSync(join(tmpdir(), 'external-secret'), join(root, 'external-file'));
    const { files } = await walkFiles(root);
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.rel === 'linked.ts')).toBe(true);
    expect(files.some((f) => /outside|loop|broken|external-file/.test(f.rel))).toBe(false);
  });

  it('limits file count and directory depth', async () => {
    for (let i = 0; i < 8001; i++) file(`flat/${i}.ts`);
    expect((await walkFiles(root)).files).toHaveLength(8000);
    rmSync(join(root, 'flat'), { recursive: true });
    file(`${Array(12).fill('dir').join('/')}/kept.ts`);
    file(`${Array(13).fill('dir').join('/')}/deep.ts`);
    expect((await walkFiles(root)).files.map((f) => f.rel)).toEqual([`${Array(12).fill('dir').join('/')}/kept.ts`]);
  });

  it('bounds examined entries even when none are returned', async () => {
    let examined = 0;
    vi.mocked(opendir).mockResolvedValueOnce({
      async *[Symbol.asyncIterator]() {
        for (let i = 0; i < 40_000; i++) {
          examined++;
          yield { name: 'node_modules' };
        }
      }
    } as unknown as Awaited<ReturnType<typeof opendir>>);
    expect((await walkFiles(root)).files).toEqual([]);
    expect(examined).toBe(32_001);
  });

  it('awaits exact, cwd and unique-basename document recovery while confining paths', async () => {
    file('src/report.md');
    expect(await resolveDoc(root, 'src/report.md')).toEqual({ ok: true, rel: 'src/report.md' });
    expect(await resolveDoc(root, 'report.md', join(root, 'src'))).toEqual({ ok: true, rel: 'src/report.md' });
    expect(await resolveDoc(root, 'report.md')).toEqual({ ok: true, rel: 'src/report.md' });
    file('other/report.md');
    expect(await resolveDoc(root, 'report.md')).toEqual({ ok: false });
    expect(await resolveDoc(root, '../missing', tmpdir())).toEqual({ ok: false });
  });

  it('searches text asynchronously with literal, case-sensitive and regex queries', async () => {
    file('a.txt', 'Needle\nneedle\nx.y\n'); file('b.bin', '\0needle');
    file('large.txt', 'x'.repeat(1024 * 1024 + 1));
    expect((await searchFiles(root, 'needle')).hits).toHaveLength(2);
    expect((await searchFiles(root, 'Needle', { caseSensitive: true })).hits).toHaveLength(1);
    expect((await searchFiles(root, 'x.y')).hits).toHaveLength(1);
    expect((await searchFiles(root, '^Need', { regex: true, caseSensitive: true })).hits).toHaveLength(1);
    expect(await searchFiles(root, ' ')).toEqual({ hits: [], scanned: 0, truncated: false });
    expect(await searchFiles(root, '[', { regex: true })).toEqual({ hits: [], scanned: 0, truncated: false });
  });

  it('closes file handles on read failure and continues the scan', async () => {
    file('a.txt');
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(open).mockResolvedValueOnce({ read: vi.fn().mockRejectedValue(new Error('gone')), close } as unknown as Awaited<ReturnType<typeof open>>);
    expect((await searchFiles(root, 'needle')).hits).toEqual([]);
    expect(close).toHaveBeenCalledOnce();
  });

  it('handles short reads and an early EOF without reading beyond the file cap', async () => {
    file('a.txt', 'needle-pending');
    const close = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn(async (buffer: Buffer, offset: number, _length: number, position: number) => {
      const chunk = Buffer.from('needle').subarray(position, position + 2);
      chunk.copy(buffer, offset);
      return { bytesRead: chunk.length };
    });
    vi.mocked(open).mockResolvedValueOnce({ read, close } as unknown as Awaited<ReturnType<typeof open>>);
    expect((await searchFiles(root, 'needle')).hits).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(4);
    expect(close).toHaveBeenCalledOnce();
  });

  it('bounds line matches, total hits and displayed line length', async () => {
    for (let i = 0; i < 30; i++) file(`${i}.txt`, `${'needle '.repeat(60)}\n`.repeat(30));
    const result = await searchFiles(root, 'needle');
    expect(result.hits).toHaveLength(500);
    expect(result.truncated).toBe(true);
    expect(result.hits.every((hit) => hit.preview.length <= 241)).toBe(true);
  });
});
