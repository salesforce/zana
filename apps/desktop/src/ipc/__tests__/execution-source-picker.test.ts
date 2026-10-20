import { describe, expect, it } from 'vitest';
import { createSourcePickerFolders, sourcePickerDialogOptions } from '../execution-source-picker.js';

const dirs = (...known: string[]) => async (p: string) => known.includes(p);

describe('createSourcePickerFolders', () => {
  it('prefers the remembered folder', async () => {
    const f = createSourcePickerFolders({ isDirectory: dirs('/p', '/p/.zcc') });
    f.remember('a', ['/p/.zcc/x.md', '/p/other.md']);
    expect(await f.defaultPathFor({ id: 'a', path: '/p' })).toBe('/p/.zcc');
  });

  it('falls back to the project path when the remembered folder was deleted', async () => {
    const f = createSourcePickerFolders({ isDirectory: dirs('/p') });
    f.remember('a', ['/gone/x.md']);
    expect(await f.defaultPathFor({ id: 'a', path: '/p' })).toBe('/p');
  });

  it('gives undefined for a remote project with nothing remembered', async () => {
    const f = createSourcePickerFolders({ isDirectory: dirs('/p') });
    expect(await f.defaultPathFor({ id: 'a', path: '/p', remote: { host: 'h' } })).toBeUndefined();
  });

  it('gives undefined when the project path is not a directory', async () => {
    const f = createSourcePickerFolders({ isDirectory: dirs() });
    expect(await f.defaultPathFor({ id: 'a', path: '/p' })).toBeUndefined();
  });

  it('evicts the least recently used project at the cap', async () => {
    const f = createSourcePickerFolders({ maxEntries: 2, isDirectory: dirs('/a', '/b', '/c') });
    f.remember('a', ['/a/x']); f.remember('b', ['/b/x']);
    await f.defaultPathFor({ id: 'a', path: '/none' }); // touch a, so b is oldest
    f.remember('c', ['/c/x']);
    expect(await f.defaultPathFor({ id: 'a', path: '/none' })).toBe('/a');
    expect(await f.defaultPathFor({ id: 'b', path: '/none' })).toBeUndefined();
    expect(await f.defaultPathFor({ id: 'c', path: '/none' })).toBe('/c');
  });

  it('ignores an empty pick', async () => {
    const f = createSourcePickerFolders({ isDirectory: dirs('/p', '/q') });
    f.remember('a', ['/q/x']);
    f.remember('a', []);
    expect(await f.defaultPathFor({ id: 'a', path: '/p' })).toBe('/q');
  });

  it('treats a rejecting isDirectory as not a directory', async () => {
    const f = createSourcePickerFolders({ isDirectory: async (p) => { if (p === '/q') throw new Error('boom'); return p === '/p'; } });
    f.remember('a', ['/q/x']);
    expect(await f.defaultPathFor({ id: 'a', path: '/p' })).toBe('/p');
    const g = createSourcePickerFolders({ isDirectory: async () => { throw new Error('boom'); } });
    expect(await g.defaultPathFor({ id: 'a', path: '/p' })).toBeUndefined();
  });

  it('uses the real filesystem by default and never throws', async () => {
    const f = createSourcePickerFolders();
    expect(await f.defaultPathFor({ id: 'a', path: process.cwd() })).toBe(process.cwd());
    expect(await f.defaultPathFor({ id: 'a', path: '/definitely/not/here' })).toBeUndefined();
  });
});

describe('sourcePickerDialogOptions', () => {
  it('always shows hidden files and includes defaultPath only when set', () => {
    expect(sourcePickerDialogOptions('/p')).toEqual({ title: 'Add execution sources', properties: ['openFile', 'multiSelections', 'showHiddenFiles'], defaultPath: '/p' });
    const none = sourcePickerDialogOptions(undefined);
    expect(none.properties).toContain('showHiddenFiles');
    expect('defaultPath' in none).toBe(false);
  });
});
