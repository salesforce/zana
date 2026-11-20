// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useFileOperations } from './useFileOperations.js';

const mocks = vi.hoisted(() => ({ insert: vi.fn(), toast: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: {} }));
vi.mock('../../lib/copy-text.js', () => ({ copyText: vi.fn() }));
vi.mock('../../lib/composer-path-insert.js', () => ({ insertComposerPaths: mocks.insert }));

const mount = () => renderHook(() => useFileOperations({ viewRoot: '/repo', isRemote: false, projectId: 'p', pushToast: mocks.toast })).result.current;
beforeEach(() => vi.clearAllMocks());

it('adds a file path as a file mention', () => {
  mocks.insert.mockReturnValue(true);
  mount().addToChat('/repo/a.ts', 'file');
  expect(mocks.insert).toHaveBeenCalledWith('p', [{ path: '/repo/a.ts', kind: 'file' }]);
  expect(mocks.toast).not.toHaveBeenCalled();
});

it('adds a folder as a directory mention (path only)', () => {
  mocks.insert.mockReturnValue(true);
  mount().addToChat('/repo/src', 'dir');
  expect(mocks.insert).toHaveBeenCalledWith('p', [{ path: '/repo/src', kind: 'directory' }]);
});

it('tells the user when no chat is open', () => {
  mocks.insert.mockReturnValue(false);
  mount().addToChat('/repo/a.ts', 'file');
  expect(mocks.toast).toHaveBeenCalledWith('Open a chat for this project first', 'error');
});
