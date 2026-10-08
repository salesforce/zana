import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DesignDocFile } from '../shared/contract.js';
import { KIT_FILES } from '../shared/page.js';
import { NO_KIT } from './pages.js';
import { importSkipReason, mapBounded, siteFiles } from './site-files.js';

const file = (path: string, content: string, kind: DesignDocFile['kind'] = 'html'): DesignDocFile =>
  ({ path, content, encoding: 'utf8', kind, size: content.length, revision: 1, updatedAt: 0, updatedBy: { kind: 'user', label: 'You', threadId: null } }) as DesignDocFile;

describe('siteFiles', () => {
  it('knows every file the kit ships, so an export copies them all', () => {
    expect(readdirSync(join(import.meta.dirname, '../../kit')).sort()).toEqual([...KIT_FILES].sort());
  });

  it('adds only the kit files a kit can supply, and .nojekyll once', () => {
    const files = [file('index.html', '<link href="zcc-kit/site.css">'), file('.nojekyll', '', 'text')];
    expect(siteFiles(files, NO_KIT).map((entry) => entry.path)).toEqual(['index.html', '.nojekyll']);
  });

  it('leaves the kit out of docs that do not load it', () => {
    expect(siteFiles([file('index.html', '<p>plain</p>')], () => ({ path: 'x', kind: 'css', content: '', encoding: 'utf8', revision: 0 })).map((entry) => entry.path)).toEqual([
      'index.html',
      '.nojekyll'
    ]);
  });
});

describe('importSkipReason', () => {
  it('keeps ordinary files and names why others stay out', () => {
    expect(importSkipReason('docs/a.md')).toBeNull();
    expect(importSkipReason('assets/zcc-kit/x.css')).toBeNull();
    expect(importSkipReason('a/.cache/b')).toBe('hidden');
    expect(importSkipReason('pkg/node_modules/x/index.js')).toBe('dependencies');
    expect(importSkipReason('zcc-kit/site.js')).toMatch(/^the site kit/);
  });
});

describe('mapBounded', () => {
  it('keeps the order and at most limit in flight', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapBounded([1, 2, 3, 4, 5], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
    expect(await mapBounded([], 4, async () => 1)).toEqual([]);
  });

  it('starts nothing new after a failure', async () => {
    const seen: number[] = [];
    const work = mapBounded([1, 2, 3, 4], 1, async (n) => {
      seen.push(n);
      if (n === 2) throw new Error('boom');
      return n;
    });
    await expect(work).rejects.toThrow('boom');
    expect(seen).toEqual([1, 2]);
  });
});
