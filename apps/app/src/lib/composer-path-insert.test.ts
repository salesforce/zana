import { describe, expect, it, vi } from 'vitest';
import { insertComposerPaths, registerComposerPathTarget } from './composer-path-insert.js';

const entry = { path: '/repo/a.ts', kind: 'file' as const };

describe('composer path insert channel', () => {
  it('returns false with no registered composer', () => {
    expect(insertComposerPaths('p-none', [entry])).toBe(false);
  });

  it('ignores empty entry lists without calling handlers', () => {
    const handler = vi.fn(() => true);
    const off = registerComposerPathTarget('p-empty', handler);
    expect(insertComposerPaths('p-empty', [])).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('delivers to the newest accepting composer only', () => {
    const older = vi.fn(() => true);
    const newer = vi.fn(() => true);
    const offOlder = registerComposerPathTarget('p1', older);
    const offNewer = registerComposerPathTarget('p1', newer);
    expect(insertComposerPaths('p1', [entry])).toBe(true);
    expect(newer).toHaveBeenCalledWith([entry]);
    expect(older).not.toHaveBeenCalled();
    offNewer();
    offOlder();
  });

  it('falls back to an older composer when the newest declines', () => {
    const older = vi.fn(() => true);
    const newer = vi.fn(() => false);
    const offOlder = registerComposerPathTarget('p2', older);
    const offNewer = registerComposerPathTarget('p2', newer);
    expect(insertComposerPaths('p2', [entry])).toBe(true);
    expect(newer).toHaveBeenCalled();
    expect(older).toHaveBeenCalled();
    offNewer();
    offOlder();
  });

  it('is scoped per project', () => {
    const handler = vi.fn(() => true);
    const off = registerComposerPathTarget('p3', handler);
    expect(insertComposerPaths('other', [entry])).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('stops delivering after unregister and ignores an empty project id', () => {
    const handler = vi.fn(() => true);
    const off = registerComposerPathTarget('p4', handler);
    off();
    expect(insertComposerPaths('p4', [entry])).toBe(false);
    registerComposerPathTarget('', handler)();
    expect(insertComposerPaths('', [entry])).toBe(false);
  });
});
