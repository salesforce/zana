import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CRASH_REPORT_MARKDOWN_MAX } from '@zana-ai/zcc-domain/product';
import { CRASH_REPORT_KEEP, pruneCrashReports, saveRendererCrashReport } from './crash-report-store.js';

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('crash report store', () => {
  it('writes markdown atomically and returns only the basename', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-crashes-'));
    const { fileName } = await saveRendererCrashReport({
      dir,
      markdown: '# crash\nboom',
      now: new Date('2026-09-01T00:14:58.000Z'),
      id: 'abcd1234-ffff'
    });
    expect(fileName).toBe('crash-2026-09-01T00-14-58-000Z-abcd1234.md');
    expect(fileName.includes('/')).toBe(false);
    expect(readFileSync(join(dir, fileName), 'utf8')).toBe('# crash\nboom');
    expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('rejects non-string markdown by writing an empty bounded body', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-crashes-'));
    const { fileName } = await saveRendererCrashReport({
      dir,
      markdown: 12 as unknown as string,
      id: 'deadbeef'
    });
    expect(readFileSync(join(dir, fileName), 'utf8')).toBe('');
  });

  it('keeps only the newest crash files', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-crashes-'));
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < CRASH_REPORT_KEEP + 3; i += 1) {
      const name = `crash-${String(i).padStart(3, '0')}.md`;
      writeFileSync(join(dir, name), 'x');
    }
    await pruneCrashReports(dir);
    const left = readdirSync(dir).filter((name) => name.endsWith('.md')).sort();
    expect(left).toHaveLength(CRASH_REPORT_KEEP);
    expect(left[0]).toBe('crash-003.md');
  });

  it('truncates oversized markdown before writing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-crashes-'));
    const { fileName } = await saveRendererCrashReport({
      dir,
      markdown: 'm'.repeat(200_000),
      id: 'cafebabe'
    });
    expect(readFileSync(join(dir, fileName), 'utf8').length).toBeLessThanOrEqual(CRASH_REPORT_MARKDOWN_MAX);
  });
});
