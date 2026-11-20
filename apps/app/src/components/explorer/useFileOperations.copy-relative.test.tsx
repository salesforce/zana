// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileOperations } from './useFileOperations.js';

const mocks = vi.hoisted(() => ({ copy: vi.fn(), toast: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: {} }));
vi.mock('../../lib/copy-text.js', () => ({ copyText: mocks.copy }));

function mount(viewRoot: string) {
  return renderHook(() => useFileOperations({ viewRoot, isRemote: false, projectId: 'p', pushToast: mocks.toast })).result.current;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.copy.mockResolvedValue(undefined);
});

describe('copyRelativePath', () => {
  it('copies a path under the root relative to it', async () => {
    await mount('/repo').copyRelativePath('/repo/src/a.ts');
    expect(mocks.copy).toHaveBeenCalledWith('src/a.ts');
    expect(mocks.toast).toHaveBeenCalledWith('Relative path copied');
  });

  it('copies "." for the root itself', async () => {
    await mount('/repo').copyRelativePath('/repo');
    expect(mocks.copy).toHaveBeenCalledWith('.');
  });

  it('falls back to the absolute path outside the root, including sibling prefixes', async () => {
    const hook = mount('/repo');
    await hook.copyRelativePath('/other/file');
    await hook.copyRelativePath('/repo-other/file');
    expect(mocks.copy).toHaveBeenNthCalledWith(1, '/other/file');
    expect(mocks.copy).toHaveBeenNthCalledWith(2, '/repo-other/file');
  });

  it('normalises Windows separators under a Windows root', async () => {
    await mount('C:\\repo').copyRelativePath('C:\\repo\\src\\a.ts');
    expect(mocks.copy).toHaveBeenCalledWith('src/a.ts');
  });

  it('reports a clipboard failure', async () => {
    mocks.copy.mockRejectedValue(new Error('denied'));
    await mount('/repo').copyRelativePath('/repo/a');
    expect(mocks.toast).toHaveBeenCalledWith('Failed to copy path', 'error');
  });
});
