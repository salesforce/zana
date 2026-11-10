import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  assertDesktopPresentation: vi.fn(),
  getConversationThread: vi.fn(),
  getEnvironment: vi.fn(),
  trustedFoldersForTarget: vi.fn()
}));
vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: h.getConversationThread,
  getEnvironment: h.getEnvironment
}));
vi.mock('./interaction-surface.js', () => ({ assertDesktopPresentation: h.assertDesktopPresentation }));
vi.mock('./preview-root-policy.js', async (orig) => ({
  ...(await orig<typeof import('./preview-root-policy.js')>()),
  trustedFoldersForTarget: h.trustedFoldersForTarget
}));

import { previewFileDepsFromContext } from './preview-file.js';

const emit = vi.fn();
const ctx = {
  db: { tag: 'db' }, dataDir: '/data',
  toProjects: () => [{ id: 'p1', path: '/proj' }],
  hub: { emit, size: () => 3 }
} as never;
beforeEach(() => vi.clearAllMocks());

describe('previewFileDepsFromContext', () => {
  it('wires the context into the dependency seams', () => {
    h.getConversationThread.mockReturnValue({ id: 't' });
    h.getEnvironment.mockImplementation((_db: unknown, id: string) => (id === 'e1' ? { path: '/env' } : null));
    h.trustedFoldersForTarget.mockReturnValue(['/trusted']);
    const deps = previewFileDepsFromContext(ctx);
    expect(deps.dataDir).toBe('/data');
    expect(deps.getThread('t')).toEqual({ id: 't' });
    expect(deps.getEnvironmentPath('e1')).toBe('/env');
    expect(deps.getEnvironmentPath('nope')).toBeNull();
    expect(deps.getProjectPath('p1')).toBe('/proj');
    expect(deps.getProjectPath('zzz')).toBeNull();
    const target = { thread: null, projectId: 'p1' };
    expect(deps.trustedPreviewFolders!(target)).toEqual(['/trusted']);
    expect(h.trustedFoldersForTarget).toHaveBeenCalledWith(ctx, target);
    expect(deps.emit({ type: 'thread-open' } as never)).toBe(3);
    expect(emit).toHaveBeenCalledWith('threads:open', { type: 'thread-open' });
    deps.assertPresentation!('t');
    expect(h.assertDesktopPresentation).toHaveBeenCalledWith({ tag: 'db' }, 't');
  });
});
